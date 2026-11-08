export type LoginMode = "auth-app" | "direct"

export type UnauthenticatedPolicy = "ignore" | "login"

export type AuthClientConfig = {
  apiBaseUrl: string
  authAppUrl: string
  clientId: string
  loginMode: LoginMode
  /**
   * 기본 `/auth/callback`. redirect_uri는 항상 현재 origin + 이 경로이며,
   * 인증 서버에도 같은 값으로 등록되어 있어야 한다.
   */
  callbackPath?: string
  /** 기본 `umc.sso`. 같은 origin에 앱이 둘 이상이면 앱마다 다르게 준다. */
  storagePrefix?: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
}

export type TokenResponse = TokenPair & {
  expiresIn?: number
  linkedOAuthProviders?: string[]
  tokenType?: string
}

export type AuthLocation = {
  origin: string
  href: string
  assign: (url: string) => void
  replace: (url: string) => void
}

export type RenewLock = <T>(name: string, task: () => Promise<T>) => Promise<T>

export type AuthClientDeps = {
  fetch?: typeof fetch
  location?: AuthLocation
  /** 탭 간 토큰 갱신 직렬화. 기본은 Web Locks API, 없으면 잠그지 않는다. */
  renewLock?: RenewLock
}

export type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>

export type CallbackResult =
  | { status: "success"; returnTo: string }
  /** 인가 코드가 만료·재사용되어 로그인을 다시 시작했다. 곧 페이지가 이동한다. */
  | { status: "restarting" }

export type LogoutOptions = {
  /**
   * SSO 세션까지 끊는다. auth-app 모드는 인증 앱 `/logout`으로, direct 모드는
   * SSO 로그아웃 API를 직접 호출한 뒤 `returnTo`로 이동한다.
   */
  global?: boolean
  /** global 로그아웃 후 도착할 절대 URL. 없으면 현재 origin. */
  returnTo?: string
}

export type AuthClient = {
  config: AuthClientConfig
  clearSession: () => void
  createApiFetch: () => ApiFetch
  devLogin: (
    email: string,
    password: string,
    returnTo?: string,
  ) => Promise<void>
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  /** 같은 인가 코드로 여러 번 호출해도 토큰 교환은 한 번만 한다. */
  handleCallback: (currentUrl?: string) => Promise<CallbackResult>
  hasSsoSession: () => Promise<boolean>
  logout: (options?: LogoutOptions) => Promise<void>
  recoverFromUnauthorized: () => Promise<string>
  renewAccessToken: () => Promise<string>
  setTokens: (tokens: TokenPair) => void
  startLogin: (returnTo?: string) => Promise<void>
}
