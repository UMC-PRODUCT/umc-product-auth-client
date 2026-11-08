export const DEFAULT_STORAGE_PREFIX = "umc.sso"

export type SsoStorageKeys = ReturnType<typeof createStorageKeys>

export function createStorageKeys(prefix = DEFAULT_STORAGE_PREFIX) {
  return {
    codeVerifier: `${prefix}.codeVerifier`,
    refreshToken: `${prefix}.refreshToken`,
    renewLock: `${prefix}.renew`,
    returnTo: `${prefix}.returnTo`,
    state: `${prefix}.state`,
  } as const
}
