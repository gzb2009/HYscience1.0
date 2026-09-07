import { describe, expect, test } from "bun:test"
import { SessionLoop } from "../../src/session/session-loop"
import { SessionTrace } from "../../src/session/session-trace"

describe("session-loop.resolve", () => {
  test("prioritizes subtask over prune", () => {
    const decision = SessionLoop.resolve({
      task: { type: "subtask", agent: "explore", prompt: "find files" } as never,
      shouldPrune: true,
      shouldCompact: false,
      compactionAttempts: 0,
    })
    expect(decision.phase).toBe("subtask")
    expect(decision.action.type).toBe("run-subtask")
  })

  test("schedules compaction before processing", () => {
    const decision = SessionLoop.resolve({
      shouldPrune: false,
      shouldCompact: true,
      compactionAttempts: 1,
    })
    expect(decision.phase).toBe("compacting")
    expect(decision.action.type).toBe("schedule-compaction")
  })

  test("halts after max compaction attempts", () => {
    const decision = SessionLoop.resolve({
      shouldPrune: false,
      shouldCompact: true,
      compactionAttempts: 3,
    })
    expect(decision.action.type).toBe("halt")
  })

  test("defaults to processing", () => {
    const decision = SessionLoop.resolve({
      shouldPrune: false,
      shouldCompact: false,
      compactionAttempts: 0,
    })
    expect(decision.phase).toBe("processing")
    expect(decision.action.type).toBe("process")
  })
})

describe("session-trace", () => {
  test("records injections and token totals", () => {
    const id = "ses_trace_test"
    SessionTrace.begin(id, 1)
    SessionTrace.injection(id, "locale")
    SessionTrace.injection(id, "research-intent")
    SessionTrace.finish({
      sessionID: id,
      phase: "processing",
      action: "process",
      tools: ["read", "bash"],
      tokens: { input: 1000, output: 200, cache: 50 },
    })

    const summary = SessionTrace.summary(id)
    expect(summary.turns).toBe(1)
    expect(summary.tokens.input).toBe(1000)
    expect(summary.last?.injections).toEqual(["locale", "research-intent"])
    expect(summary.last?.tools).toEqual(["read", "bash"])
  })
})
