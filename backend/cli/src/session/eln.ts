import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace ELN {
  const log = Log.create({ service: "eln" })
  const DIR = path.join(Global.Path.data, "eln")

  export type Status = "planned" | "running" | "completed" | "failed"

  export interface ExperimentRecord {
    id: string
    sessionId: string
    timestamp: number
    title: string
    hypothesis: string
    method: string
    parameters: Record<string, string>
    findings: Finding[]
    observations: string[]
    artifacts: string[]
    conclusion: string
    status: Status
  }

  export interface Finding {
    metric: string
    value: string
    interpretation: string
    confidence: "high" | "medium" | "low"
  }

  export function parse(text: string, sessionId: string): ExperimentRecord[] {
    const results: ExperimentRecord[] = []
    const regex = /<experiment\s+id="([^"]+)"(?:\s+title="([^"]*)")?>([\s\S]*?)<\/experiment>/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const id = match[1]
      const title = match[2] || id
      const block = match[3]
      const extract = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
        return m?.[1]?.trim() ?? ""
      }
      const findings: Finding[] = []
      const fre =
        /<finding\s+metric="([^"]+)"\s+value="([^"]+)"(?:\s+confidence="(high|medium|low)")?>(.*?)<\/finding>/g
      let fm: RegExpExecArray | null
      while ((fm = fre.exec(block)) !== null) {
        findings.push({
          metric: fm[1],
          value: fm[2],
          interpretation: fm[4]?.trim() ?? "",
          confidence: (fm[3] as Finding["confidence"]) ?? "medium",
        })
      }
      const observations: string[] = []
      const ore = /<observation>(.*?)<\/observation>/g
      let om: RegExpExecArray | null
      while ((om = ore.exec(block)) !== null) observations.push(om[1].trim())
      const artifacts: string[] = []
      const are = /<artifact>(.*?)<\/artifact>/g
      let am: RegExpExecArray | null
      while ((am = are.exec(block)) !== null) artifacts.push(am[1].trim())
      const ps = extract("parameters")
      const parameters: Record<string, string> = ps
        ? (() => {
            try {
              return JSON.parse(ps)
            } catch {
              return {}
            }
          })()
        : {}
      const cm = block.match(/<conclusion(?:\s+status="(completed|failed)")?>(.*?)<\/conclusion>/)
      const conclusion = cm?.[2]?.trim() ?? extract("conclusion")
      const status = (cm?.[1] as Status) ?? "completed"
      results.push({
        id,
        sessionId,
        timestamp: Date.now(),
        title,
        hypothesis: extract("hypothesis"),
        method: extract("method"),
        parameters,
        findings,
        observations,
        artifacts,
        conclusion,
        status,
      })
    }
    return results
  }

  export async function save(r: ExperimentRecord): Promise<void> {
    await fs.mkdir(path.join(DIR, r.sessionId), { recursive: true })
    await Bun.write(path.join(DIR, r.sessionId, `${r.id}.json`), JSON.stringify(r, null, 2))
    log.info("eln saved", { id: r.id, sessionId: r.sessionId })
  }

  export async function load(sessionId: string): Promise<ExperimentRecord[]> {
    try {
      const files = await fs.readdir(path.join(DIR, sessionId))
      const out: ExperimentRecord[] = []
      for (const f of files) {
        if (!f.endsWith(".json")) continue
        out.push((await Bun.file(path.join(DIR, sessionId, f)).json()) as ExperimentRecord)
      }
      return out.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
      return []
    }
  }

  export function markdown(recs: ExperimentRecord[]): string {
    if (recs.length === 0) return ""
    const lines = ["# Experiment Records", ""]
    for (const r of recs) {
      const icon = r.status === "completed" ? "✅" : r.status === "failed" ? "❌" : "🔄"
      lines.push(
        `## ${icon} ${r.title}`,
        "",
        `- **Status**: ${r.status}`,
        `- **Hypothesis**: ${r.hypothesis}`,
        `- **Method**: ${r.method}`,
      )
      for (const [k, v] of Object.entries(r.parameters)) lines.push(`  - ${k}: ${v}`)
      if (r.findings.length) {
        lines.push(
          "",
          "| Metric | Value | Interpretation | Confidence |",
          "|--------|-------|----------------|------------|",
        )
        for (const f of r.findings) lines.push(`| ${f.metric} | ${f.value} | ${f.interpretation} | ${f.confidence} |`)
      }
      if (r.observations.length) {
        lines.push("", "**Observations:**")
        for (const o of r.observations) lines.push(`- ${o}`)
      }
      if (r.conclusion) lines.push("", `**Conclusion**: ${r.conclusion}`)
      lines.push("")
    }
    return lines.join("\n")
  }

  export async function scanSession(
    sessionId: string,
    messages: { parts: { type: string; text?: string }[] }[],
  ): Promise<number> {
    let count = 0
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "text" || !part.text) continue
        for (const r of parse(part.text, sessionId)) {
          await save(r)
          count++
        }
      }
    }
    return count
  }
}
