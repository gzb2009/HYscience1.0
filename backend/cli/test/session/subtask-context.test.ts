import { describe, expect, test } from "bun:test"
import { SubtaskContext } from "../../src/session/subtask-context"
import type { MessageV2 } from "../../src/session/message-v2"
import type { TaskDecisionState } from "../../src/session/task-decisions"

function decisions(): TaskDecisionState.State {
  return { version: 1, decisions: [], constraints: [], updatedAt: 1 }
}

function message(text: string): MessageV2.WithParts {
  return {
    info: {
      id: "msg_test",
      sessionID: "ses_test",
      role: "user",
      time: { created: Date.now() },
    },
    parts: [
      {
        id: "part_test",
        messageID: "msg_test",
        sessionID: "ses_test",
        type: "text",
        text,
      },
    ],
  } as MessageV2.WithParts
}

function assistant(text: string): MessageV2.WithParts {
  return {
    info: {
      id: "msg_assistant",
      sessionID: "ses_test",
      role: "assistant",
      time: { created: Date.now() },
      modelID: "test",
      providerID: "test",
      mode: "chat",
      agent: "research",
    },
    parts: [{ id: "part_assistant", messageID: "msg_assistant", sessionID: "ses_test", type: "text", text }],
  } as MessageV2.WithParts
}

describe("subtask context", () => {
  test("builds a bounded packet without assistant history", () => {
    const state = decisions()
    state.decisions = [{ id: "segmentation", status: "pending", recommendation: "Cellpose", time: 1 }]
    const packet = SubtaskContext.packet({
      taskID: "task_current",
      description: "Analyze samples",
      prompt: "Analyze the current samples.",
      entities: { species: "human", omicsTypes: ["scRNA"], hasVDJ: false, lastUpdate: 1 },
      decisions: state,
      messages: [message("必须保留供体分组。\nWhich markers distinguish the populations?")],
    })

    expect(packet).toContain('<context-packet task_id="task_current">')
    expect(packet).toContain('"species":"human"')
    expect(packet).toContain("必须保留供体分组")
    expect(packet).toContain("Which markers distinguish")
    expect(packet).toContain("Cellpose")
    expect(packet.length).toBeLessThanOrEqual(SubtaskContext.limits.packetChars)
  })

  test("excludes assistant output from a child packet", () => {
    const packet = SubtaskContext.packet({
      taskID: "task_current",
      description: "Analyze samples",
      prompt: "Analyze the current samples.",
      entities: { species: "human", omicsTypes: ["scRNA"], hasVDJ: false, lastUpdate: 1 },
      decisions: decisions(),
      messages: [message("仅使用当前任务的数据。"), assistant("complete sibling output: unique-failure-record")],
    })

    expect(packet).toContain("仅使用当前任务的数据")
    expect(packet).not.toContain("complete sibling output")
    expect(packet).not.toContain("unique-failure-record")
  })

  test("returns only a bounded structured summary", () => {
    const output = SubtaskContext.result(
      [
        "<rlm_result>",
        "<status>partial</status>",
        `<findings>${JSON.stringify(["Marker A supports population X."])}</findings>`,
        `<failures>${JSON.stringify(["No external validation dataset."])}</failures>`,
        `<assumptions>${JSON.stringify(["Clusters are batch corrected."])}</assumptions>`,
        "<parameters>{}</parameters>",
        `<artifact_refs>${JSON.stringify(["results/markers.csv"])}</artifact_refs>`,
        "<suggestions>[]</suggestions>",
        "</rlm_result>",
        "unbounded raw transcript should not be returned",
      ].join("\n"),
    )

    expect(output).toContain("<task_result>")
    expect(output).toContain("<conclusion>")
    expect(output).toContain('["results/markers.csv"]')
    expect(output).not.toContain("unbounded raw transcript")
    expect(output.length).toBeLessThanOrEqual(SubtaskContext.limits.resultChars)
  })

  test("enforces concurrent branch budget per parent task", () => {
    const releases = Array.from({ length: SubtaskContext.limits.branches }, () =>
      SubtaskContext.acquire("ses_budget", "task_budget"),
    )

    expect(() => SubtaskContext.acquire("ses_budget", "task_budget")).toThrow("branch budget")
    releases.forEach((release) => release())
  })

  test("isolates parallel task packets and keeps their summaries within the total budget", () => {
    const first = SubtaskContext.packet({
      taskID: "task_mouse",
      description: "Analyze mouse lung",
      prompt: "Use the current mouse-lung dataset.",
      entities: { species: "mouse", tissue: "lung", omicsTypes: ["scRNA"], hasVDJ: false, lastUpdate: 1 },
      decisions: decisions(),
      messages: [message("仅使用小鼠肺数据。")],
    })
    const second = SubtaskContext.packet({
      taskID: "task_human",
      description: "Analyze human liver",
      prompt: "Use the current human-liver dataset.",
      entities: { species: "human", tissue: "liver", omicsTypes: ["proteomics"], hasVDJ: false, lastUpdate: 1 },
      decisions: decisions(),
      messages: [message("仅使用人肝蛋白组数据。")],
    })
    const raw = [
      "<rlm_result>",
      "<status>success</status>",
      `<findings>${JSON.stringify(["x".repeat(10_000)])}</findings>`,
      "<failures>[]</failures>",
      "<assumptions>[]</assumptions>",
      "<parameters>{}</parameters>",
      "<artifact_refs>[]</artifact_refs>",
      "<suggestions>[]</suggestions>",
      "</rlm_result>",
    ].join("\n")
    const results = Array.from({ length: SubtaskContext.limits.branches }, () => SubtaskContext.result(raw))

    expect(first).toContain('"species":"mouse"')
    expect(first).not.toContain("human-liver")
    expect(second).toContain('"species":"human"')
    expect(second).not.toContain("mouse-lung")
    expect(results.every((result) => result.length <= SubtaskContext.limits.resultChars)).toBe(true)
    expect(results.join("\n").length).toBeLessThanOrEqual(SubtaskContext.limits.totalChars)
  })
})
