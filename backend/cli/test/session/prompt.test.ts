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

describe("SessionPrompt.turnComplete", () => {
  test("treats unknown finish with final text and no tools as done", () => {
    expect(
      SessionPrompt.turnComplete({
        userID: "msg_1",
        assistant: { id: "msg_2", finish: "unknown" },
        parts: [{ type: "text", text: "流程写完了" }],
      }),
    ).toBe(true)
  })

  test("keeps looping when unknown finish has no text yet", () => {
    expect(
      SessionPrompt.turnComplete({
        userID: "msg_1",
        assistant: { id: "msg_2", finish: "unknown" },
        parts: [{ type: "step-start" }],
      }),
    ).toBe(false)
  })

  test("keeps looping when tools are still in the step", () => {
    expect(
      SessionPrompt.turnComplete({
        userID: "msg_1",
        assistant: { id: "msg_2", finish: "tool-calls" },
        parts: [{ type: "tool" }, { type: "text", text: "先读文件" }],
      }),
    ).toBe(false)
  })

  test("exits on a normal stop finish", () => {
    expect(
      SessionPrompt.turnComplete({
        userID: "msg_1",
        assistant: { id: "msg_2", finish: "stop" },
        parts: [{ type: "text", text: "done" }],
      }),
    ).toBe(true)
  })

  test("a newer user message after a finished assistant is not complete", () => {
    expect(
      SessionPrompt.turnComplete({
        userID: "msg_3",
        assistant: { id: "msg_2", finish: "stop" },
        parts: [{ type: "text", text: "done" }],
      }),
    ).toBe(false)
  })
})
