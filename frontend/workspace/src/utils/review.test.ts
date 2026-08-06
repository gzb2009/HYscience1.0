import { describe, expect, test } from "bun:test"
import type { Message, ReviewRecord } from "@hysci/sdk/v2/client"
import { mergeReviews, reviewForTurn, reviewHistory, reviewState, selectedReview } from "./review"

const record = (
  messageID: string,
  verdict: ReviewRecord["verdict"] = "CLEAN",
  mode: ReviewRecord["mode"] = "annotate",
  completed = 2,
): ReviewRecord => ({
  id: `rev_${messageID}`,
  sessionID: "ses_test",
  messageID,
  agent: "research",
  reviewer: "reviewer",
  verdict,
  mode,
  findings: verdict === "FLAGGED" ? [{ severity: "blocking", message: "Unsupported result", evidence: [] }] : [],
  model: { providerID: "test", modelID: "test" },
  time: { started: 1, completed },
})

describe("review records", () => {
  test("merges records by message and preserves the newest completion", () => {
    const old = record("msg_a", "CLEAN", "annotate", 10)
    const stale = record("msg_a", "FLAGGED", "annotate", 5)
    const latest = record("msg_a", "FLAGGED", "annotate", 15)
    const other = record("msg_b")

    expect(mergeReviews([old], [stale, other])).toEqual([old, other])
    expect(mergeReviews([old], [latest])).toEqual([latest])
  })

  test("associates a review with the final reviewed assistant in a user turn", () => {
    const messages = [
      { id: "msg_user", sessionID: "ses_test", role: "user", time: { created: 1 } },
      {
        id: "msg_first",
        sessionID: "ses_test",
        role: "assistant",
        parentID: "msg_user",
        time: { created: 2 },
      },
      {
        id: "msg_final",
        sessionID: "ses_test",
        role: "assistant",
        parentID: "msg_user",
        time: { created: 3 },
      },
    ] as Message[]

    expect(reviewForTurn(messages, [record("msg_first"), record("msg_final", "FLAGGED")], "msg_user")?.messageID).toBe(
      "msg_final",
    )
    expect(reviewForTurn(messages, [record("msg_final")], "msg_other")).toBeUndefined()
  })

  test("blocks only non-clean enforce records", () => {
    expect(reviewState(record("msg_a", "FLAGGED", "annotate"))).toEqual({ blocked: false, tone: "flagged" })
    expect(reviewState(record("msg_a", "ERROR", "annotate"))).toEqual({ blocked: false, tone: "error" })
    expect(reviewState(record("msg_a", "CLEAN", "enforce"))).toEqual({ blocked: false, tone: "clean" })
    expect(reviewState(record("msg_a", "FLAGGED", "enforce"))).toEqual({ blocked: true, tone: "blocked" })
    expect(reviewState(record("msg_a", "ERROR", "enforce"))).toEqual({ blocked: true, tone: "blocked" })
  })

  test("orders history newest first and honors an in-session selection", () => {
    const first = record("msg_first")
    const latest = { ...record("msg_latest"), time: { started: 20, completed: 21 } }
    const history = reviewHistory([first, latest])

    expect(history.map((item) => item.messageID)).toEqual(["msg_latest", "msg_first"])
    expect(selectedReview(history, "ses_test", { sessionID: "ses_test", messageID: "msg_first" })).toBe(first)
    expect(selectedReview(history, "ses_test", { sessionID: "ses_other", messageID: "msg_first" })).toBe(latest)
  })
})
