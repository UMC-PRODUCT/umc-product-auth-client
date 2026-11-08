export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export function isAuthCodeRestart(code: string | undefined) {
  return code === "AUTHENTICATION-0034" || code === "AUTHENTICATION-0035"
}
