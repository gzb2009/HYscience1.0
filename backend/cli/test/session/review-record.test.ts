import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ReviewRecord } from "../../src/session/review-record"
import { tmpdir } from "../fixture/fixture"

const record = (sessionID: string, messageID: string, verdict: "CLEAN" | "FLAGGED" = "CLEAN") =>
  ({
    id: Identifier.ascending("review"),
    sessionID,
    messageID,
    agent: "research",
    reviewer: "reviewer",
    verdict,
    mode: "annotate",
    findings: verdict === "FLAGGED" ? [{ severity: "blocking", message: "Unsupported claim", evidence: [] }] : [],
    model: { providerID: "test", modelID: "test" },
    time: { started: Date.now(), completed: Date.now() },
  }) satisfies ReviewRecord.Info

describe("ReviewRecord storage", () => {
  test("round-trips, lists, and idempotently overwrites by message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = Identifier.ascending("session")
        const messageID = Identifier.ascending("message")
        const first = record(sessionID, messageID)
        const second = { ...record(sessionID, messageID, "FLAGGED"), id: first.id }

        await ReviewRecord.save(first)
        expect(await ReviewRecord.get(sessionID, messageID)).toEqual(first)
        await ReviewRecord.save(second)
        expect(await ReviewRecord.get(sessionID, messageID)).toEqual(second)
        expect(await ReviewRecord.list(sessionID)).toEqual([second])

        await ReviewRecord.removeSession(sessionID)
        expect(await ReviewRecord.list(sessionID)).toEqual([])
      },
    })
  })

  test("session deletion removes its review records", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await ReviewRecord.save(record(session.id, messageID))

        await Session.remove(session.id)

        expect(await ReviewRecord.get(session.id, messageID)).toBeUndefined()
      },
    })
  })
})
