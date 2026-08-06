import { expect, test } from "bun:test"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("decision timeout keeps the question pending until the user confirms", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let timedOut = false
      let settled = false
      const pending = Question.ask({
        sessionID: "ses_decision_timeout",
        questions: [
          {
            question: "Choose a method",
            header: "Method",
            options: [{ label: "Cellpose", description: "Recommended" }],
          },
        ],
        decision: {
          id: "segmentation",
          taskID: "task_decision",
          recommendation: "Cellpose",
          expiresAt: Date.now() + 5,
        },
        onTimeout: async () => {
          timedOut = true
        },
      })
      pending.then(() => {
        settled = true
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      const [request] = await Question.list()
      expect(timedOut).toBeTrue()
      expect(settled).toBeFalse()
      expect(request?.auto).toBe("recommended")

      await Question.reply({ requestID: request!.id, answers: [["Cellpose"]] })
      await expect(pending).resolves.toEqual([["Cellpose"]])
    },
  })
})

test("session cancellation clears a timed decision before it can resolve", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = Question.ask({
        sessionID: "ses_decision_cancel",
        questions: [{ question: "Choose", header: "Method", options: [{ label: "A", description: "A" }] }],
        decision: {
          id: "method",
          taskID: "task_decision",
          recommendation: "A",
          expiresAt: Date.now() + 50,
        },
      })
      await Question.cancelSession("ses_decision_cancel")
      await expect(pending).rejects.toBeInstanceOf(Question.RejectedError)
      expect(await Question.list()).toEqual([])
    },
  })
})
