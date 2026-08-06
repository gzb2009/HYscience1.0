import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { TaskDecisionState } from "../../src/session/task-decisions"
import * as Inject from "../../src/session/prompt-inject"
import type { MessageV2 } from "../../src/session/message-v2"

const project = path.join(__dirname, "../..")

function message(): MessageV2.WithParts {
  return {
    info: {
      id: "msg_decisions",
      sessionID: "ses_decisions",
      role: "user",
      time: { created: Date.now() },
    },
    parts: [
      { id: "part_decisions", messageID: "msg_decisions", sessionID: "ses_decisions", type: "text", text: "继续" },
    ],
  } as MessageV2.WithParts
}

describe("task decision state", () => {
  test("persists decisions and locale per task without leaking to sibling tasks", async () => {
    const sessionID = `decisions-${Date.now()}`
    await Instance.provide({
      directory: project,
      fn: async () => {
        await TaskDecisionState.save(sessionID, "task-a", {
          locale: "zh-CN",
          constraints: ["仅使用当前数据"],
          decisions: [{ id: "segmentation", status: "pending", recommendation: "Cellpose", time: 1 }],
        })
        await TaskDecisionState.save(sessionID, "task-b", {
          constraints: ["do not write files"],
          decisions: [{ id: "normalization", status: "chosen", choice: "SCTransform", time: 2 }],
        })

        const first = await TaskDecisionState.load(sessionID, "task-a")
        const second = await TaskDecisionState.load(sessionID, "task-b")
        expect(first.locale).toBe("zh-CN")
        expect(first.decisions[0]?.recommendation).toBe("Cellpose")
        expect(second.locale).toBeUndefined()
        expect(second.decisions[0]?.choice).toBe("SCTransform")
        expect(TaskDecisionState.format("task-a", first)).not.toContain("SCTransform")
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-task-a.json`))
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-task-b.json`))
  })

  test("injects existing decisions on a short continuation message", async () => {
    const sessionID = `decisions-${Date.now()}`
    await Instance.provide({
      directory: project,
      fn: async () => {
        await TaskDecisionState.save(sessionID, "task-a", {
          locale: "zh-CN",
          constraints: ["保留供体分组"],
          decisions: [{ id: "segmentation", status: "recommended", recommendation: "Cellpose", time: 1 }],
        })
        const msg = message()
        await Inject.injectTaskDecisions(msg, sessionID, "task-a")
        const text = msg.parts.find((part) => part.type === "text" && part.hybio)
        expect(text?.type === "text" && text.text).toContain("<task-decisions")
        expect(text?.type === "text" && text.text).toContain("Cellpose")
        expect(text?.type === "text" && text.text).toContain("not verified findings")
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-task-a.json`))
  })

  test("includes prior decisions only for an explicitly merged task scope", async () => {
    const sessionID = `decisions-${Date.now()}`
    await Instance.provide({
      directory: project,
      fn: async () => {
        await TaskDecisionState.save(sessionID, "task-old", {
          constraints: [],
          decisions: [{ id: "normalization", status: "chosen", choice: "SCTransform", time: 1 }],
        })
        await TaskDecisionState.save(sessionID, "task-new", { constraints: [], decisions: [] })
        const msg = message()
        await Inject.injectTaskDecisions(msg, sessionID, "task-new", undefined, {
          currentID: "task-new",
          items: [
            { id: "task-old", messageID: "msg_old", status: "archived", time: { created: 1, archived: 2 } },
            {
              id: "task-new",
              messageID: "msg_new",
              status: "active",
              mergedScopeIDs: ["task-old"],
              time: { created: 3 },
            },
          ],
        })
        const text = msg.parts.find((part) => part.type === "text" && part.hybio)
        expect(text?.type === "text" && text.text).toContain('source="merged-reference"')
        expect(text?.type === "text" && text.text).toContain("SCTransform")
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-task-old.json`))
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-task-new.json`))
  })
})
