import { describe, expect, test } from "bun:test"
import { ContextBudget } from "../../src/session/context-budget"
import type { Provider } from "../../src/provider/provider"

function createModel(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const tokens = (input: number, output = 0, cacheRead = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: cacheRead, write: 0 },
})

describe("context-budget.outputMax", () => {
  test("scales with large context models", () => {
    const model = createModel({ context: 200_000, output: 64_000 })
    expect(ContextBudget.outputMax(model)).toBe(50_000)
  })

  test("respects model output cap", () => {
    const model = createModel({ context: 200_000, output: 16_000 })
    expect(ContextBudget.outputMax(model)).toBe(16_000)
  })

  test("keeps a minimum floor for small models", () => {
    const model = createModel({ context: 16_000, output: 8_000 })
    expect(ContextBudget.outputMax(model)).toBe(8_000)
  })
})

describe("context-budget.pressure", () => {
  test("returns proactive threshold at 70% usage", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const usage = tokens(48_000, 5_000)
    expect(ContextBudget.pressure(usage, model)).toBeGreaterThanOrEqual(0.69)
    expect(ContextBudget.isProactive(usage, model)).toBe(true)
    expect(ContextBudget.isOverflow(usage, model)).toBe(false)
  })

  test("overflow takes precedence over proactive", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const usage = tokens(75_000, 5_000)
    expect(ContextBudget.isOverflow(usage, model)).toBe(true)
    expect(ContextBudget.isProactive(usage, model)).toBe(false)
  })
})

describe("context-budget.shouldPrune", () => {
  test("returns true at 50% pressure", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const usage = tokens(38_000, 0)
    expect(ContextBudget.shouldPrune(usage, model)).toBe(true)
  })
})
