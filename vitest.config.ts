import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    // Node 25+는 전역 localStorage를 기본 제공해 jsdom의 것을 가린다.
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
    },
  },
})
