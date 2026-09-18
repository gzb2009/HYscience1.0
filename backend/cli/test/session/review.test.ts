import { describe, expect, test } from "bun:test"
import { SessionReview } from "../../src/session/review"
import { Identifier } from "../../src/id/id"
import type { ReviewRecord } from "../../src/session/review-record"
import { Config } from "../../src/config/config"

// WS11 — the reviewer gate's runtime spawn hits a real model, so these cover the
// pure decision surface: which turns get reviewed and by whom. When
// config.experimental.reviewGate is unset, research/biology/ml default to
// annotate; explicit `off` still disables.

describe("SessionReview.shouldReview", () => {
  const artifact = "We trained the model in train.py and reached an accuracy of 0.93 on the holdout set. ".repeat(6)

  test("skips non-reviewable agents even with substantive artifact answers", () => {
    expect(SessionReview.shouldReview({ agent: "explore", text: artifact })).toBe(false)
    expect(SessionReview.shouldReview({ agent: "write", text: artifact })).toBe(false)
    expect(SessionReview.shouldReview({ agent: undefined, text: artifact })).toBe(false)
  })

  test("skips trivial short answers from reviewable agents", () => {
    expect(SessionReview.shouldReview({ agent: "research", text: "Done — see above." })).toBe(false)
  })

  test("skips long prose answers with no checkable fact", () => {
    const prose = "This paragraph is entirely prose with no numbers or file references whatsoever. ".repeat(20)
    expect(SessionReview.shouldReview({ agent: "research", text: prose })).toBe(false)
  })

  test("reviews substantive artifact-bearing answers from reviewable agents", () => {
    for (const agent of ["research", "biology", "ml", "physics"]) {
      expect(SessionReview.shouldReview({ agent, text: artifact })).toBe(true)
    }
  })
})

describe("SessionReview.reviewerFor", () => {
  test("maps each domain to its sharpest reviewer", () => {
    expect(SessionReview.reviewerFor("physics")).toBe("physics-critique")
    expect(SessionReview.reviewerFor("research", "physics")).toBe("physics-critique")
    expect(SessionReview.reviewerFor("research")).toBe("reviewer")
    expect(SessionReview.reviewerFor("biology")).toBe("reviewer")
    expect(SessionReview.reviewerFor("ml")).toBe("reviewer")
    expect(SessionReview.reviewerFor("something-else")).toBe("critique")
  })
})

describe("SessionReview.shouldReview — boundaries", () => {
  test("respects the minimum-length gate", () => {
    // Below the length floor is skipped even with a checkable fact present...
    expect(SessionReview.shouldReview({ agent: "research", text: "acc 0.9 in run.py" })).toBe(false)
    // ...and a long answer carrying an artifact path qualifies.
    const long = "a".repeat(399) + " results/run.ipynb"
    expect(SessionReview.shouldReview({ agent: "research", text: long })).toBe(true)
  })

  test("triggers on a file:line citation", () => {
    const text = "The traceback originates in the loader — see file:42 for the exact frame. ".repeat(7)
    expect(SessionReview.shouldReview({ agent: "ml", text })).toBe(true)
  })

  test("triggers on a decimal numeric data point in the text", () => {
    const text = "The measured effect held at 0.93 across every condition we swept in the study. ".repeat(7)
    expect(SessionReview.shouldReview({ agent: "biology", text })).toBe(true)
  })
})

describe("SessionReview.repair", () => {
  const long = "We trained the model in train.py and reached an accuracy of 0.93 on the holdout set. ".repeat(6)

  test("builds a repair prompt from findings and the original answer", () => {
    const prompt = SessionReview.repairPrompt(long, [
      { severity: "blocking", message: "Row Tfh lists 14 markers but claims 16", evidence: [] },
    ])
    expect(prompt).toContain("Row Tfh lists 14 markers but claims 16")
    expect(prompt).toContain(long)
  })

  test("accepts a full rewritten answer and rejects notes or JSON", () => {
    expect(SessionReview.acceptRepair(long, `${long} Corrected the marker count to 14.`)).toBe(true)
    expect(SessionReview.acceptRepair(long, "Fixed.")).toBe(false)
    expect(SessionReview.acceptRepair(long, '{"verdict":"CLEAN","findings":[]}')).toBe(false)
    expect(SessionReview.acceptRepair(long, long)).toBe(false)
  })

  test("reads only user-facing text parts", () => {
    expect(
      SessionReview.answerText([
        { type: "text", text: "visible" },
        { type: "text", text: "hidden", hybio: true },
        { type: "tool" },
      ]),
    ).toBe("visible")
  })
})

describe("SessionReview.parse", () => {
  test("parses clean and flagged JSON verdicts", () => {
    expect(SessionReview.parse('{"verdict":"CLEAN","findings":[]}')).toEqual({
      verdict: "CLEAN",
      findings: [],
    })
    expect(
      SessionReview.parse(
        '{"verdict":"FLAGGED","findings":[{"severity":"blocking","message":"Wrong metric","evidence":["results.csv:2"]}]}',
      ),
    ).toEqual({
      verdict: "FLAGGED",
      findings: [{ severity: "blocking", message: "Wrong metric", evidence: ["results.csv:2"] }],
    })
  })

  test("rejects malformed or inconsistent verdicts", () => {
    expect(() => SessionReview.parse("CLEAN")).toThrow()
    expect(() => SessionReview.parse('{"verdict":"FLAGGED","findings":[]}')).toThrow()
    expect(() =>
      SessionReview.parse(
        '{"verdict":"CLEAN","findings":[{"severity":"warning","message":"Unexpected","evidence":[]}]}',
      ),
    ).toThrow()
  })
})

describe("SessionReview policy", () => {
  const record = (mode: "annotate" | "enforce", verdict: "CLEAN" | "FLAGGED" | "ERROR") =>
    ({
      id: Identifier.ascending("review"),
      sessionID: Identifier.ascending("session"),
      messageID: Identifier.ascending("message"),
      agent: "research",
      reviewer: "reviewer",
      verdict,
      mode,
      findings: verdict === "FLAGGED" ? [{ severity: "blocking", message: "Unsupported", evidence: [] }] : [],
      model: { providerID: "test", modelID: "test" },
      time: { started: 1, completed: 2 },
    }) satisfies ReviewRecord.Info

  test("defaults research agents to annotate and honors explicit policy", () => {
    expect(SessionReview.modeFor("research")).toBe("annotate")
    expect(SessionReview.modeFor("research", undefined, "physics")).toBe("annotate")
    expect(SessionReview.modeFor("physics")).toBe("off")
    expect(SessionReview.modeFor("research", "enforce")).toBe("enforce")
    expect(SessionReview.modeFor("research", "off")).toBe("off")
  })

  test("accepts enforce policy and reviewer resource limits", () => {
    const config = Config.Info.parse({
      experimental: {
        reviewGate: "enforce",
        reviewTimeoutMs: 30_000,
        reviewMaxSteps: 8,
        reviewRetryMax: 2,
      },
    })
    expect(config.experimental?.reviewGate).toBe("enforce")
    expect(config.experimental?.reviewTimeoutMs).toBe(30_000)
    expect(config.experimental?.reviewMaxSteps).toBe(8)
    expect(config.experimental?.reviewRetryMax).toBe(2)
  })

  test("treats IMC metal mixed with PhenoCycler as a silent rewrite target", async () => {
    const prompt = await Bun.file(new URL("../../src/agent/prompt/reviewer.txt", import.meta.url)).text()
    expect(prompt).toContain("mixing mutually exclusive assay ontologies")
    expect(prompt).toContain("unofficial marker nicknames")
    expect(prompt).toContain("The parent will apply the correction silently")
  })

  test("corrected records keep their findings visible", () => {
    const findings = [
      { severity: "blocking" as const, message: "Marker count 12 vs table rows 14", evidence: [] },
      { severity: "warning" as const, message: "GrzB is not an official symbol", evidence: [] },
    ]
    expect(SessionReview.correctedSummary(findings)).toBe(
      "Corrected before delivery (2 issues): Marker count 12 vs table rows 14",
    )
    expect(SessionReview.correctedSummary([findings[0]])).toContain("(1 issue)")
  })

  test("annotate is fail-open while enforce blocks flagged and error records", () => {
    expect(SessionReview.decide(record("annotate", "FLAGGED")).verdict).toBe("FLAGGED")
    expect(SessionReview.decide(record("enforce", "CLEAN")).verdict).toBe("CLEAN")
    expect(() => SessionReview.decide(record("enforce", "FLAGGED"))).toThrow(SessionReview.BlockedError)
    expect(() => SessionReview.decide(record("enforce", "ERROR"))).toThrow(SessionReview.BlockedError)
  })

  test("retries only while blocking findings remain under the cap", () => {
    const blocking = [{ severity: "blocking" as const, message: "same isotope twice", evidence: [] }]
    const warning = [{ severity: "warning" as const, message: "spot vs cell type", evidence: [] }]
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings: blocking })).toBe(true)
    expect(SessionReview.shouldRetry({ attempt: 2, max: 2, findings: blocking })).toBe(false)
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings: warning })).toBe(false)
    expect(SessionReview.retryPrompt(blocking, 0, 2)).toContain("same isotope twice")
    expect(SessionReview.retryPrompt(blocking, 0, 2)).toContain("<review-retry>")
  })
})
