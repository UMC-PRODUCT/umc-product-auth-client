import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./api-error"
import { createAuthClient } from "./create-auth-client"
import { createStorageKeys } from "./storage-keys"

import type { AuthClientConfig, AuthLocation, RenewLock } from "./types"

const KEYS = createStorageKeys()

const LOCAL: AuthClientConfig = {
  apiBaseUrl: "",
  authAppUrl: "http://localhost:5174",
  clientId: "local",
  loginMode: "direct",
}

const PROD: AuthClientConfig = {
  apiBaseUrl: "https://api.university.neordinary.com",
  authAppUrl: "https://auth.university.neordinary.com",
  clientId: "backoffice",
  loginMode: "auth-app",
}

function location(origin: string, href = `${origin}/`): AuthLocation {
  return {
    assign: vi.fn(),
    href,
    origin,
    replace: vi.fn(),
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

function envelope(result: unknown, status = 200, code = "OK") {
  return jsonResponse(
    {
      code,
      message: code,
      result,
      success: status < 400,
    },
    status,
  )
}

function replacedUrl(browser: AuthLocation) {
  const target = String(vi.mocked(browser.replace).mock.calls[0]?.[0])
  return new URL(target, browser.origin)
}

function seedTransaction(state = "state-1", verifier = "verifier-1") {
  sessionStorage.setItem(KEYS.state, state)
  sessionStorage.setItem(KEYS.codeVerifier, verifier)
  sessionStorage.setItem(KEYS.returnTo, "/notices")
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe("startLogin", () => {
  it("sends the browser to the api authorize url in direct mode", async () => {
    const browser = location("http://localhost:5173")
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { location: browser },
    )

    await client.startLogin("/notices")

    const url = replacedUrl(browser)
    expect(url.pathname).toBe("/api/v1/auth/sso/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("local")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/callback",
    )
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_verifier")).toBeNull()
    expect(sessionStorage.getItem(KEYS.returnTo)).toBe("/notices")
    expect(sessionStorage.getItem(KEYS.codeVerifier)).toBeTruthy()
  })

  it("sends the browser to the auth app in auth-app mode", async () => {
    const browser = location("https://admin.university.neordinary.com")
    const client = createAuthClient(
      PROD,
      { onUnauthenticated: "login" },
      { location: browser },
    )

    await client.startLogin()

    const url = replacedUrl(browser)
    expect(url.origin).toBe("https://auth.university.neordinary.com")
    expect(url.pathname).toBe("/authorize")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://admin.university.neordinary.com/auth/callback",
    )
    expect(url.searchParams.get("client_id")).toBe("backoffice")
  })

  it("uses the configured callback path and storage prefix", async () => {
    const browser = location("https://admin.university.neordinary.com")
    const client = createAuthClient(
      { ...PROD, callbackPath: "/sso/callback", storagePrefix: "umc.admin" },
      { onUnauthenticated: "login" },
      { location: browser },
    )

    await client.startLogin("/notices")

    expect(replacedUrl(browser).searchParams.get("redirect_uri")).toBe(
      "https://admin.university.neordinary.com/sso/callback",
    )
    expect(sessionStorage.getItem("umc.admin.returnTo")).toBe("/notices")
    expect(sessionStorage.getItem(KEYS.returnTo)).toBeNull()
  })

  it("keeps a base path on the auth app url", async () => {
    const browser = location("https://admin.university.neordinary.com")
    const client = createAuthClient(
      { ...PROD, authAppUrl: "https://example.test/auth/" },
      { onUnauthenticated: "login" },
      { location: browser },
    )

    await client.startLogin()

    expect(replacedUrl(browser).pathname).toBe("/auth/authorize")
  })

  it("falls back to / for a return path that leaves the app", async () => {
    const browser = location("http://localhost:5173")
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { location: browser },
    )

    await client.startLogin("//evil.example/steal")

    expect(sessionStorage.getItem(KEYS.returnTo)).toBe("/")
  })
})

describe("handleCallback", () => {
  it("does not call the token api when state does not match", async () => {
    const fetchMock = vi.fn()
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: location("http://localhost:5173") },
    )
    seedTransaction("expected", "verifier")

    await expect(
      client.handleCallback(
        "http://localhost:5173/auth/callback?code=abc&state=other",
      ),
    ).rejects.toMatchObject({ code: "SSO_STATE_MISMATCH" })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(KEYS.state)).toBeNull()
    expect(sessionStorage.getItem(KEYS.codeVerifier)).toBeNull()
    expect(sessionStorage.getItem(KEYS.returnTo)).toBeNull()
  })

  it.each(["AUTHENTICATION-0034", "AUTHENTICATION-0035"])(
    "restarts login when the token api returns %s",
    async (code) => {
      const browser = location("http://localhost:5173")
      const fetchMock = vi.fn(async () => envelope(null, 401, code))
      const client = createAuthClient(
        LOCAL,
        { onUnauthenticated: "ignore" },
        { fetch: fetchMock, location: browser },
      )
      seedTransaction()

      await expect(
        client.handleCallback(
          "http://localhost:5173/auth/callback?code=once&state=state-1",
        ),
      ).resolves.toEqual({ status: "restarting" })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(browser.replace).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem(KEYS.state)).not.toBe("state-1")
      expect(sessionStorage.getItem(KEYS.codeVerifier)).not.toBe("verifier-1")
      expect(sessionStorage.getItem(KEYS.codeVerifier)).toBeTruthy()
    },
  )

  it("stores tokens and clears the oauth transaction", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/x-www-form-urlencoded",
        })
        const body = new URLSearchParams(String(init?.body))
        expect(body.get("grant_type")).toBe("authorization_code")
        expect(body.get("code")).toBe("once")
        expect(body.get("code_verifier")).toBe("verifier-1")
        expect(body.get("redirect_uri")).toBe(
          "http://localhost:5173/auth/callback",
        )
        return envelope({ accessToken: "access-1", refreshToken: "refresh-1" })
      },
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: location("http://localhost:5173") },
    )
    seedTransaction()

    await expect(
      client.handleCallback(
        "http://localhost:5173/auth/callback?code=once&state=state-1",
      ),
    ).resolves.toEqual({ returnTo: "/notices", status: "success" })

    expect(client.getAccessToken()).toBe("access-1")
    expect(localStorage.getItem(KEYS.refreshToken)).toBe("refresh-1")
    expect(sessionStorage.getItem(KEYS.state)).toBeNull()
    expect(sessionStorage.getItem(KEYS.codeVerifier)).toBeNull()
    expect(sessionStorage.getItem(KEYS.returnTo)).toBeNull()
  })

  it("exchanges the same code only once when called twice", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({ accessToken: "access-1", refreshToken: "refresh-1" }),
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: location("http://localhost:5173") },
    )
    seedTransaction()
    const url = "http://localhost:5173/auth/callback?code=once&state=state-1"

    const [first, second] = await Promise.all([
      client.handleCallback(url),
      client.handleCallback(url),
    ])

    expect(first).toEqual({ returnTo: "/notices", status: "success" })
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("logout", () => {
  it("revokes the refresh token and goes to the auth app in auth-app mode", async () => {
    const browser = location("https://admin.university.neordinary.com")
    const fetchMock = vi.fn<typeof fetch>(async () => envelope(null))
    const client = createAuthClient(
      PROD,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await client.logout({
      global: true,
      returnTo: "https://admin.university.neordinary.com/login",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.university.neordinary.com/api/v1/auth/logout",
    )
    const url = replacedUrl(browser)
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://auth.university.neordinary.com/logout",
    )
    expect(url.searchParams.get("return_to")).toBe(
      "https://admin.university.neordinary.com/login",
    )
    expect(client.getAccessToken()).toBeNull()
    expect(client.getRefreshToken()).toBeNull()
  })

  it("ends the sso session itself in direct mode", async () => {
    const browser = location("http://localhost:5173")
    const fetchMock = vi.fn<typeof fetch>(async () => envelope(null))
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await client.logout({
      global: true,
      returnTo: "http://localhost:5173/login",
    })

    const calls = fetchMock.mock.calls
    expect(calls.map(([url]) => String(url))).toEqual([
      "/api/v1/auth/logout",
      "/api/v1/auth/sso/logout",
    ])
    expect(calls[1]?.[1]?.credentials).toBe("include")
    expect(browser.replace).toHaveBeenCalledWith("http://localhost:5173/login")
    expect(client.getRefreshToken()).toBeNull()
  })

  it("only clears the local session without global", async () => {
    const browser = location("http://localhost:5173")
    const fetchMock = vi.fn(async () => envelope(null))
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await client.logout()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(browser.replace).not.toHaveBeenCalled()
    expect(client.getRefreshToken()).toBeNull()
  })

  it("clears the session even when the revoke request fails", async () => {
    const client = createAuthClient(
      PROD,
      { onUnauthenticated: "login" },
      {
        fetch: vi.fn(async () => {
          throw new TypeError("network")
        }),
        location: location("https://admin.university.neordinary.com"),
      },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await client.logout()

    expect(client.getAccessToken()).toBeNull()
    expect(client.getRefreshToken()).toBeNull()
  })
})

describe("renewAccessToken", () => {
  it("renews under the shared lock with the latest stored refresh token", async () => {
    const lockNames: string[] = []
    const renewLock: RenewLock = (name, task) => {
      lockNames.push(name)
      // 다른 탭이 잠금을 먼저 잡고 토큰을 회전시킨 상황
      localStorage.setItem(KEYS.refreshToken, "refresh-rotated")
      return task()
    }
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          refreshToken: "refresh-rotated",
        })
        return envelope({ accessToken: "access-2", refreshToken: "refresh-2" })
      },
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      {
        fetch: fetchMock,
        location: location("http://localhost:5173"),
        renewLock,
      },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(client.renewAccessToken()).resolves.toBe("access-2")

    expect(lockNames).toEqual([KEYS.renewLock])
    expect(client.getRefreshToken()).toBe("refresh-2")
  })

  it("clears the session when renew fails", async () => {
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      {
        fetch: vi.fn(async () => envelope(null, 401, "AUTHENTICATION-0032")),
        location: location("http://localhost:5173"),
      },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(client.renewAccessToken()).rejects.toBeInstanceOf(ApiError)

    expect(client.getAccessToken()).toBeNull()
    expect(client.getRefreshToken()).toBeNull()
  })

  it("keeps a session that another tab saved while renewing", async () => {
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      {
        fetch: vi.fn(async () => {
          localStorage.setItem(KEYS.refreshToken, "refresh-other-tab")
          return envelope(null, 401, "AUTHENTICATION-0033")
        }),
        location: location("http://localhost:5173"),
      },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(client.renewAccessToken()).rejects.toBeInstanceOf(ApiError)

    expect(client.getRefreshToken()).toBe("refresh-other-tab")
  })

  it("drops the access token when another tab removes the refresh token", () => {
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { location: location("http://localhost:5173") },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    window.dispatchEvent(
      new StorageEvent("storage", { key: KEYS.refreshToken, newValue: null }),
    )

    expect(client.getAccessToken()).toBeNull()
  })
})

describe("hasSsoSession", () => {
  it("is false on 401 and true on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(null, 401, "AUTHENTICATION-0001"))
      .mockResolvedValueOnce(envelope({ memberId: 1 }))
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: location("http://localhost:5173") },
    )

    await expect(client.hasSsoSession()).resolves.toBe(false)
    await expect(client.hasSsoSession()).resolves.toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    })
  })
})

describe("devLogin", () => {
  it("is rejected outside direct mode", async () => {
    const fetchMock = vi.fn()
    const client = createAuthClient(
      PROD,
      { onUnauthenticated: "login" },
      {
        fetch: fetchMock,
        location: location("https://admin.university.neordinary.com"),
      },
    )

    await expect(client.devLogin("a@b.c", "pw")).rejects.toMatchObject({
      code: "SSO_DIRECT_ONLY",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("logs in by email and then starts the authorize flow", async () => {
    const browser = location("http://localhost:5173")
    const fetchMock = vi.fn<typeof fetch>(async () => envelope({ memberId: 1 }))
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: browser },
    )

    await client.devLogin("a@b.c", "pw", "/notices")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/auth/sso/email")
    expect(replacedUrl(browser).pathname).toBe(
      "/api/v1/auth/sso/oauth/authorize",
    )
    expect(sessionStorage.getItem(KEYS.returnTo)).toBe("/notices")
  })
})

describe("createApiFetch", () => {
  it("renews once for three concurrent 401 responses", async () => {
    const browser = location(
      "http://localhost:5173",
      "http://localhost:5173/notices",
    )
    let renewCount = 0
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/token/renew")) {
          renewCount += 1
          const body = JSON.parse(String(init?.body)) as {
            refreshToken?: string
          }
          expect(body.refreshToken).toBe("refresh-1")
          return envelope({
            accessToken: "access-2",
            refreshToken: "refresh-2",
          })
        }
        const authorization = new Headers(init?.headers).get("Authorization")
        if (authorization === "Bearer access-2") {
          return envelope({ ok: true })
        }
        return envelope(null, 401, "AUTHENTICATION-0032")
      },
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })
    const apiFetch = client.createApiFetch()

    const results = await Promise.all([
      apiFetch("/api/v1/notices"),
      apiFetch("/api/v1/notices"),
      apiFetch("/api/v1/notices"),
    ])

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(renewCount).toBe(1)
    expect(client.getRefreshToken()).toBe("refresh-2")
    expect(browser.replace).not.toHaveBeenCalled()
  })

  it("starts login when renew fails and the policy is login", async () => {
    const browser = location(
      "http://localhost:5173",
      "http://localhost:5173/notices",
    )
    const fetchMock = vi.fn(async () =>
      envelope(null, 401, "AUTHENTICATION-0032"),
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(
      client.createApiFetch()("/api/v1/notices"),
    ).rejects.toBeInstanceOf(ApiError)

    expect(browser.replace).toHaveBeenCalledTimes(1)
    expect(client.getRefreshToken()).toBeNull()
  })

  it("throws a 401 ApiError without starting login when the policy is ignore", async () => {
    const browser = location("http://localhost:5173")
    const fetchMock = vi.fn(async () =>
      envelope(null, 401, "AUTHENTICATION-0032"),
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "ignore" },
      { fetch: fetchMock, location: browser },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(
      client.createApiFetch()("/api/v1/notices"),
    ).rejects.toMatchObject({
      code: "AUTHENTICATION-0032",
      name: "ApiError",
      status: 401,
    })
    expect(browser.replace).not.toHaveBeenCalled()
  })

  it("does not renew when an auth endpoint itself returns 401", async () => {
    const fetchMock = vi.fn(async () =>
      envelope(null, 401, "AUTHENTICATION-0001"),
    )
    const client = createAuthClient(
      LOCAL,
      { onUnauthenticated: "login" },
      { fetch: fetchMock, location: location("http://localhost:5173") },
    )
    client.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" })

    await expect(
      client.createApiFetch()("/api/v1/auth/sso/me"),
    ).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.getRefreshToken()).toBe("refresh-1")
  })
})
