import { ApiError, isAuthCodeRestart } from "./api-error"
import { isAuthEndpoint, SSO_ENDPOINTS } from "./endpoints"
import { apiUrl, readApiResult } from "./http"
import {
  createCodeChallenge,
  createCodeVerifier,
  createRandomString,
} from "./pkce"
import { createStorageKeys } from "./storage-keys"

import type {
  ApiFetch,
  AuthClient,
  AuthClientConfig,
  AuthClientDeps,
  AuthLocation,
  CallbackResult,
  LogoutOptions,
  RenewLock,
  TokenPair,
  TokenResponse,
  UnauthenticatedPolicy,
} from "./types"

const DEFAULT_CALLBACK_PATH = "/auth/callback"

export function createAuthClient(
  config: AuthClientConfig,
  options: { onUnauthenticated: UnauthenticatedPolicy },
  deps?: AuthClientDeps,
): AuthClient {
  const fetchImpl =
    deps?.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, init))
  const location = deps?.location ?? browserLocation()
  const renewLock = deps?.renewLock ?? browserRenewLock()
  const keys = createStorageKeys(config.storagePrefix)
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH

  let accessToken: string | null = null
  let renewFlight: Promise<string> | null = null
  let recoverFlight: Promise<string> | null = null
  const callbackFlights = new Map<string, Promise<CallbackResult>>()

  // 다른 탭이 로그아웃하면 이 탭의 메모리 토큰도 버린다.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key === keys.refreshToken && event.newValue === null) {
        accessToken = null
      }
    })
  }

  function redirectUri() {
    return `${location.origin}${callbackPath}`
  }

  function authAppPath(path: string) {
    return `${trimTrailingSlash(config.authAppUrl)}${path}`
  }

  function getAccessToken() {
    return accessToken
  }

  function getRefreshToken() {
    return localStorage.getItem(keys.refreshToken)
  }

  function setTokens(tokens: TokenPair) {
    accessToken = tokens.accessToken
    localStorage.setItem(keys.refreshToken, tokens.refreshToken)
  }

  function clearOauthTransaction() {
    sessionStorage.removeItem(keys.codeVerifier)
    sessionStorage.removeItem(keys.state)
    sessionStorage.removeItem(keys.returnTo)
  }

  function clearSession() {
    accessToken = null
    localStorage.removeItem(keys.refreshToken)
    clearOauthTransaction()
  }

  async function startLogin(returnTo?: string) {
    const codeVerifier = createCodeVerifier()
    const codeChallenge = await createCodeChallenge(codeVerifier)
    const state = createRandomString(32)

    sessionStorage.setItem(keys.codeVerifier, codeVerifier)
    sessionStorage.setItem(keys.state, state)
    sessionStorage.setItem(keys.returnTo, safeReturnTo(returnTo))

    const params = new URLSearchParams({
      client_id: config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri(),
      response_type: "code",
      state,
    })
    const target =
      config.loginMode === "auth-app"
        ? `${authAppPath("/authorize")}?${params.toString()}`
        : `${apiUrl(config.apiBaseUrl, SSO_ENDPOINTS.authorize)}?${params.toString()}`

    // 로그인 시작 전 화면이 히스토리에 남지 않도록 replace 한다.
    location.replace(target)
  }

  function handleCallback(currentUrl?: string) {
    const url = new URL(currentUrl ?? location.href)
    const code = url.searchParams.get("code") ?? ""
    // Strict Mode 등으로 두 번 불려도 code 교환은 한 번만 한다.
    // 첫 호출이 OAuth 트랜잭션을 지우므로 두 번째 호출은 항상 state 불일치가 된다.
    let flight = callbackFlights.get(code)
    if (!flight) {
      flight = exchangeCode(url)
      callbackFlights.set(code, flight)
    }
    return flight
  }

  async function exchangeCode(url: URL): Promise<CallbackResult> {
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const storedState = sessionStorage.getItem(keys.state)
    const codeVerifier = sessionStorage.getItem(keys.codeVerifier)
    const returnTo = safeReturnTo(sessionStorage.getItem(keys.returnTo))
    clearOauthTransaction()

    if (
      !code ||
      !state ||
      !storedState ||
      storedState !== state ||
      !codeVerifier
    ) {
      throw new ApiError(
        "로그인 상태가 일치하지 않습니다.",
        400,
        "SSO_STATE_MISMATCH",
      )
    }

    try {
      const tokens = await readApiResult<TokenResponse>(
        await fetchImpl(apiUrl(config.apiBaseUrl, SSO_ENDPOINTS.token), {
          body: new URLSearchParams({
            client_id: config.clientId,
            code,
            code_verifier: codeVerifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri(),
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        }),
      )
      setTokens(validTokens(tokens))
      return { returnTo, status: "success" }
    } catch (error) {
      if (error instanceof ApiError && isAuthCodeRestart(error.code)) {
        await startLogin(returnTo)
        return { status: "restarting" }
      }
      throw error
    }
  }

  async function hasSsoSession() {
    const response = await fetchImpl(
      apiUrl(config.apiBaseUrl, SSO_ENDPOINTS.ssoMe),
      {
        credentials: "include",
        method: "GET",
      },
    )
    if (response.status === 401) {
      return false
    }
    await readApiResult(response)
    return true
  }

  async function devLogin(email: string, password: string, returnTo?: string) {
    if (config.loginMode !== "direct") {
      throw new ApiError(
        "direct 모드에서만 개발 로그인을 사용할 수 있습니다.",
        400,
        "SSO_DIRECT_ONLY",
      )
    }
    await readApiResult(
      await fetchImpl(apiUrl(config.apiBaseUrl, SSO_ENDPOINTS.ssoEmail), {
        body: JSON.stringify({ email, password }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    )
    await startLogin(returnTo)
  }

  async function logout(logoutOptions?: LogoutOptions) {
    const refreshToken = getRefreshToken()
    // 폐기 요청이 실패해도 로컬 세션은 끊는다.
    if (refreshToken) {
      await postJson(SSO_ENDPOINTS.logout, { refreshToken }).catch(() => {})
    }
    // direct 모드에는 SSO 쿠키를 지워 줄 인증 앱이 없으므로 직접 끊는다.
    if (logoutOptions?.global && config.loginMode === "direct") {
      await fetchImpl(apiUrl(config.apiBaseUrl, SSO_ENDPOINTS.ssoLogout), {
        credentials: "include",
        method: "POST",
      }).catch(() => {})
    }
    clearSession()

    if (!logoutOptions?.global) {
      return
    }
    const returnTo = logoutOptions.returnTo ?? location.origin
    if (config.loginMode === "direct") {
      location.replace(returnTo)
      return
    }
    const url = new URL(authAppPath("/logout"))
    url.searchParams.set("return_to", returnTo)
    // 로그아웃 전 보호 화면이 뒤로가기로 다시 열리지 않게 한다.
    location.replace(url.toString())
  }

  function requestRenew() {
    // refresh token이 회전되므로 탭 간에도 한 번에 하나만 갱신한다.
    // 잠금을 얻은 뒤 저장소를 다시 읽어, 앞 탭이 회전한 최신 토큰을 쓴다.
    return renewLock(keys.renewLock, async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) {
        clearSession()
        throw new ApiError(
          "refresh token이 없습니다.",
          401,
          "AUTHENTICATION-0032",
        )
      }
      try {
        const tokens = validTokens(
          await readApiResult<TokenPair>(
            await postJson(SSO_ENDPOINTS.renew, { refreshToken }),
          ),
        )
        setTokens(tokens)
        return tokens.accessToken
      } catch (error) {
        // 그사이 다른 곳에서 새 토큰을 저장했다면 그 세션은 살린다.
        if (getRefreshToken() === refreshToken) {
          clearSession()
        }
        throw error
      }
    })
  }

  function renewAccessToken() {
    if (!renewFlight) {
      renewFlight = requestRenew().finally(() => {
        renewFlight = null
      })
    }
    return renewFlight
  }

  function recoverFromUnauthorized() {
    if (!recoverFlight) {
      recoverFlight = (async () => {
        try {
          return await renewAccessToken()
        } catch (error) {
          if (options.onUnauthenticated === "login") {
            await startLogin(currentAppPath(location.href))
          }
          if (error instanceof ApiError) {
            throw new ApiError(error.message, 401, error.code)
          }
          throw new ApiError("인증이 만료되었습니다.", 401)
        } finally {
          recoverFlight = null
        }
      })()
    }
    return recoverFlight
  }

  function createApiFetch(): ApiFetch {
    return async function apiFetch<T>(path: string, init?: RequestInit) {
      const url = resolveRequestUrl(config.apiBaseUrl, path)
      let response = await fetchImpl(url, withBearer(init, accessToken))
      if (response.status === 401 && !isAuthEndpoint(url)) {
        const token = await recoverFromUnauthorized()
        response = await fetchImpl(url, withBearer(init, token))
      }
      return readApiResult<T>(response)
    }
  }

  function postJson(path: string, body: unknown) {
    return fetchImpl(apiUrl(config.apiBaseUrl, path), {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  }

  return {
    clearSession,
    config,
    createApiFetch,
    devLogin,
    getAccessToken,
    getRefreshToken,
    handleCallback,
    hasSsoSession,
    logout,
    recoverFromUnauthorized,
    renewAccessToken,
    setTokens,
    startLogin,
  }
}

function validTokens(tokens: Partial<TokenPair> | null | undefined) {
  if (!tokens?.accessToken || !tokens.refreshToken) {
    throw new ApiError("토큰 응답이 올바르지 않습니다.", 401)
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
}

function browserLocation(): AuthLocation {
  return {
    assign(url: string) {
      window.location.assign(url)
    },
    get href() {
      return window.location.href
    },
    get origin() {
      return window.location.origin
    },
    replace(url: string) {
      window.location.replace(url)
    },
  }
}

function browserRenewLock(): RenewLock {
  return (name, task) => {
    const locks =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Partial<Navigator>).locks
    if (!locks) {
      return task()
    }
    // 콜백이 돌려준 Promise가 끝날 때까지 잠금이 유지된다.
    return new Promise((resolve, reject) => {
      void locks.request(name, () => task().then(resolve, reject))
    })
  }
}

function resolveRequestUrl(apiBaseUrl: string, path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path
  }
  return apiUrl(apiBaseUrl, path)
}

function withBearer(
  init: RequestInit | undefined,
  token: string | null,
): RequestInit {
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  } else {
    headers.delete("Authorization")
  }
  return { ...init, headers }
}

function currentAppPath(href: string) {
  try {
    const url = new URL(href)
    return safeReturnTo(`${url.pathname}${url.search}`)
  } catch {
    return "/"
  }
}

function safeReturnTo(value: string | null | undefined) {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value
  }
  return "/"
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}
