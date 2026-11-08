import { describe, expect, it } from "vitest"

import { createCodeChallenge } from "./pkce"

describe("createCodeChallenge", () => {
  it("matches the RFC 7636 appendix B vector", async () => {
    await expect(
      createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
})
