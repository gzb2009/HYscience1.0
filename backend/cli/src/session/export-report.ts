/**
 * Optional session wrap-up. Never writes into result/ — that folder is for
 * analysis deliverables, not tool traces or thinking.
 */

import path from "path"
import fs from "fs/promises"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace ExportReport {
  const log = Log.create({ service: "export-report" })

  export interface Section {
    heading: string
    content: string
  }

  export function stripLocale(text: string) {
    return text.replace(/<ui-locale\b[^>]*>/gi, "").replace(/\s+\n/g, "\n").trim()
  }

  export function isJunkClaim(claim: string) {
    const text = claim.replace(/[\s。．.，,：:；;！!？?·•\-—]/g, "")
    return text.length < 8
  }

  export function isJunkArtifact(filepath: string) {
    if (!filepath || filepath.includes("`") || filepath.includes("*")) return true
    if (filepath.length < 5) return true
    return /^(mtx|csv|tsv|png|json)$/i.test(filepath.split("/").pop() ?? "")
  }

  export function worthSaving(input: {
    assistantText: string
    conclusion: string
    findings: number
    artifacts: number
  }) {
    if (input.conclusion.trim().length >= 20) return true
    if (input.findings > 0 || input.artifacts > 0) return true
    return stripLocale(input.assistantText).length >= 80
  }

  export async function generate(sessionID: string): Promise<string> {
    const messages = await Session.messages({ sessionID })
    if (!messages.length) return ""

    const firstUser = messages.find((m) => m.info.role === "user")
    const question = stripLocale(
      firstUser
        ? firstUser.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p))
            .map((p) => p.text)
            .join("\n")
        : "",
    )

    const assistantText = messages
      .filter((m) => m.info.role === "assistant")
      .flatMap((m) =>
        m.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p)).map((p) => p.text),
      )
      .join("\n")

    const toolCalls: { tool: string; input: string }[] = []
    for (const msg of messages) {
      if (msg.info.role !== "assistant") continue
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== "bash" && part.tool !== "edit" && part.tool !== "write") continue
        const st = part.state as { input?: Record<string, unknown> }
        toolCalls.push({
          tool: part.tool,
          input: JSON.stringify(st.input ?? {}).slice(0, 120),
        })
      }
    }

    const artifacts = matchArtifacts(assistantText)
    const findings = matchFindings(assistantText)
    const conclusion = extractConclusion(assistantText)
    if (!worthSaving({ assistantText, conclusion, findings: findings.length, artifacts: artifacts.length })) return ""

    const sections: Section[] = [{ heading: "Research Question", content: question || "(not specified)" }]

    if (toolCalls.length > 0) {
      sections.push({
        heading: "Methodology",
        content: `${toolCalls.length} code steps`,
      })
    }

    if (findings.length > 0) {
      sections.push({
        heading: "Key Findings",
        content: findings
          .map((f) => {
            const prefix = f.confidence === "high" ? "✅" : f.confidence === "low" ? "⚠️" : "•"
            return `${prefix} **${f.claim}**\n  Evidence: ${f.evidence}`
          })
          .join("\n\n"),
      })
    }

    if (artifacts.length > 0) {
      sections.push({
        heading: "Artifacts",
        content: artifacts.map((a) => `- ${a.path} (${a.type})`).join("\n"),
      })
    }

    if (conclusion) sections.push({ heading: "Conclusion", content: conclusion })

    const lines: string[] = [
      `# Research Report`,
      `\n> Session: \`${sessionID}\` | Generated: ${new Date().toISOString()}`,
    ]
    for (const s of sections) {
      lines.push("", `## ${s.heading}`, "", s.content)
    }
    return lines.join("\n")
  }

  function matchArtifacts(text: string): { path: string; type: string }[] {
    const results: { path: string; type: string }[] = []
    const seen = new Set<string>()
    const re =
      /\b(\S+\.(?:png|jpg|jpeg|svg|webp|gif|csv|tsv|json|jsonl|h5ad|pdf|html|xlsx|parquet|npy|npz|h5|md|markdown|txt|py|r|sh|ipynb))\b/gi
    for (const m of text.matchAll(re)) {
      const fp = m[1]
      if (isJunkArtifact(fp) || seen.has(fp)) continue
      seen.add(fp)
      results.push({ path: fp, type: fp.split(".").pop()?.toUpperCase() ?? "FILE" })
    }
    return results
  }

  function matchFindings(text: string): { claim: string; evidence: string; confidence: "high" | "medium" | "low" }[] {
    const results: { claim: string; evidence: string; confidence: "high" | "medium" | "low" }[] = []
    const re =
      /(?:finding|result|found|observed?|发现|结果)[:：]?\s*(.+?)(?:\(confidence[:：]?\s*(high|medium|low)\)|$)/gi
    for (const m of text.matchAll(re)) {
      const claim = m[1]?.trim().slice(0, 200) ?? ""
      if (isJunkClaim(claim)) continue
      const confidence = m[2]?.toLowerCase()
      results.push({
        claim,
        evidence: m[0].slice(0, 150),
        confidence: confidence === "high" || confidence === "low" || confidence === "medium" ? confidence : "medium",
      })
    }
    return results.slice(0, 10)
  }

  function extractConclusion(text: string): string {
    const patterns = [
      /(?:conclusion|总结|in summary|to conclude)[:：]?\s*\n?(.{50,500}?)(?=\n\n|\n#|$)/is,
      /(?:in conclusion|to summarize|overall)[,，]\s*(.{50,500}?)(?=\n\n|\n#|$)/is,
    ]
    for (const p of patterns) {
      const m = text.match(p)
      if (m) return m[1].trim()
    }
    return ""
  }

  export async function save(sessionID: string, report: string): Promise<string> {
    const dir = path.join(Instance.directory, ".hyscience", "reports")
    await fs.mkdir(dir, { recursive: true })
    const name = `report-${sessionID.slice(0, 8)}.md`
    const filepath = path.join(dir, name)
    await Bun.write(filepath, report)
    log.info("report saved", { sessionID, path: filepath })
    return filepath
  }

  export async function generateAndSave(sessionID: string): Promise<string | undefined> {
    try {
      const report = await generate(sessionID)
      if (!report) return undefined
      return await save(sessionID, report)
    } catch (e) {
      log.warn("report generation failed", { error: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  }
}
