import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"

function tool(input: Record<string, unknown>): MessageV2.ToolPart {
  return {
    id: "part",
    sessionID: "session",
    messageID: "message",
    type: "tool",
    callID: "call",
    tool: "read",
    state: {
      status: "completed",
      input,
      output: "",
      title: "",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  }
}

function step(): MessageV2.StepStartPart {
  return {
    id: "step",
    sessionID: "session",
    messageID: "message",
    type: "step-start",
  }
}

function text(): MessageV2.TextPart {
  return {
    id: "text",
    sessionID: "session",
    messageID: "message",
    type: "text",
    text: "continuing",
  }
}

describe("SessionProcessor.isDoomLoop", () => {
  test("compares the latest tool calls while ignoring step and text parts", () => {
    const input = { path: "README.md" }

    expect(SessionProcessor.isDoomLoop([tool(input), step(), tool(input), text(), tool(input)], "read", input)).toBe(
      true,
    )
  })

  test("does not match when a recent tool call differs", () => {
    const input = { path: "README.md" }

    expect(
      SessionProcessor.isDoomLoop(
        [tool(input), step(), tool({ path: "package.json" }), text(), tool(input)],
        "read",
        input,
      ),
    ).toBe(false)
  })
})
