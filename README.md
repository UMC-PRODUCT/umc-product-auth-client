# @umc-product/auth-client

UMC 웹 앱 공통 SSO 클라이언트입니다.

- PKCE authorize / callback 토큰 교환
- access·refresh 토큰 갱신·로그아웃
- `local` / `dev` / `prod` stage URL 표 (`SSO_STAGES`, `resolveAuthConfig`)
- (선택) `DevLoginForm` — `loginMode: "direct"` 로컬 개발용

## 문서

- **[활용 가이드](./docs/usage.md)** — 설치, 싱글톤, 로그인/콜백, API 연동, 인가 경계

## Install

GitHub Packages (`@umc-product`) 인증이 필요합니다.

```bash
pnpm add @umc-product/auth-client
```

```ts
import {
  createAuthClient,
  resolveAuthConfig,
} from "@umc-product/auth-client"
```

React 개발 로그인 폼:

```ts
import { DevLoginForm } from "@umc-product/auth-client/react"
```

## 앱에서 넣는 것

패키지는 **인증**만 담당합니다. 아래는 앱에 둡니다.

- origin → stage / `clientId` 표
- `/login`, `/auth/callback` 라우트
- 인가(운영진 여부 등), 제품 UI

로컬 오버라이드 env도 앱에서 읽어 `resolveAuthConfig({ local })`로 넘깁니다. 패키지는 env를 직접 읽지 않습니다.

## Publish

```bash
pnpm build
npm publish
```

`publishConfig.registry`가 `https://npm.pkg.github.com`으로 설정되어 있습니다.
