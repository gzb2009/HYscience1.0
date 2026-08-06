import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { DecisionGate } from "../../src/session/decision-gate"
import { TaskDecisionState } from "../../src/session/task-decisions"

const project = path.join(__dirname, "../..")

describe("decision execution gate", () => {
  test("allows read-only tools and blocks execution while confirmation is pending", async () => {
    const sessionID = `decision-gate-${Date.now()}`
    const taskID = "task-confirmation"
    await Instance.provide({
      directory: project,
      fn: async () => {
        await TaskDecisionState.save(sessionID, taskID, {
          constraints: [],
          decisions: [{ id: "segmentation", status: "pending", recommendation: "Cellpose", time: 1 }],
        })
        const session = {
          id: sessionID,
          taskScope: {
            currentID: taskID,
            items: [{ id: taskID, messageID: "msg_1", status: "active" as const, time: { created: 1 } }],
          },
        }

        await expect(DecisionGate.assert({ session, tool: "read" })).resolves.toBeUndefined()
        await expect(DecisionGate.assert({ session, tool: "bash" })).rejects.toThrow("segmentation")

        await TaskDecisionState.setDecision(sessionID, taskID, {
          id: "segmentation",
          status: "chosen",
          choice: "Cellpose",
        })
        await expect(DecisionGate.assert({ session, tool: "bash" })).resolves.toBeUndefined()
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `decisions-${sessionID}-${taskID}.json`))
  })
})
