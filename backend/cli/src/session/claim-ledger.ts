import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"
import { RLMState } from "./rlm/state"

export namespace ClaimLedger {
  export type Status = "verified" | "unverified" | "conflicted"

  export interface Claim {
    id: string
    statement: string
    type: "finding"
    evidence: string[]
    branch: string
    status: Status
    conflicts: string[]
    time: number
  }

  export interface State {
    version: 1
    claims: Claim[]
  }

  function filepath(sessionID: string, taskID: string) {
    return path.join(Instance.directory, ".hyscience", "memory", `claims-${sessionID}-${taskID}.json`)
  }

  function clean(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\b(?:is|are|was|were|the|a|an|this|that)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function polarity(value: string) {
    return /(?:\b(?:not|no|without|absent|lacks?)\b|不存在|没有|无|未)/i.test(value) ? "negative" : "positive"
  }

  function topic(value: string) {
    return clean(value)
      .replace(/\b(?:not|no|without|absent|lacks?)\b/g, " ")
      .replace(/(?:不存在|没有|无|未)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function conflicts(left: Claim, right: Claim) {
    if (left.branch === right.branch) return false
    const a = topic(left.statement)
    const b = topic(right.statement)
    if (!a || !b || polarity(left.statement) === polarity(right.statement)) return false
    return a === b || a.includes(b) || b.includes(a)
  }

  function parse(value: string) {
    const result = RLMState.parseExecutorOutput(value)
    const status: Status =
      result.status === "success" && result.artifactRefs.length > 0 && result.failures.length === 0
        ? "verified"
        : "unverified"
    return {
      status,
      evidence: result.artifactRefs.slice(0, 3),
      statements: result.findings
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8),
    }
  }

  async function load(sessionID: string, taskID: string): Promise<State> {
    try {
      const value = JSON.parse(await fs.readFile(filepath(sessionID, taskID), "utf8")) as Partial<State>
      return value.version === 1 && Array.isArray(value.claims)
        ? { version: 1, claims: value.claims }
        : { version: 1, claims: [] }
    } catch {
      return { version: 1, claims: [] }
    }
  }

  async function save(sessionID: string, taskID: string, state: State) {
    const file = filepath(sessionID, taskID)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(state, null, 2))
  }

  const queues = new Map<string, Promise<void>>()

  async function serial<T>(key: string, fn: () => Promise<T>) {
    const previous = queues.get(key) ?? Promise.resolve()
    const gate = Promise.withResolvers<void>()
    const current = gate.promise
    const queued = previous.then(() => current)
    queues.set(key, queued)
    await previous
    try {
      return await fn()
    } finally {
      gate.resolve()
      if (queues.get(key) === queued) queues.delete(key)
    }
  }

  export async function record(input: { sessionID: string; taskID: string; branch: string; output: string }) {
    const key = `${input.sessionID}:${input.taskID}`
    return serial(key, async () => {
      const parsed = parse(input.output)
      const state = await load(input.sessionID, input.taskID)
      const claims = parsed.statements.map(
        (statement, index): Claim => ({
          id: `${input.branch}:${Date.now()}:${index}`,
          statement,
          type: "finding",
          evidence: parsed.evidence,
          branch: input.branch,
          status: parsed.status,
          conflicts: [],
          time: Date.now(),
        }),
      )
      for (const claim of claims) {
        for (const existing of state.claims) {
          if (!conflicts(existing, claim)) continue
          existing.status = "conflicted"
          claim.status = "conflicted"
          existing.conflicts = [...new Set(existing.conflicts.concat(claim.id))]
          claim.conflicts = [...new Set(claim.conflicts.concat(existing.id))]
        }
      }
      const next = { version: 1 as const, claims: state.claims.concat(claims) }
      await save(input.sessionID, input.taskID, next)
      return next
    })
  }

  export function format(state: State, maxChars = Number.POSITIVE_INFINITY) {
    const verified = state.claims.filter((claim) => claim.status === "verified")
    const conflicts = state.claims.filter((claim) => claim.status === "conflicted")
    const fixed = [
      "<claim-ledger>",
      `verified=${verified.length} unverified=${state.claims.filter((claim) => claim.status === "unverified").length} conflicted=${conflicts.length}`,
      "<validated-claims>",
      "</validated-claims>",
      "<conflicts>",
      "</conflicts>",
      "Parent aggregation may include only validated-claims. Do not promote unverified or conflicted claims; retain them only as limitations or conflicts.",
      "</claim-ledger>",
    ]
    const entries = [
      ...verified.map((claim) => ({
        group: "verified" as const,
        line: `- ${claim.statement} [${claim.evidence.join(", ")}]`,
      })),
      ...conflicts.map((claim) => ({
        group: "conflicted" as const,
        line: `- ${claim.statement} conflicts_with=${claim.conflicts.join(",")}`,
      })),
    ]
    const picked = entries.reduce<typeof entries>((output, entry) => {
      const size =
        fixed.join("\n").length +
        output.reduce((total, item) => total + item.line.length + 1, 0) +
        entry.line.length +
        1
      return size <= maxChars ? output.concat(entry) : output
    }, [])
    return [
      "<claim-ledger>",
      `verified=${verified.length} unverified=${state.claims.filter((claim) => claim.status === "unverified").length} conflicted=${conflicts.length}`,
      "<validated-claims>",
      ...picked.filter((entry) => entry.group === "verified").map((entry) => entry.line),
      "</validated-claims>",
      "<conflicts>",
      ...picked.filter((entry) => entry.group === "conflicted").map((entry) => entry.line),
      "</conflicts>",
      "Parent aggregation may include only validated-claims. Do not promote unverified or conflicted claims; retain them only as limitations or conflicts.",
      "</claim-ledger>",
    ].join("\n")
  }
}
