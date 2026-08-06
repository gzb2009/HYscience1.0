/**
 * Session Report Generator — produces a self-contained Markdown research report
 * from a completed session, including structured sections for all research stages.
 *
 * Output saved to the project's result directory.
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

  /**
   * Build a structured Markdown report from a session's messages.
   *
   * Report structure:
   *   # Research Report
   *   ## Summary
   *   ## Research Question
   *   ## Methodology
   *   ## Key Findings
   *   ## Figures & Tables
   *   ## Conclusion
   *   ## Artifacts
   */
  export async function generate(sessionID: string): Promise<string> {
    const messages = await Session.messages({ sessionID })
    if (!messages.length) return ""

    const sections: Section[] = []

    // Extract research question from first user message
    const firstUser = messages.find((m) => m.info.role === "user")
    const question = firstUser
      ? firstUser.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p))
          .map((p) => p.text)
          .join("\n")
      : ""

    // Extract all assistant text responses (non-hybio)
    const allText = messages
      .filter((m) => m.info.role === "assistant")
      .flatMap((m) =>
        m.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p)).map((p) => p.text),
      )
      .join("\n")

    // Extract tool calls and their outputs
    const toolCalls: { tool: string; input: string; output: string }[] = []
    for (const msg of messages) {
      if (msg.info.role !== "assistant") continue
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const st = part.state as { status: string; input?: Record<string, any>; output?: string; error?: string }
        toolCalls.push({
          tool: part.tool,
          input: JSON.stringify(st.input ?? {}).slice(0, 200),
          output:
            st.status === "completed"
              ? (st.output ?? "").slice(0, 300)
              : st.status === "error"
                ? `Error: ${st.error ?? ""}`
                : "(running)",
        })
      }
    }

    // Extract artifact paths from text
    const artifacts = matchArtifacts(allText)

    // Extract findings from text (hypothesis testing results)
    const findings = matchFindings(allText)

    // Build sections
    sections.push({ heading: "Research Question", content: question || "(not specified)" })

    sections.push({
      heading: "Methodology",
      content: toolCalls.length
        ? toolCalls
            .filter((t) => t.tool === "bash" || t.tool === "edit" || t.tool === "write")
            .map((t) => `- \`${t.tool}\`: ${t.input.slice(0, 120)}`)
            .join("\n") || "_No code execution recorded_"
        : "_No tool calls recorded_",
    })

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
        content: artifacts
          .map((a) => {
            const fpart = messages
              .flatMap((m) => m.parts)
              .find((p) => p.type === "file" && (p as any).filename === a.path.split("/").pop())
            const url = fpart ? (fpart as any).url : ""
            return url ? `- [${a.path.split("/").pop()}](${url}) (${a.type})` : `- ${a.path} (${a.type})`
          })
          .join("\n"),
      })
    }

    // Extract concluding paragraph
    const conclusion = extractConclusion(allText)
    if (conclusion) {
      sections.push({ heading: "Conclusion", content: conclusion })
    }

    // Assemble
    const lines: string[] = [
      `# Research Report`,
      `\n> Session: \`${sessionID}\` | Generated: ${new Date().toISOString()}`,
    ]

    for (const s of sections) {
      lines.push("", `## ${s.heading}`, "", s.content)
    }

    // Appendix: raw tool calls
    if (toolCalls.length > 0) {
      lines.push("", "---", "", "## Appendix: Tool Calls", "")
      lines.push("| Tool | Input | Output |")
      lines.push("|------|-------|--------|")
      for (const t of toolCalls.slice(0, 30)) {
        lines.push(`| ${t.tool} | ${t.input.slice(0, 80)} | ${t.output.slice(0, 80)} |`)
      }
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
      if (!seen.has(fp)) {
        seen.add(fp)
        results.push({ path: fp, type: fp.split(".").pop()?.toUpperCase() ?? "FILE" })
      }
    }
    return results
  }

  function matchFindings(text: string): { claim: string; evidence: string; confidence: "high" | "medium" | "low" }[] {
    const results: { claim: string; evidence: string; confidence: "high" | "medium" | "low" }[] = []
    const re =
      /(?:finding|result|found|observed?|发现|结果)[:：]?\s*(.+?)(?:\(confidence[:：]?\s*(high|medium|low)\)|$)/gi
    for (const m of text.matchAll(re)) {
      results.push({
        claim: m[1]?.trim().slice(0, 200) ?? "",
        evidence: m[0].slice(0, 150),
        confidence: (m[2]?.toLowerCase() as any) ?? "medium",
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
    const dir = path.join(Instance.worktree, "result")
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
