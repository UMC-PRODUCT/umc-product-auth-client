export const SSO_ENDPOINTS = {
  authorize: "/api/v1/auth/sso/oauth/authorize",
  logout: "/api/v1/auth/logout",
  renew: "/api/v1/auth/token/renew",
  ssoEmail: "/api/v1/auth/sso/email",
  ssoLogout: "/api/v1/auth/sso/logout",
  ssoMe: "/api/v1/auth/sso/me",
  token: "/api/v1/auth/sso/oauth/token",
} as const

/** base URL이 `/api`를 포함하든 아니든 걸리도록 `/v1/...` 기준으로 비교한다. */
const AUTH_PATH_MARKERS = [
  "/v1/auth/token/renew",
  "/v1/auth/sso/",
  "/v1/auth/logout",
] as const

/** 401이 나도 토큰 갱신·재시도를 하면 안 되는 인증 API인지 판별한다. */
export function isAuthEndpoint(url: string) {
  return AUTH_PATH_MARKERS.some((marker) => url.includes(marker))
}
