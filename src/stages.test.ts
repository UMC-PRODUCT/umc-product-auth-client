import { describe, expect, it } from "vitest"

import { resolveAuthConfig, UnregisteredOriginError } from "./stages"

const ORIGINS = {
  "http://localhost:3000": "local",
  "https://dev.app.example": "dev",
  "https://app.example": "prod",
} as const

const CLIENT_IDS = { dev: "app", local: "app-local", prod: "app" } as const

describe("resolveAuthConfig", () => {
  it("defaults to auth-app mode and the local auth app on a local origin", () => {
    expect(
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        origin: "http://localhost:3000",
        origins: ORIGINS,
      }),
    ).toEqual({
      apiBaseUrl: "",
      authAppUrl: "http://localhost:5174",
      clientId: "app-local",
      loginMode: "auth-app",
    })
  })

  it("applies local overrides only on the local stage", () => {
    const local = {
      authAppUrl: "http://localhost:4174",
      loginMode: "direct",
    }

    expect(
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        local,
        origin: "http://localhost:3000",
        origins: ORIGINS,
      }),
    ).toMatchObject({
      authAppUrl: "http://localhost:4174",
      loginMode: "direct",
    })
    expect(
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        local,
        origin: "https://app.example",
        origins: ORIGINS,
      }),
    ).toEqual({
      apiBaseUrl: "https://api.university.neordinary.com",
      authAppUrl: "https://auth.university.neordinary.com",
      clientId: "app",
      loginMode: "auth-app",
    })
  })

  it("uses the shared dev stage urls", () => {
    expect(
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        origin: "https://dev.app.example",
        origins: ORIGINS,
      }),
    ).toMatchObject({
      apiBaseUrl: "https://api-dev.university.neordinary.com",
      authAppUrl: "https://dev.auth.university.neordinary.com",
    })
  })

  it("passes callbackPath and storagePrefix through", () => {
    expect(
      resolveAuthConfig({
        callbackPath: "/sso/callback",
        clientIds: CLIENT_IDS,
        origin: "https://app.example",
        origins: ORIGINS,
        storagePrefix: "umc.app",
      }),
    ).toMatchObject({
      callbackPath: "/sso/callback",
      storagePrefix: "umc.app",
    })
  })

  it("throws UnregisteredOriginError for an unknown origin", () => {
    expect(() =>
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        origin: "https://evil.example",
        origins: ORIGINS,
      }),
    ).toThrow(UnregisteredOriginError)
  })

  it("rejects an invalid local login mode", () => {
    expect(() =>
      resolveAuthConfig({
        clientIds: CLIENT_IDS,
        local: { loginMode: "popup" },
        origin: "http://localhost:3000",
        origins: ORIGINS,
      }),
    ).toThrow(/loginMode/)
  })
})
