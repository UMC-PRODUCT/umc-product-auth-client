import { ApiError } from "./api-error"

type ErrorFields = {
  code?: string
  message?: string
}

type Envelope = ErrorFields & {
  result?: unknown
  success?: boolean
}

export function apiUrl(apiBaseUrl: string, path: string) {
  const base = apiBaseUrl.replace(/\/+$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

export async function readApiResult<T>(response: Response): Promise<T> {
  const body = await readBody(response)
  const fields = errorFields(body)

  if (!response.ok) {
    throw new ApiError(
      fields.message ?? "요청에 실패했습니다.",
      response.status,
      fields.code,
    )
  }

  if (isEnvelope(body)) {
    if (body.success === false) {
      throw new ApiError(
        fields.message ?? "요청에 실패했습니다.",
        response.status,
        fields.code,
      )
    }
    return body.result as T
  }

  return body as T
}

async function readBody(response: Response) {
  const text = await response.text()
  if (text.trim() === "") {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    value !== null &&
    typeof value === "object" &&
    "success" in value &&
    "result" in value
  )
}

function errorFields(value: unknown): ErrorFields {
  if (value === null || typeof value !== "object") {
    return {}
  }
  const record = value as Record<string, unknown>
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  }
}
