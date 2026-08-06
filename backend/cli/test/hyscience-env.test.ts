import { expect, test } from "bun:test"
import { HYscience } from "../src/hyscience"

test("subprocess env filtering keeps only the safe runtime baseline", () => {
  const filtered = HYscience.filterEnvForSubprocess({
    PATH: "/usr/bin",
    HOME: "/home/researcher",
    OPENROUTER_API_KEY: "thk_managed_openrouter",
    OPENAI_API_KEY: "thk_managed_openai",
    OPENROUTER_BASE_URL: "https://atlas.test/api/llm/proxy/openrouter/v1",
    DATABASE_URL: "postgres://secret",
  })

  expect(filtered.PATH).toBe("/usr/bin")
  expect(filtered.HOME).toBe("/home/researcher")
  expect(filtered.OPENROUTER_API_KEY).toBeUndefined()
  expect(filtered.OPENAI_API_KEY).toBeUndefined()
  expect(filtered.OPENROUTER_BASE_URL).toBeUndefined()
  expect(filtered.DATABASE_URL).toBeUndefined()
})

test("subprocess env filtering does not implicitly pass BYOK keys", () => {
  const filtered = HYscience.filterEnvForSubprocess({
    OPENROUTER_API_KEY: "sk-or-user-owned",
  })

  expect(filtered.OPENROUTER_API_KEY).toBeUndefined()
})

test("mergeByokEnv injects a locally-connected OpenRouter key + pins public base url", () => {
  const merged = HYscience.mergeByokEnv(
    { PATH: "/usr/bin", OPENROUTER_BASE_URL: "https://atlas.test/api/llm/proxy/openrouter/v1" },
    { openrouter: { type: "api", key: "sk-or-user-owned" } },
    ["openrouter"],
  )

  expect(merged.OPENROUTER_API_KEY).toBe("sk-or-user-owned")
  // A bridged BYOK key must hit public OpenRouter, not the managed proxy.
  expect(merged.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1")
})

test("mergeByokEnv never injects a managed thk_ key", () => {
  const merged = HYscience.mergeByokEnv({}, { openrouter: { type: "api", key: "thk_managed" } }, ["openrouter"])
  expect(merged.OPENROUTER_API_KEY).toBeUndefined()
})

test("mergeByokEnv does not override an existing value", () => {
  const merged = HYscience.mergeByokEnv(
    { OPENROUTER_API_KEY: "sk-or-from-shell" },
    { openrouter: { type: "api", key: "sk-or-from-auth" } },
    ["openrouter"],
  )
  expect(merged.OPENROUTER_API_KEY).toBe("sk-or-from-shell")
})

test("mergeByokEnv requires an explicit provider opt-in", () => {
  const merged = HYscience.mergeByokEnv({}, { openrouter: { type: "api", key: "sk-or-user" } })
  expect(merged.OPENROUTER_API_KEY).toBeUndefined()
})

test("mergeByokEnv ignores opted-in providers that are not subprocess-safe", () => {
  const merged = HYscience.mergeByokEnv({}, { anthropic: { type: "api", key: "sk-ant-user" } }, ["anthropic"])
  expect(merged.ANTHROPIC_API_KEY).toBeUndefined()
})
