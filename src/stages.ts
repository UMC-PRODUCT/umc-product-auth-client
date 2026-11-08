import type { AuthClientConfig, LoginMode } from "./types"

export type SsoStage = "local" | "dev" | "prod"

export const SSO_STAGES = {
  local: {
    apiBaseUrl: "",
    authAppUrl: "http://localhost:5174",
  },
  dev: {
    apiBaseUrl: "https://api-dev.university.neordinary.com",
    authAppUrl: "https://dev.auth.university.neordinary.com",
  },
  prod: {
    apiBaseUrl: "https://api.university.neordinary.com",
    authAppUrl: "https://auth.university.neordinary.com",
  },
} as const satisfies Record<
  SsoStage,
  { apiBaseUrl: string; authAppUrl: string }
>

export class UnregisteredOriginError extends Error {
  readonly origin: string

  constructor(origin: string) {
    super(`SSO를 시작할 수 없는 origin입니다: ${origin}`)
    this.name = "UnregisteredOriginError"
    this.origin = origin
  }
}

export type ResolveAuthConfigInput = {
  origin: string
  /** 이 앱이 SSO를 허용하는 origin(scheme + host + port) → stage. */
  origins: Readonly<Record<string, SsoStage>>
  /** 인증 서버에 등록된 이 앱의 client_id. */
  clientIds: Readonly<Record<SsoStage, string>>
  /** local stage에서만 적용한다. 배포 stage는 표의 값으로 고정한다. */
  local?: { authAppUrl?: string; loginMode?: string }
  callbackPath?: string
  storagePrefix?: string
}

export function resolveSsoStage(
  origin: string,
  origins: ResolveAuthConfigInput["origins"],
): SsoStage {
  const stage = origins[origin]
  if (!stage) {
    throw new UnregisteredOriginError(origin)
  }
  return stage
}

export function resolveAuthConfig(
  input: ResolveAuthConfigInput,
): AuthClientConfig {
  const stage = resolveSsoStage(input.origin, input.origins)
  const urls = SSO_STAGES[stage]
  const shared = {
    apiBaseUrl: urls.apiBaseUrl,
    callbackPath: input.callbackPath,
    clientId: input.clientIds[stage],
    storagePrefix: input.storagePrefix,
  }

  if (stage === "local") {
    return {
      ...shared,
      authAppUrl: present(input.local?.authAppUrl) ?? urls.authAppUrl,
      loginMode: localLoginMode(input.local?.loginMode),
    }
  }

  return { ...shared, authAppUrl: urls.authAppUrl, loginMode: "auth-app" }
}

function localLoginMode(value: string | undefined): LoginMode {
  const mode = present(value)
  if (mode == null || mode === "auth-app") {
    return "auth-app"
  }
  if (mode === "direct") {
    return "direct"
  }
  throw new Error(`SSO loginMode 값이 올바르지 않습니다: ${mode}`)
}

function present(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
