/**
 * Hypothesis Testing Framework — structured hypothesis tracking across
 * the research lifecycle: formulation → experiment → decision → synthesis.
 *
 * Writes to disk as JSON; integrates with RLM state and RSI trajectory.
 */

import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace Hypothesis {
  const log = Log.create({ service: "hypothesis" })
  const DIR = path.join(Global.Path.data, "hypotheses")

  export type Status = "formulated" | "testing" | "supported" | "rejected" | "inconclusive"

  export interface Form {
    id: string
    sessionId: string
    timestamp: number

    /** Null hypothesis H0: the default/no-effect statement */
    h0: string
    /** Alternative hypothesis H1 */
    h1: string

    /** Test method name (e.g. t-test, ANOVA, wilcoxon, Fisher) */
    method: string

    /** Metric names under test */
    metrics: string[]

    /** Threshold for significance (p-value, BF, etc.) */
    threshold: number

    status: Status
    result?: Result
  }

  export interface Result {
    observed: number
    threshold: number
    conclusion: "accept_h0" | "reject_h0" | "inconclusive"
    sampleSize?: number
    effectSize?: number
    notes: string
  }

  /**
   * Parse structured hypothesis blocks from agent output.
   * Format:
   *   <hypothesis id="...">
   *     <h0>...</h0>
   *     <h1>...</h1>
   *     <method>...</method>
   *     <metrics>...</metrics>
   *     <threshold>...</threshold>
   *   </hypothesis>
   */
  export function parse(text: string, sessionId: string): Form[] {
    const results: Form[] = []
    const regex = /<hypothesis\s+id="([^"]+)">([\s\S]*?)<\/hypothesis>/g

    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const id = match[1]
      const block = match[2]
      const extract = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
        return m?.[1]?.trim() ?? ""
      }

      const metrics = extract("metrics")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const threshold = parseFloat(extract("threshold"))

      results.push({
        id,
        sessionId,
        timestamp: Date.now(),
        h0: extract("h0"),
        h1: extract("h1"),
        method: extract("method"),
        metrics,
        threshold: Number.isNaN(threshold) ? 0.05 : threshold,
        status: "formulated",
      })
    }
    return results
  }

  /** Parse hypothesis and decision from a test execution result. */
  export function parseResult(text: string, hypothesisId: string): Result | null {
    const regex = /<hypothesis_result\s+id="([^"]+)">([\s\S]*?)<\/hypothesis_result>/
    const match = text.match(regex)
    if (!match || match[1] !== hypothesisId) return null

    const block = match[2]
    const extract = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
      return m?.[1]?.trim() ?? ""
    }

    const observed = parseFloat(extract("observed"))
    const threshold = parseFloat(extract("threshold"))
    const sampleSize = parseInt(extract("sample_size"))
    const effectSize = parseFloat(extract("effect_size"))

    const conclusion = extract("conclusion")
    const valid = ["accept_h0", "reject_h0", "inconclusive"].includes(conclusion)
      ? (conclusion as Result["conclusion"])
      : "inconclusive"

    return {
      observed: Number.isNaN(observed) ? 1 : observed,
      threshold: Number.isNaN(threshold) ? 0.05 : threshold,
      conclusion: valid,
      sampleSize: Number.isNaN(sampleSize) ? undefined : sampleSize,
      effectSize: Number.isNaN(effectSize) ? undefined : effectSize,
      notes: extract("notes"),
    }
  }

  /** Persist a hypothesis to disk. */
  export async function save(h: Form): Promise<void> {
    await fs.mkdir(path.join(DIR, h.sessionId), { recursive: true })
    const file = path.join(DIR, h.sessionId, `${h.id}.json`)
    await Bun.write(file, JSON.stringify(h, null, 2))
    log.info("hypothesis saved", { id: h.id, sessionId: h.sessionId })
  }

  /** Load all hypotheses for a session. */
  export async function load(sessionId: string): Promise<Form[]> {
    const dir = path.join(DIR, sessionId)
    try {
      const files = await fs.readdir(dir)
      const results: Form[] = []
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        const data = await Bun.file(path.join(dir, file)).json()
        results.push(data as Form)
      }
      return results.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
      return []
    }
  }

  /** Update hypothesis status with test result. */
  export async function conclude(hypothesisId: string, sessionId: string, result: Result): Promise<Form | null> {
    const dir = path.join(DIR, sessionId)
    const file = path.join(dir, `${hypothesisId}.json`)
    try {
      const h = (await Bun.file(file).json()) as Form
      h.result = result
      h.status =
        result.conclusion === "reject_h0"
          ? "supported"
          : result.conclusion === "accept_h0"
            ? "rejected"
            : "inconclusive"
      await Bun.write(file, JSON.stringify(h, null, 2))
      log.info("hypothesis concluded", { id: hypothesisId, status: h.status })
      return h
    } catch {
      log.warn("hypothesis not found for conclusion", { id: hypothesisId, sessionId })
      return null
    }
  }

  /** Get summary stats for a session's hypotheses. */
  export async function summary(sessionId: string) {
    const all = await load(sessionId)
    const counts: Record<Status, number> = {
      formulated: 0,
      testing: 0,
      supported: 0,
      rejected: 0,
      inconclusive: 0,
    }
    for (const h of all) counts[h.status]++
    const concluded = counts.supported + counts.rejected + counts.inconclusive
    const correct = all.filter((h) => h.status === "supported").length
    return {
      total: all.length,
      concluded,
      correct,
      accuracy: concluded > 0 ? correct / concluded : 0,
      counts,
    }
  }

  /**
   * Build hypothesis tree for visualization.
   * Returns an adjaceny-table suitable for mermaid flowchart.
   */
  export async function tree(sessionId: string): Promise<string> {
    const all = await load(sessionId)
    if (all.length === 0) return ""

    const lines = ["flowchart TD"]
    for (const h of all) {
      const label = `${h.h1.slice(0, 60)}${h.h1.length > 60 ? "..." : ""}`
      const pathId = (i: number) => `N${all.indexOf(h)}_${i}`
      lines.push(`  ${pathId(0)}["${label}"]:::${h.status}`)

      if (h.result) {
        const verdict =
          h.result.conclusion === "reject_h0"
            ? "✓ Reject H0"
            : h.result.conclusion === "accept_h0"
              ? "✗ Accept H0"
              : "? Inconclusive"
        lines.push(`  ${pathId(0)} --> ${pathId(1)}["${verdict} (p=${h.result.observed})"]`)
      }
    }

    // Add class definitions for styling
    lines.push("  classDef supported fill:#d1fae5,stroke:#10b981")
    lines.push("  classDef rejected fill:#fee2e2,stroke:#ef4444")
    lines.push("  classDef inconclusive fill:#ede9fe,stroke:#8b5cf6")
    lines.push("  classDef formulated fill:#f3f4f6,stroke:#6b7280")
    lines.push("  classDef testing fill:#fef3c7,stroke:#f59e0b")

    return lines.join("\n")
  }

  /** Scan a message for hypotheses and persist them. */
  export async function scanSession(
    sessionId: string,
    messages: { parts: { type: string; text?: string }[] }[],
  ): Promise<number> {
    let count = 0
    const existing = await load(sessionId)
    const pending = existing.filter((h) => h.status === "formulated" || h.status === "testing")
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "text" || !part.text) continue
        const forms = parse(part.text, sessionId)
        for (const f of forms) {
          await save(f)
          pending.push(f)
          count++
        }
        for (const h of pending) {
          const result = parseResult(part.text, h.id)
          if (result) {
            await conclude(h.id, sessionId, result)
            count++
          }
        }
      }
    }
    return count
  }

  /** Cleanup old hypotheses (sessions deleted > 90 days ago). */
  export async function cleanup(): Promise<number> {
    try {
      const exists = await fs.stat(DIR).catch(() => null)
      if (!exists) return 0

      const sessions = await fs.readdir(DIR)
      const now = Date.now()
      const ttl = 90 * 24 * 60 * 60 * 1000
      let cleaned = 0

      for (const session of sessions) {
        const dir = path.join(DIR, session)
        const stat = await fs.stat(dir).catch(() => null)
        if (!stat?.isDirectory()) continue
        if (now - stat.mtimeMs > ttl) {
          await fs.rm(dir, { recursive: true })
          cleaned++
        }
      }

      if (cleaned > 0) log.info("cleaned old hypotheses", { count: cleaned })
      return cleaned
    } catch {
      return 0
    }
  }
}
