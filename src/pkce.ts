const PKCE_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

export function createRandomString(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let value = ""
  for (const byte of bytes) {
    value += PKCE_CHARSET[byte % PKCE_CHARSET.length] ?? "A"
  }
  return value
}

export function createCodeVerifier() {
  return createRandomString(64)
}

export async function createCodeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  )
  return base64UrlEncode(digest)
}

function base64UrlEncode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}
