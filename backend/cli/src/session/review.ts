import { Config } from "../config/config"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { ReviewRecord } from "./review-record"
import { Instance } from "../project/instance"
import { CitationCheck } from "./citation-check"
import { ThemeSlots } from "./theme-slots"
import { BiologyProfile } from "./biology-profile"
import { isBiologyTheme } from "@hysci/util/themes"
import z from "zod"

export namespace SessionReview {
  const log = Log.create({ service: "session.review" })
  const REVIEWABLE = ["research", "biology", "ml", "physics"]
  const MIN_TEXT = 400
  const DEFAULT_TIMEOUT = 120_000
  const RETRY_MAX = 2
  const REPAIR_SYSTEM =
    "You correct finished scientific answers. Rewrite the complete user-facing answer so every count, table row, citation, and claim is internally consistent. Fix only the listed issues. Do not redesign. Do not mention review, flags, or that you corrected anything. Return only the corrected answer."
  const Result = z
    .object({
      verdict: z.enum(["CLEAN", "FLAGGED"]),
      findings: z.array(ReviewRecord.Finding),
    })
    .superRefine((value, ctx) => {
      if (value.verdict === "CLEAN" && value.findings.length > 0) {
        ctx.addIssue({ code: "custom", message: "CLEAN reviews cannot include findings" })
      }
      if (value.verdict === "FLAGGED" && value.findings.length === 0) {
        ctx.addIssue({ code: "custom", message: "FLAGGED reviews require at least one finding" })
      }
    })

  export function reviewerFor(agent: string, domain?: string): string {
    if (agent === "physics" || domain === "physics") return "physics-critique"
    if (agent === "research" || agent === "biology" || agent === "ml" || domain === "biology" || domain === "ml") {
      return "reviewer"
    }
    return "critique"
  }

  export function modeFor(agent: string | undefined, configured?: "off" | "annotate" | "enforce", domain?: string) {
    if (configured) return configured
    if (agent === "research" || agent === "biology" || agent === "ml") return "annotate"
    if (domain === "biology" || domain === "ml" || domain === "physics") return "annotate"
    return "off"
  }

  export function shouldReview(input: { agent?: string; text: string }): boolean {
    if (!input.agent || !REVIEWABLE.includes(input.agent)) return false
    const text = input.text.trim()
    if (text.length < MIN_TEXT) return false
    return /[\w./-]+\.(?:py|ipynb|md|csv|json|txt|tex|png|pdf|npy|parquet|h5ad|rds|xlsx)\b|\bfile:\d|\d+\.\d+|\d+%|\|\s*\d/.test(
      text,
    )
  }

  function sessionHasToolCalls(messages: { parts?: unknown[] }[]): boolean {
    return messages.some((m) => {
      const parts = m.parts as { type?: string }[] | undefined
      return parts?.some((p) => p.type === "tool")
    })
  }

  function answerParts(parts: MessageV2.Part[]) {
    return parts.filter((part): part is MessageV2.TextPart => part.type === "text" && !MessageV2.isHybio(part))
  }

  async function markerClusters(
    messages: { info?: { role?: string }; parts?: { type?: string; filename?: string; url?: string }[] }[],
  ) {
    const user = [...messages].reverse().find((message) => message.info?.role === "user")
    if (!user?.parts) return undefined
    for (const part of user.parts) {
      if (part.type !== "file") continue
      const name = part.filename ?? part.url ?? ""
      if (!/marker/i.test(name)) continue
      const file = part.url?.startsWith("file://") ? decodeURIComponent(part.url.slice(7)) : part.url
      if (!file) continue
      const raw = await Bun.file(file)
        .text()
        .catch(() => "")
      const ids = ThemeSlots.clustersFromCsv(raw)
      if (ids.length) return ids
    }
    return undefined
  }

  export function answerText(parts: { type?: string; text?: string; hybio?: boolean; synthetic?: boolean }[]) {
    return parts
      .filter((part) => part.type === "text" && part.text && !MessageV2.isHybio(part))
      .map((part) => part.text)
      .join("\n")
      .trim()
  }

  export function repairPrompt(text: string, findings: ReviewRecord.Finding[]) {
    return [
      "Fix the finished answer so it is internally consistent. Do not add commentary.",
      "",
      "<findings>",
      findings.map((finding) => `- ${finding.message}`).join("\n"),
      "</findings>",
      "",
      "<final_answer>",
      text,
      "</final_answer>",
    ].join("\n")
  }

  /** Summary for a record whose answer was rewritten; findings stay visible in the Evidence pane. */
  export function correctedSummary(findings: ReviewRecord.Finding[]) {
    return `Corrected before delivery (${findings.length} issue${findings.length === 1 ? "" : "s"}): ${findings[0]?.message ?? ""}`.trim()
  }

  export function acceptRepair(original: string, repaired: string) {
    const next = repaired.trim()
    if (next.length < 80) return false
    if (next.length < Math.floor(original.trim().length * 0.4)) return false
    if (/^\s*\{"verdict"/.test(next)) return false
    return next !== original.trim()
  }

  /** Theme-specific review checklist from the active biology profile, if any. */
  export function checklist(subdomain: string | undefined) {
    if (!isBiologyTheme(subdomain)) return ""
    const items = BiologyProfile.review(subdomain)
    if (!items) return ""
    return ['<theme_checklist theme="' + subdomain + '">', items, "</theme_checklist>"].join("\n")
  }

  function promptFor(text: string, note = ""): string {
    return [
      "Blindly review the FINAL ANSWER below. You did not write it; do not trust it.",
      "Independently trace every claim, number, and citation to evidence you can verify from the workspace.",
      "Flag citation mismatches, untraceable numbers, and unsupported claims. Judge integrity, not style.",
      "Return only JSON using one of these forms:",
      '{"verdict":"CLEAN","findings":[]}',
      '{"verdict":"FLAGGED","findings":[{"severity":"blocking","message":"concise issue","evidence":["path:line or source"]}]}',
      "Do not use markdown fences.",
      "",
      "<final_answer>",
      text,
      "</final_answer>",
      note,
    ]
      .filter(Boolean)
      .join("\n")
  }

  /** Merge deterministic citation findings into the reviewer verdict. */
  export function merge(
    parsed: { verdict: "CLEAN" | "FLAGGED"; findings: ReviewRecord.Finding[] },
    extra: ReviewRecord.Finding[],
  ) {
    const findings = [...extra, ...parsed.findings]
    const blocking = findings.some((finding) => finding.severity === "blocking")
    return { verdict: blocking || parsed.verdict === "FLAGGED" ? ("FLAGGED" as const) : ("CLEAN" as const), findings }
  }

  export function parse(text: string) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start === -1 || end < start) throw new Error("Reviewer did not return a JSON object")
    return Result.parse(JSON.parse(text.slice(start, end + 1)))
  }

  export class BlockedError extends Error {
    readonly record: ReviewRecord.Info

    constructor(record: ReviewRecord.Info) {
      super(`Review gate ${record.verdict.toLowerCase()}: ${record.summary ?? record.error ?? "answer rejected"}`)
      this.name = "ReviewBlockedError"
      this.record = record
    }
  }

  export function decide(record: ReviewRecord.Info) {
    if (record.mode === "enforce" && record.verdict !== "CLEAN") throw new BlockedError(record)
    return record
  }

  export function retryMax(configured?: number) {
    return configured ?? RETRY_MAX
  }

  export function shouldRetry(input: { attempt: number; max: number; findings: ReviewRecord.Finding[] }) {
    if (input.attempt >= input.max) return false
    return input.findings.some((finding) => finding.severity === "blocking")
  }

  export function retryPrompt(findings: ReviewRecord.Finding[], attempt: number, max: number) {
    const blocking = findings.filter((finding) => finding.severity === "blocking")
    return [
      "<review-retry>",
      `Deterministic review blocked delivery (${attempt + 1}/${max}).`,
      "Do not claim the task is finished. Fix every blocking issue using files or tool output as evidence.",
      ...blocking.map((finding) => `- ${finding.message}`),
      "</review-retry>",
    ].join("\n")
  }

  /** Theme/citation-free local scan used to bounce a finished turn without spawning a reviewer. */
  export async function scan(input: { text: string; messages: MessageV2.WithParts[] }) {
    const subdomain = (() => {
      try {
        return Instance.project.research?.subdomain
      } catch {
        return undefined
      }
    })()
    return ThemeSlots.check(subdomain, input.text, { markerClusters: await markerClusters(input.messages) })
  }

  export async function kick(input: {
    sessionID: string
    agent?: string
    model: { providerID: string; modelID: string }
    attempt: number
  }) {
    if (!input.agent || !REVIEWABLE.includes(input.agent)) return false
    const config = await Config.get()
    const max = retryMax(config.experimental?.reviewRetryMax)
    const { Session } = await import("./index")
    const messages = await Session.messages({ sessionID: input.sessionID })
    const last = messages.filter((message) => message.info.role === "assistant" && message.info.finish).at(-1)
    if (!last) return false
    const text = answerText(last.parts)
    if (!text) return false
    const findings = await scan({ text, messages })
    if (!shouldRetry({ attempt: input.attempt, max, findings })) return false
    const user = await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      agent: input.agent,
      model: input.model,
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: user.id,
      sessionID: input.sessionID,
      type: "text",
      hybio: true,
      text: retryPrompt(findings, input.attempt, max),
      time: { start: Date.now(), end: Date.now() },
    })
    log.info("review retry", { sessionID: input.sessionID, attempt: input.attempt + 1, max, findings: findings.length })
    return true
  }

  async function applyAnswer(last: MessageV2.WithParts, text: string) {
    const { Session } = await import("./index")
    const parts = answerParts(last.parts)
    if (parts.length === 0) return
    const target = parts[parts.length - 1]
    await Session.updatePart({ ...target, text })
    await Promise.all(
      parts.slice(0, -1).map((part) => (part.text ? Session.updatePart({ ...part, text: "" }) : undefined)),
    )
  }

  async function rewrite(input: {
    sessionID: string
    text: string
    findings: ReviewRecord.Finding[]
    model: { providerID: string; modelID: string }
    timeout: number
  }) {
    const { Agent } = await import("../agent/agent")
    const { Provider } = await import("../provider/provider")
    const { LLM } = await import("./llm")
    const reviewer = await Agent.get("reviewer")
    const model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
    if (!model) return
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), input.timeout)
    try {
      const stream = await LLM.stream({
        agent: { ...reviewer, prompt: REPAIR_SYSTEM, steps: 1 },
        user: {
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: "reviewer",
          model: input.model,
        },
        system: [],
        tools: {},
        model,
        abort: abort.signal,
        sessionID: input.sessionID,
        retries: 1,
        messages: [{ role: "user", content: repairPrompt(input.text, input.findings) }],
      })
      const raw = await stream.text
      if (!acceptRepair(input.text, raw)) return
      return raw.trim()
    } catch (error) {
      log.warn("review repair failed", {
        sessionID: input.sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      clearTimeout(timer)
    }
  }

  export async function gate(input: {
    sessionID: string
    agent?: string
    model: { providerID: string; modelID: string }
  }): Promise<ReviewRecord.Info | undefined> {
    const config = await Config.get()
    const research = (() => {
      try {
        return Instance.project.research
      } catch {
        return undefined
      }
    })()
    const domain = research?.domain
    const mode = modeFor(input.agent, config.experimental?.reviewGate, domain)
    if (mode === "off" || !input.agent) return

    const { Session } = await import("./index")
    const { SessionPrompt } = await import("./prompt")
    const messages = await Session.messages({ sessionID: input.sessionID })
    const last = messages.filter((message) => message.info.role === "assistant" && message.info.finish).at(-1)
    if (!last) return
    const text = answerText(last.parts)
    const existing = await ReviewRecord.get(input.sessionID, last.info.id)
    if (existing) return decide(existing)

    const started = Date.now()
    const citations = await CitationCheck.verify(text).catch(() => ({ items: [], verified: 0, missing: 0, errors: 0 }))
    const cited = [
      ...CitationCheck.findings(citations),
      ...ThemeSlots.check(research?.subdomain, text, { markerClusters: await markerClusters(messages) }),
    ]
    const full = shouldReview({ agent: input.agent, text }) && sessionHasToolCalls(messages)
    if (!full) {
      if (!cited.some((finding) => finding.severity === "blocking")) return
      const record: ReviewRecord.Info = {
        id: Identifier.ascending("review"),
        sessionID: input.sessionID,
        messageID: last.info.id,
        agent: input.agent,
        reviewer: "citation-check",
        mode,
        model: input.model,
        verdict: "FLAGGED",
        findings: cited,
        summary: cited[0]?.message,
        time: { started, completed: Date.now() },
      }
      await ReviewRecord.save(record).catch(() => undefined)
      return decide(record)
    }
    const reviewer = reviewerFor(input.agent, domain)
    const base = {
      id: Identifier.ascending("review"),
      sessionID: input.sessionID,
      messageID: last.info.id,
      agent: input.agent,
      reviewer,
      mode,
      model: input.model,
      time: { started, completed: started },
    } as const

    const record = await (async (): Promise<ReviewRecord.Info> => {
      const created = await Session.create({
        parentID: input.sessionID,
        title: `Review (@${reviewer})`,
        permission: [
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "todoread", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
        ],
      }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      if ("error" in created) {
        log.warn("review gate error", { sessionID: input.sessionID, reviewer, error: created.error })
        return {
          ...base,
          verdict: "ERROR",
          findings: [],
          error: created.error,
          summary: created.error,
          time: { started, completed: Date.now() },
        }
      }
      const child = created
      try {
        const parts = await SessionPrompt.resolvePromptParts(
          promptFor(text, [CitationCheck.note(citations), checklist(research?.subdomain)].filter(Boolean).join("\n")),
        )
        const run = SessionPrompt.prompt({
          messageID: Identifier.ascending("message"),
          sessionID: child.id,
          model: input.model,
          agent: reviewer,
          tools: { task: false, todowrite: false, todoread: false },
          parts,
        })
        const timeout = config.experimental?.reviewTimeoutMs ?? DEFAULT_TIMEOUT
        const timer = { value: undefined as ReturnType<typeof setTimeout> | undefined }
        const limit = new Promise<never>((_, reject) => {
          timer.value = setTimeout(() => {
            SessionPrompt.cancel(child.id)
            reject(new Error(`Reviewer timed out after ${timeout} ms`))
          }, timeout)
        })
        const result = await Promise.race([run, limit]).finally(() => {
          if (timer.value) clearTimeout(timer.value)
        })
        const raw = result.parts
          .filter((part) => part.type === "text")
          .map((part) => (part as MessageV2.TextPart).text)
          .join("\n")
          .trim()
        const parsed = merge(parse(raw), cited)
        const info = result.info as MessageV2.Assistant
        if (parsed.verdict === "FLAGGED") {
          const repaired = await rewrite({
            sessionID: input.sessionID,
            text,
            findings: parsed.findings,
            model: input.model,
            timeout: config.experimental?.reviewTimeoutMs ?? DEFAULT_TIMEOUT,
          })
          if (repaired) {
            const { OutputClean } = await import("./output-clean")
            await applyAnswer(last, OutputClean.clean(repaired))
            log.info("review gate corrected answer", {
              sessionID: input.sessionID,
              findings: parsed.findings.length,
            })
            return {
              ...base,
              reviewerSessionID: child.id,
              verdict: "CLEAN",
              findings: parsed.findings,
              summary: correctedSummary(parsed.findings),
              tokens: info.tokens,
              cost: info.cost,
              time: { started, completed: Date.now() },
            }
          }
        }
        return {
          ...base,
          reviewerSessionID: child.id,
          verdict: parsed.verdict,
          findings: parsed.findings,
          summary: parsed.verdict === "CLEAN" ? "No blocking issues found." : parsed.findings[0]?.message,
          tokens: info.tokens,
          cost: info.cost,
          time: { started, completed: Date.now() },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("review gate error", { sessionID: input.sessionID, reviewer, error: message })
        return {
          ...base,
          reviewerSessionID: child.id,
          verdict: "ERROR",
          findings: [],
          error: message,
          summary: message,
          time: { started, completed: Date.now() },
        }
      }
    })()

    const saved = await ReviewRecord.save(record)
      .then(() => true)
      .catch((error) => {
        log.error("failed to persist review record", {
          sessionID: input.sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      })
    if (!saved) {
      const failed: ReviewRecord.Info = {
        ...record,
        verdict: "ERROR",
        findings: [],
        error: "Failed to persist review record",
        summary: "Failed to persist review record",
        time: { started, completed: Date.now() },
      }
      return decide(failed)
    }
    log.info("review gate completed", {
      sessionID: input.sessionID,
      reviewer,
      verdict: record.verdict,
      duration: record.time.completed - record.time.started,
    })
    return decide(record)
  }
}
