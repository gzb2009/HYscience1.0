/**
 * Literature Contradiction Detection — when both a literature review and
 * data analysis exist for the same session, scan for contradictions
 * between literature claims and analysis results.
 *
 * Non-blocking: injects hybio warnings when conflicts found.
 */

import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"
import { Log } from "@/util/log"

export namespace LiteratureCheck {
  const log = Log.create({ service: "literature-check" })

  export interface Contradiction {
    claim: string
    literatureSource: string
    analysisFinding: string
    severity: "high" | "medium" | "low"
    recommendation: string
  }

  export interface Report {
    contradictions: Contradiction[]
    hybio: string
  }

  /**
   * Compare literature-review.md content against analysis output.
   * Returns contradictions found.
   */
  export async function detect(text: string): Promise<Report> {
    const contradictions: Contradiction[] = []

    // Try to read the literature review file
    const candidates = ["literature-review.md", path.join(".context", "literature-review.md")]
    let litText = ""
    for (const rel of candidates) {
      const full = path.join(Instance.directory, rel)
      try {
        litText = await Bun.file(full).text()
        break
      } catch {}
    }

    if (!litText) return { contradictions: [], hybio: "" }

    // === Contradiction heuristics ===

    // 1. Divergent gene expression direction claims
    const litUp = extractDirection(litText, "up|overexpress|increas|upregulat|higher|elevat")
    const textUp = extractDirection(text, "up|overexpress|increas|upregulat|higher|elevat")
    const litDown = extractDirection(litText, "down|underexpress|decreas|downregulat|lower|reduc|suppress")
    const textDown = extractDirection(text, "down|underexpress|decreas|downregulat|lower|reduc|suppress")

    // Check if same gene is claimed up in one but down in another
    for (const gene of litUp) {
      if (textDown.includes(gene)) {
        contradictions.push({
          claim: `${gene} expression direction`,
          literatureSource: `Literature reports ${gene} as upregulated`,
          analysisFinding: `Your analysis suggests ${gene} is downregulated`,
          severity: "high",
          recommendation: `Verify experimental conditions and normalization. ${gene} may be context-dependent — check tissue/cell type and treatment conditions in the literature.`,
        })
      }
    }
    for (const gene of litDown) {
      if (textUp.includes(gene)) {
        contradictions.push({
          claim: `${gene} expression direction`,
          literatureSource: `Literature reports ${gene} as downregulated`,
          analysisFinding: `Your analysis suggests ${gene} is upregulated`,
          severity: "high",
          recommendation: `Discrepancy in ${gene} expression direction. Verify your analysis pipeline and check if literature studies used similar conditions.`,
        })
      }
    }

    // 2. Pathway activation conflicts
    const litPathways = extractNamed(
      litText,
      /\b(Wnt|Notch|Hedgehog|TGF.?β|TGF.?beta|NF.?κB|MAPK|PI3K|Akt|mTOR|p53|JAK.?STAT|Hippo)\s+(activated|upregulated|enhanced|increased)\b/gi,
    )
    const textPathways = extractNamed(
      text,
      /\b(Wnt|Notch|Hedgehog|TGF.?β|TGF.?beta|NF.?κB|MAPK|PI3K|Akt|mTOR|p53|JAK.?STAT|Hippo)\s+(suppressed|inhibited|downregulated|decreased|inactivated)\b/gi,
    )

    for (const pw of litPathways) {
      if (textPathways.includes(pw)) {
        contradictions.push({
          claim: `${pw} pathway activity`,
          literatureSource: `Literature reports ${pw} pathway as activated`,
          analysisFinding: `Your analysis suggests ${pw} pathway is suppressed`,
          severity: "medium",
          recommendation: `${pw} pathway may have context-dependent dual roles. Check if your experimental model differs from literature studies.`,
        })
      }
    }

    // 3. Effect size magnitude mismatch
    const litEffects = extractNumbered(litText, /(?:fold.change|log2FC|logFC|effect)\s*(?:of\s*)?(\d+\.?\d*)/gi)
    const textEffects = extractNumbered(text, /(?:fold.change|log2FC|logFC|effect)\s*(?:of\s*)?(\d+\.?\d*)/gi)

    for (const le of litEffects) {
      const match = textEffects.find((te) => Math.abs(parseFloat(te.value) - parseFloat(le.value)) > 2)
      if (match) {
        contradictions.push({
          claim: `Effect size of ${le.name || "finding"}`,
          literatureSource: `${le.name || "Literature"}: effect size ${le.value}`,
          analysisFinding: `Your analysis: effect size ${match.value}`,
          severity: "medium",
          recommendation: `Large effect size discrepancy (${le.value} vs ${match.value}). Check if measurement methods or normalization differ.`,
        })
        break // One is enough
      }
    }

    return {
      contradictions,
      hybio: formatHybio(contradictions),
    }
  }

  function extractDirection(text: string, pattern: string): string[] {
    const regex = new RegExp(
      `\\b([A-Z][A-Z0-9]{1,8})\\b.*?(?:${pattern})|(?:${pattern}).*?\\b([A-Z][A-Z0-9]{1,8})\\b`,
      "gi",
    )
    const genes = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      const g = m[1] || m[2]
      if (g && !/^(THE|AND|FOR|WITH|FROM|THIS|THAT|ALSO|ONLY|MORE|LESS|EACH|SOME|ANY|ALL|OTHER|SUCH)$/i.test(g)) {
        genes.add(g)
      }
    }
    return [...genes]
  }

  function extractNamed(text: string, regex: RegExp): string[] {
    const names = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      names.add(m[1])
    }
    return [...names]
  }

  function extractNumbered(text: string, regex: RegExp): Array<{ name?: string; value: string }> {
    const results: Array<{ name?: string; value: string }> = []
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      results.push({ name: m[1] ? undefined : m[0], value: m[1] || m[0].replace(/[^\d.]/g, "") })
    }
    return results
  }

  function formatHybio(contradictions: Contradiction[]): string {
    if (contradictions.length === 0) return ""
    const lines = ["<literature-contradiction-check>"]

    const high = contradictions.filter((c) => c.severity === "high")
    const med = contradictions.filter((c) => c.severity === "medium")

    if (high.length > 0) {
      lines.push(`\n🔴 High-severity contradictions (${high.length}):`)
      for (const h of high) {
        lines.push(`  ${h.claim}:`)
        lines.push(`    Literature: ${h.literatureSource}`)
        lines.push(`    Analysis: ${h.analysisFinding}`)
        lines.push(`    → ${h.recommendation}`)
      }
    }

    if (med.length > 0) {
      lines.push(`\n🟡 Medium-severity discrepancies (${med.length}):`)
      for (const m of med) {
        lines.push(`  ${m.claim}: ${m.recommendation}`)
      }
    }

    if (contradictions.length > 0) {
      lines.push(
        "\nAddress contradictions before finalizing results. If analysis is correct, document why it differs from literature.",
      )
    }

    lines.push("</literature-contradiction-check>")
    return lines.join("\n")
  }
}
