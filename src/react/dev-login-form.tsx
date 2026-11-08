import { type FormEvent, useState } from "react"

import { ApiError } from "../api-error"

import type { CSSProperties } from "react"

// 소비 앱의 CSS 프레임워크에 기대지 않도록 인라인 스타일만 쓴다.
const FORM_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
}

const INPUT_STYLE: CSSProperties = {
  border: "1px solid currentColor",
  padding: "4px 8px",
}

export function DevLoginForm({
  onSubmit,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorCode(null)
    try {
      await onSubmit({ email, password })
    } catch (error) {
      setErrorCode(
        error instanceof ApiError ? (error.code ?? "UNKNOWN") : "UNKNOWN",
      )
    }
  }

  return (
    <form
      data-testid="sso-dev-login-form"
      onSubmit={(event) => void handleSubmit(event)}
      style={FORM_STYLE}
    >
      <input
        aria-label="이메일"
        autoComplete="email"
        onChange={(event) => {
          setEmail(event.target.value)
        }}
        style={INPUT_STYLE}
        type="email"
        value={email}
      />
      <input
        aria-label="비밀번호"
        autoComplete="current-password"
        onChange={(event) => {
          setPassword(event.target.value)
        }}
        style={INPUT_STYLE}
        type="password"
        value={password}
      />
      {errorCode ? <p role="alert">{errorCode}</p> : null}
      <button type="submit">로그인</button>
    </form>
  )
}
