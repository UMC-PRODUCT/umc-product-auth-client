import { describe, expect, it } from "vitest"

import { isAuthEndpoint } from "./endpoints"

describe("isAuthEndpoint", () => {
  it("matches renew, sso and logout paths with or without /api", () => {
    expect(isAuthEndpoint("/api/v1/auth/token/renew")).toBe(true)
    expect(isAuthEndpoint("/v1/auth/sso/email")).toBe(true)
    expect(
      isAuthEndpoint(
        "https://api.university.neordinary.com/api/v1/auth/logout",
      ),
    ).toBe(true)
  })

  it("does not match business apis", () => {
    expect(isAuthEndpoint("/api/v2/member/me")).toBe(false)
    expect(isAuthEndpoint("/api/v1/notices")).toBe(false)
  })
})
