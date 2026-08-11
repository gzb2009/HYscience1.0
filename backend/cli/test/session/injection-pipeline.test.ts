import { describe, expect, test } from "bun:test"
import { InjectionPipeline } from "../../src/session/injection-pipeline"
import { Identifier } from "../../src/id/id"
import type { MessageV2 } from "../../src/session/message-v2"

function mkCtx(userText: string, contract: InjectionPipeline.TurnContext["contract"]): InjectionPipeline.TurnContext {
  const id = Identifier.ascending("message")
  const sessionID = Identifier.ascending("session")
  const userMessage = {
    info: { id, sessionID, role: "user" as const, time: { created: Date.now() }, agent: "research", model: {} },
    parts: [{ id: Identifier.ascending("part"), messageID: id, sessionID, type: "text" as const, text: userText }],
  } as MessageV2.WithParts
  return {
    messages: [userMessage],
    userMessage,
    agent: { name: "research" } as InjectionPipeline.TurnContext["agent"],
    session: { id: sessionID } as InjectionPipeline.TurnContext["session"],
    scopedMessages: [userMessage],
    contract,
    userText,
  }
}

describe("injection-pipeline", () => {
  test("runs critical before scientific before advisory", async () => {
    const order: string[] = []
    const ctx = mkCtx("hello", {
      intent: "exploration",
      confidence: 1,
      knownContext: [],
      missingPremises: [],
      mustClarify: false,
      gates: [],
      coordinate: false,
      review: false,
    })

    await InjectionPipeline.run(
      [
        {
          name: "advisory-a",
          tier: "advisory",
          run: () => {
            order.push("advisory-a")
          },
        },
        {
          name: "critical-a",
          tier: "critical",
          run: () => {
            order.push("critical-a")
          },
        },
        {
          name: "scientific-a",
          tier: "scientific",
          run: () => {
            order.push("scientific-a")
          },
        },
        {
          name: "critical-b",
          tier: "critical",
          run: () => {
            order.push("critical-b")
          },
        },
      ],
      ctx,
    )

    expect(order).toEqual(["critical-a", "critical-b", "scientific-a", "advisory-a"])
  })

  test("when predicate skips an injection", async () => {
    const order: string[] = []
    const ctx = mkCtx("method question", {
      intent: "direct_answer",
      confidence: 1,
      knownContext: [],
      missingPremises: [],
      mustClarify: false,
      gates: [],
      coordinate: false,
      review: false,
    })

    await InjectionPipeline.run(
      [
        {
          name: "stats-check",
          tier: "scientific",
          when: () => false,
          run: () => {
            order.push("stats-check")
          },
        },
        {
          name: "locale",
          tier: "critical",
          run: () => {
            order.push("locale")
          },
        },
      ],
      ctx,
    )

    expect(order).toEqual(["locale"])
  })
})
