# @umc-product/auth-client 활용 가이드

이 문서는 UMC 웹 앱에서 `@umc-product/auth-client`로 SSO를 붙이는 방법을 설명합니다.

패키지는 **인증**(로그인·토큰·갱신·로그아웃)만 담당합니다.  
**인가**(이 앱/화면에 들어와도 되는지)는 각 앱에서 구현합니다.

---

## 1. 설치

GitHub Packages의 `@umc-product` scope가 필요합니다.

앱 루트 `.npmrc`:

```
@umc-product:registry=https://npm.pkg.github.com
```

로컬/CI에 GitHub 토큰이 있어야 합니다 (`read:packages`).

```bash
pnpm add @umc-product/auth-client
```

```ts
import {
  createAuthClient,
  resolveAuthConfig,
  isAuthEndpoint,
  UnregisteredOriginError,
} from "@umc-product/auth-client"

// 로컬 direct 모드 개발 폼 (선택)
import { DevLoginForm } from "@umc-product/auth-client/react"
```

아직 패키지가 publish 되지 않았다면, 로컬에서 임시로 연결할 수 있습니다.

```bash
# auth-client 레포
pnpm build
pnpm link --global

# 소비 앱 레포
pnpm link --global @umc-product/auth-client
```

---

## 2. 연동 전에 준비할 것

1. 인증 서버에 이 앱의 **`clientId`** 등록  
   예: 백오피스 `backoffice`, 로컬 `local`
2. redirect URI 등록  
   기본 콜백 경로: `` `${앱 origin}/auth/callback` ``
3. 인증 앱(`umc-product-web-auth`)의 `return_to` 허용 origin에 이 앱 origin 추가
4. 앱에 `/login`, `/auth/callback` 라우트 구현

---

## 3. 앱 설정: origin 표 + 싱글톤

패키지의 `SSO_STAGES`가 API·Auth URL을 갖고 있습니다.  
앱은 **자기 origin allowlist**와 **`clientId`** 만 넘깁니다.

### 3.1 환경 해석 (앱 코드)

```ts
// 예: src/shared/auth/resolve-sso-env.ts
import {
  resolveAuthConfig,
  type AuthClientConfig,
  type SsoStage,
} from "@umc-product/auth-client"

const APP_ORIGINS: Record<string, SsoStage> = {
  "http://localhost:5173": "local",
  "https://dev.admin.university.neordinary.com": "dev",
  "https://admin.university.neordinary.com": "prod",
}

const CLIENT_IDS: Record<SsoStage, string> = {
  local: "local",
  dev: "backoffice",
  prod: "backoffice",
}

export function resolveSsoEnv(
  origin: string,
  local?: { authAppUrl?: string; loginMode?: string },
): AuthClientConfig {
  return resolveAuthConfig({
    origin,
    origins: APP_ORIGINS,
    clientIds: CLIENT_IDS,
    local, // local stage에서만 적용
  })
}

export function readLocalOverrides() {
  return {
    authAppUrl: import.meta.env.VITE_AUTH_APP_URL,
    loginMode: import.meta.env.VITE_SSO_LOGIN_MODE,
  }
}
```

| stage | API | Auth 앱 |
| --- | --- | --- |
| `local` | `""` (앱 프록시 `/api`) | `http://localhost:5174` (또는 env) |
| `dev` | `https://api-dev.university.neordinary.com` | `https://dev.auth.university.neordinary.com` |
| `prod` | `https://api.university.neordinary.com` | `https://auth.university.neordinary.com` |

표에 없는 origin이면 `UnregisteredOriginError`가 납니다. 앱에서 안내 화면으로 받으면 됩니다.

### 3.2 싱글톤 클라이언트

```ts
// 예: src/shared/auth/sso-client.ts
import { createAuthClient, type AuthClient } from "@umc-product/auth-client"
import { readLocalOverrides, resolveSsoEnv } from "./resolve-sso-env"

let client: AuthClient | null = null

export function getSsoClient() {
  if (!client) {
    client = createAuthClient(
      resolveSsoEnv(window.location.origin, readLocalOverrides()),
      { onUnauthenticated: "login" }, // 또는 "ignore"
    )
  }
  return client
}
```

`onUnauthenticated`:

- `"login"` — API 401 복구 실패 시 다시 로그인 시작 (일반 서비스 화면)
- `"ignore"` — 에러만 throw (특수 화면·테스트)

---

## 4. 로그인 / 콜백 라우트

### 4.1 `/login`

```ts
const client = getSsoClient()
const returnTo = search.redirect ?? "/" // 앱 기본 홈

if (client.config.loginMode === "auth-app") {
  await client.startLogin(returnTo)
  return
}

// direct (로컬 전용): 세션 있으면 authorize, 없으면 DevLoginForm
if (await client.hasSsoSession()) {
  await client.startLogin(returnTo)
} else {
  // <DevLoginForm onSubmit={({ email, password }) =>
  //   client.devLogin(email, password, returnTo)} />
}
```

- `returnTo`는 앱 안 상대 경로만 (`/`로 시작, `//` 금지).
- 배포 stage는 항상 `auth-app`입니다. `direct`는 localhost에서만 쓰세요.

### 4.2 `/auth/callback`

```ts
const result = await getSsoClient().handleCallback(window.location.href)

if (result.status === "success") {
  router.replace(result.returnTo) // history replace 권장
}
// status === "restarting" 이면 곧 재로그인으로 이동하므로 실패 UI를 띄우지 않음
```

같은 authorization code로 두 번 교환하지 않도록, Strict Mode에서는 클라이언트가 동일 code에 대해 한 번만 교환합니다.

---

## 5. API에 토큰 붙이기

### 방법 A — 패키지 `createApiFetch` (fetch만 쓰는 앱)

```ts
const apiFetch = getSsoClient().createApiFetch()
const me = await apiFetch<MyType>("/api/v2/member/me")
```

Bearer 부착 + 401 시 renew 후 1회 재시도가 들어 있습니다.

### 방법 B — axios 인터셉터 (백오피스 방식)

```ts
import { isAuthEndpoint } from "@umc-product/auth-client"

api.interceptors.request.use((config) => {
  const token = getSsoClient().getAccessToken()
  if (token) config.headers.set("Authorization", `Bearer ${token}`)
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status !== 401) throw error
    if (isAuthEndpoint(url) || config._retry) throw error
    config._retry = true
    const accessToken = await getSsoClient().recoverFromUnauthorized()
    config.headers.set("Authorization", `Bearer ${accessToken}`)
    return api.request(config)
  },
)
```

`isAuthEndpoint`로 SSO/로그아웃/renew URL 자체의 401은 재시도하지 않습니다.

---

## 6. 보호 라우트와 인가 (앱 책임)

```ts
// 토큰 없음 → 로그인
if (!client.getAccessToken() && !client.getRefreshToken()) {
  throw redirect({
    replace: true,
    to: "/login",
    search: { redirect: location.href },
  })
}

// 로그인 후 앱 권한 (예: 운영진만)
const session = await fetchMe()
if (!isAllowed(session)) {
  await client.logout() // 앱 토큰만 정리. 다른 앱 SSO까지 끊으려면 global: true
  // 안내 UI 또는 /login
}
```

| 하고 싶은 일 | 호출 |
| --- | --- |
| 이 앱 세션만 끊기 | `logout()` |
| SSO까지 끊고 다른 계정으로 | `logout({ global: true, returnTo: "https://앱/login" })` |

로그인·글로벌 로그아웃 이동은 패키지가 `location.replace`를 씁니다. 보호 화면이 뒤로가기로 다시 열리지 않게 하려는 의도입니다.

---

## 7. 자주 쓰는 API 요약

| 메서드 | 역할 |
| --- | --- |
| `startLogin(returnTo?)` | PKCE 준비 후 authorize로 이동 |
| `handleCallback(url?)` | code → 토큰 저장, `{ status, returnTo? }` |
| `devLogin(email, password, returnTo?)` | `direct` 전용 개발 로그인 |
| `hasSsoSession()` | SSO 세션 존재 여부 |
| `getAccessToken` / `getRefreshToken` | 현재 토큰 |
| `renewAccessToken` | refresh로 access 갱신 |
| `recoverFromUnauthorized` | 401 복구 (+ 정책에 따라 재로그인) |
| `createApiFetch` | Bearer + 401 재시도 fetch |
| `logout(options?)` | 서버 폐기 + 로컬 정리 (+ optional global) |
| `clearSession` | 로컬만 비움 |
| `resolveAuthConfig` | origin 표 → `AuthClientConfig` |
| `isAuthEndpoint(url)` | 인증 API URL인지 |

실패 시 `ApiError` (`message`, `status`, optional `code`).

---

## 8. 로컬 env (앱만)

패키지는 env를 읽지 않습니다. 앱 `.env` 예:

```bash
# localhost 인증 앱 주소 (기본 http://localhost:5174)
# VITE_AUTH_APP_URL=http://localhost:5174

# localhost 로그인 방식. 기본 auth-app. 개발 폼은 direct
# VITE_SSO_LOGIN_MODE=auth-app
# VITE_SSO_LOGIN_MODE=direct

# Vite 프록시 대상 (apiBaseUrl이 빈 문자열일 때)
# VITE_DEV_API_PROXY_TARGET=https://api-dev.university.neordinary.com
```

배포(`dev.*` / prod 호스트)는 origin만으로 stage가 정해지므로 위 env가 없어도 됩니다.

---

## 9. 체크리스트

- [ ] `clientId` + callback URI 인증 서버 등록
- [ ] 인증 앱 `return_to` 허용 origin 등록
- [ ] 앱 origin 표 / clientId 표 작성
- [ ] `createAuthClient` 싱글톤
- [ ] `/login` → `startLogin` (또는 `devLogin`)
- [ ] `/auth/callback` → `handleCallback` 후 `replace`
- [ ] API Bearer + 401 → `recoverFromUnauthorized` (또는 `createApiFetch`)
- [ ] 보호 라우트에서 비로그인 → `/login?redirect=...` (`replace`)
- [ ] **앱 인가** (필요 시). 패키지에 넣지 않음

---

## 10. 하지 말 것

- 패키지 안에 “운영진만 통과” 같은 인가 규칙 넣기
- 다른 앱의 origin/`clientId` 표를 그대로 복사하기
- 배포 빌드에서 `loginMode: "direct"` 쓰기
- 패키지가 `import.meta.env`를 읽게 만들기 (앱에서 주입)

백오피스 구현 예시는 `umc-product-web-operations`의 `src/shared/auth`, `src/routes/login.tsx`, `src/routes/auth/callback.tsx`, `src/shared/api/client.ts`를 참고하면 됩니다.
