/**
 * Experimental Design Advisor — comprehensive study design validation,
 * power analysis heuristics, and sample size recommendations.
 *
 * Now covers: RCT, case-control, cohort, cross-sectional, and
 * single-cell experimental designs.
 */

export namespace ExperimentDesign {
  export interface Advice {
    studyType: string
    power: string
    sampleSize: string
    designScore: number
    warnings: string[]
    recommendations: string[]
    hybio: string
  }

  export function analyze(text: string): Advice | undefined {
    const warnings: string[] = []
    const recommendations: string[] = []
    let designScore = 5 // starts at 5, deduct for issues

    // === Study type detection ===
    const types: Record<string, { pattern: RegExp; label: string }> = {
      comparative: {
        pattern: /\b(compare|between|vs|versus|against|across)\s+(group|condition|treatment|control|sample)s?\b/i,
        label: "Comparative (two/multi-group)",
      },
      correlational: {
        pattern: /\b(correlat|associat|relat).*\b(between|among)\b/i,
        label: "Correlational / Associational",
      },
      classification: { pattern: /\b(classif|predict|discriminat|diagnos)\b/i, label: "Classification / Diagnostic" },
      longitudinal: {
        pattern: /\b(longitudinal|time.?series|temporal|follow.?up|baseline.*endpoint|pre.*post)\b/i,
        label: "Longitudinal / Time-series",
      },
      survival: {
        pattern: /\b(survival|kaplan.meier|cox|hazard|censor|time.?to.?event)\b/i,
        label: "Survival / Time-to-event",
      },
      doseResponse: {
        pattern: /\b(dose.?response|concentration|titration|gradient|serial dilution)\b/i,
        label: "Dose-response",
      },
      singleCell: {
        pattern:
          /\b(single.?cell|scRNA|scATAC|scRNAseq|sctransform|seurat|scanpy|cell.*cluster|cell.*type|UMAP|tSNE)\b/i,
        label: "Single-cell",
      },
      metaAnalysis: {
        pattern: /\b(meta.?analysis|systematic review|pooled|effect.*combine)\b/i,
        label: "Meta-analysis",
      },
    }

    const detected = Object.entries(types).filter(([, t]) => t.pattern.test(text))
    if (detected.length === 0) return undefined
    const studyType = detected.map(([, t]) => t.label).join(" + ")
    designScore += detected.length

    // === Sample size analysis ===
    const sampleMatches = [
      ...text.matchAll(/\b(\d+)\s*(samples?|cells?|subjects?|observations?|replicates?|patients?)\b/gi),
    ]
    const sampleNs = sampleMatches.map((m) => parseInt(m[1]))
    const hasSampleSize = sampleNs.length > 0
    const minN = hasSampleSize ? Math.min(...sampleNs) : 0

    // Replicate design check
    if (hasSampleSize && !/\b(replicate|biological replicate|technical replicate|n\s*=\s*\d+)\b/i.test(text)) {
      warnings.push("No explicit replicate design mentioned — required for valid statistical inference.")
      designScore -= 1
    }

    // Batch/block effects
    if (
      hasSampleSize &&
      !/\b(block|batch|plate|lane|run|date|site|center)\s+(effect|design|correction|as.*covariate)\b/i.test(text)
    ) {
      recommendations.push("Consider blocking for known technical confounders (batch, plate, lane, run date).")
    }

    // === Power analysis heuristics ===
    let powerAdvice = ""
    const hasPower = /\b(power|sample.*size.*calculat|80%|90%|nQuery|G\*Power)\b/i.test(text)
    const hasEffectSize =
      /\b(effect\s*size|cohen'?s? d|hedges'? g|η²|η2|partial η|odds ratio|risk ratio|fold change|log2FC|logFC)\b.*?(\d+\.?\d*)/i

    if (hasPower) {
      designScore += 2
      powerAdvice = "Power analysis mentioned — good practice."
    } else if (hasEffectSize) {
      const m = text.match(hasEffectSize)
      const es = parseFloat(m![m!.length - 1])
      if (es < 0.2)
        powerAdvice = `Small effect size (${es}) — requires large N for adequate power (≥80%). Estimate: n≥394/group for t-test at α=0.05, β=0.2.`
      else if (es < 0.5)
        powerAdvice = `Medium effect size (${es}) — moderate N recommended. Estimate: n≥64/group for t-test at α=0.05, β=0.2.`
      else
        powerAdvice = `Large effect size (${es}) — smaller N acceptable. Estimate: n≥26/group for t-test at α=0.05, β=0.2.`
      designScore += 1
    } else {
      powerAdvice =
        "No power analysis or effect size specified. Recommend a pilot study or literature-based estimate before full experiment."
      designScore -= 1
    }

    // === Multiple testing correction ===
    const hasCorrection =
      /\b(bonferroni|fdr|bh\s+correction|benjamini|hochberg|holm|sid[áa]k|adjusted p|corrected p)\b/i.test(text)
    if (hasCorrection) designScore += 1
    if (/\b(many|multiple|thousands?|genome.?wide|all\s+genes?|transcriptome.?wide)\b/i.test(text) && !hasCorrection) {
      warnings.push("Multiple testing without correction — use FDR (Benjamini-Hochberg) or Bonferroni.")
      designScore -= 1
    }

    // === Design-specific checks ===
    let sampleAdvice = ""

    if (detected.some(([k]) => k === "singleCell")) {
      recommendations.push(
        "Single-cell: report number of cells/genes after QC filtering, doublet rate, and mitochondrial % cutoff.",
      )
      if (!hasSampleSize)
        warnings.push("Single-cell: specify expected number of cells to sequence (recommend ≥3,000 cells/sample).")
      else if (minN < 1000)
        warnings.push(`Single-cell: ${minN} cells is low. Consider ≥3,000 cells for robust clustering.`)
      designScore += 1
    }

    if (detected.some(([k]) => k === "comparative")) {
      if (minN > 0 && minN < 3) {
        warnings.push(`Sample size n=${minN}/group is too low. Minimum: n≥3 for exploratory, n≥5 for confirmatory.`)
        designScore -= 2
      } else if (minN >= 3 && minN < 5) {
        recommendations.push(
          `Sample size n=${minN}/group is marginal. Consider n≥5 for better statistical reliability.`,
        )
      }
    }

    if (detected.some(([k]) => k === "survival")) {
      if (!/\b(censor|event|follow.?up|at risk)\b/i.test(text)) {
        warnings.push("Survival analysis: document censoring mechanism, number of events, and median follow-up.")
      }
      designScore += 1
    }

    if (detected.some(([k]) => k === "metaAnalysis")) {
      recommendations.push(
        "Meta-analysis: report heterogeneity (I²), forest plot, publication bias (funnel plot/Egger test).",
      )
      designScore += 2
    }

    // Randomization check
    if (detected.some(([k]) => k === "comparative") && !/\b(random|randomize|randomization)\b/i.test(text)) {
      warnings.push(
        "Comparative study: no randomization mentioned. Consider random assignment to reduce selection bias.",
      )
    }

    // Blinding check
    if (
      /\b(clinical|trial|patient|subject|human|participant)\b/i.test(text) &&
      !/\b(blind|blinding|double.?blind|single.?blind|masked)\b/i.test(text)
    ) {
      recommendations.push("Clinical/human study: consider blinding to reduce assessment bias.")
    }

    return {
      studyType,
      power: powerAdvice,
      sampleSize: sampleAdvice || (minN > 0 ? `Detected n=${minN} minimum group size.` : ""),
      designScore: Math.max(0, designScore),
      warnings,
      recommendations,
      hybio: formatHybio(
        studyType,
        powerAdvice,
        sampleAdvice || (minN > 0 ? `n=${minN} min/group` : ""),
        designScore,
        warnings,
        recommendations,
      ),
    }
  }

  function formatHybio(
    studyType: string,
    power: string,
    sample: string,
    score: number,
    warnings: string[],
    recs: string[],
  ): string {
    const lines = ["<experiment-design-advisor>"]
    lines.push(`Study type: ${studyType}`)

    const scoreLabel = score >= 10 ? "Strong" : score >= 7 ? "Adequate" : score >= 4 ? "Needs improvement" : "Weak"
    lines.push(`Design score: ${score}/10+ (${scoreLabel})`)

    if (power) lines.push(`Power: ${power}`)
    if (sample) lines.push(`Sample: ${sample}`)

    if (warnings.length > 0) {
      lines.push(`\n⚠️ Warnings (${warnings.length}):`)
      for (const w of warnings) lines.push(`  - ${w}`)
    }

    if (recs.length > 0) {
      lines.push(`\n💡 Recommendations (${recs.length}):`)
      for (const r of recs) lines.push(`  - ${r}`)
    }

    lines.push("</experiment-design-advisor>")
    return lines.join("\n")
  }
}
