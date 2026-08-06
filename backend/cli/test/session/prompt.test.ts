import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

describe("SessionPrompt.atStepLimit", () => {
  test("starts the tool-free terminal step at the configured limit", () => {
    expect(SessionPrompt.atStepLimit(1, 1)).toBe(true)
    expect(SessionPrompt.atStepLimit(2, 2)).toBe(true)
  })

  test("permits tool-enabled steps before the configured limit", () => {
    expect(SessionPrompt.atStepLimit(1, 2)).toBe(false)
  })

  test("removes all tools at the terminal step", () => {
    expect(SessionPrompt.toolsAtStep({ read: {} }, true)).toEqual({})
    expect(SessionPrompt.toolsAtStep({ read: {} }, false)).toEqual({ read: {} })
  })
})
