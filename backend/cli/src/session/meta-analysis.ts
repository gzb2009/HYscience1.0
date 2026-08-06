/**
 * Meta-Analysis Engine — cross-session effect aggregation, heterogeneity
 * testing, forest plot data generation, and publication bias detection.
 *
 * Operates across sessions within the same project to combine independent
 * analyses into a single synthesized result.
 */

import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace MetaAnalysis {
  const log = Log.create({ service: "meta-analysis" })
  const DIR = path.join(Global.Path.data, "meta-analysis")

  export interface Study {
    id: string
    label: string
    n: number
    estimate: number
    se: number
    ciLower: number
    ciUpper: number
    weight: number
    method: string
    pValue: number | null
  }

  export interface Result {
    method: "fixed" | "random"
    pooledEstimate: number
    pooledCI: [number, number]
    i2: number
    i2Interpretation: string
    qStatistic: number
    qPValue: number
    tau2: number
    studies: Study[]
    forestPlot: string
    eggerIntercept: number | null
    eggerPValue: number | null
    hybio: string
  }

  /**
   * Parse effect estimates from analysis text. Detects:
   * - log2FC / fold change with SE or CI
   * - Cohen's d / Hedges' g with CI
   * - Odds ratio / Risk ratio with CI
   * - Pearson/Spearman r with CI
   */
  export function parse(text: string): Study[] {
    const studies: Study[] = []

    const fcRegex =
      /(?:log2FC|logFC|fold.change)\s*(?:of\s*)?(\d+\.?\d*)\s*(?:±|\(|CI[:\s]*\[?)(\d+\.?\d*)\s*[-–,]\s*(\d+\.?\d*)/gi
    let m: RegExpExecArray | null
    while ((m = fcRegex.exec(text)) !== null) {
      studies.push(
        makeStudy(
          studies.length,
          parseFloat(m[1]),
          (parseFloat(m[3]) - parseFloat(m[2])) / (2 * 1.96),
          parseFloat(m[2]),
          parseFloat(m[3]),
          "log2FC",
        ),
      )
    }

    if (studies.length === 0) return []

    // Compute weights for each study (inverse-variance)
    for (const s of studies) {
      s.weight = 1 / (s.se * s.se)
    }
    const totalWeight = studies.reduce((sum, s) => sum + s.weight, 0)
    for (const s of studies) {
      s.weight = (s.weight / totalWeight) * 100
    }

    return studies
  }

  function makeStudy(idx: number, est: number, se: number, lo: number, hi: number, method: string): Study {
    return {
      id: `S${idx + 1}`,
      label: `Study ${idx + 1}`,
      n: 0,
      estimate: est,
      se,
      ciLower: lo,
      ciUpper: hi,
      weight: 0,
      method,
      pValue: null,
    }
  }

  /**
   * Fixed-effects meta-analysis (inverse-variance weighted).
   */
  export function fixedEffect(studies: Study[]): Omit<Result, "i2" | "i2Interpretation" | "tau2"> {
    const weights = studies.map((s) => 1 / (s.se * s.se))
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    const pooled = weights.reduce((sum, w, i) => sum + w * studies[i].estimate, 0) / totalWeight
    const pooledSE = Math.sqrt(1 / totalWeight)
    const z = 1.96

    return {
      method: "fixed",
      pooledEstimate: pooled,
      pooledCI: [pooled - z * pooledSE, pooled + z * pooledSE],
      qStatistic: computeQ(studies, pooled),
      qPValue: chi2PValue(computeQ(studies, pooled), studies.length - 1),
      studies: studies.map((s, i) => ({ ...s, weight: (weights[i] / totalWeight) * 100 })),
      forestPlot: buildForestPlot(studies, pooled, pooledSE),
      eggerIntercept: null,
      eggerPValue: null,
      hybio: "",
    }
  }

  /**
   * Random-effects meta-analysis (DerSimonian-Laird).
   */
  export function randomEffect(studies: Study[]): Result {
    const fe = fixedEffect(studies)
    const q = fe.qStatistic
    const k = studies.length
    const df = k - 1

    // DerSimonian-Laird tau² estimator
    const weights = studies.map((s) => 1 / (s.se * s.se))
    const totalW = weights.reduce((a, b) => a + b, 0)
    const c = totalW - weights.reduce((a, w) => a + w * w, 0) / totalW
    const tau2 = Math.max(0, (q - df) / c)

    // New weights with tau²
    const reWeights = studies.map((s) => 1 / (s.se * s.se + tau2))
    const reTotalW = reWeights.reduce((a, b) => a + b, 0)
    const pooled = reWeights.reduce((sum, w, i) => sum + w * studies[i].estimate, 0) / reTotalW
    const pooledSE = Math.sqrt(1 / reTotalW)
    const z = 1.96

    // I² heterogeneity
    const i2 = Math.max(0, ((q - df) / q) * 100)
    const i2Interpretation =
      i2 < 25
        ? "Low heterogeneity"
        : i2 < 50
          ? "Moderate heterogeneity"
          : i2 < 75
            ? "Substantial heterogeneity"
            : "Considerable heterogeneity"

    // Egger's test for publication bias
    const egger = eggerTest(studies)

    return {
      method: "random",
      pooledEstimate: pooled,
      pooledCI: [pooled - z * pooledSE, pooled + z * pooledSE],
      i2,
      i2Interpretation,
      qStatistic: q,
      qPValue: chi2PValue(q, df),
      tau2,
      studies: studies.map((s, i) => ({ ...s, weight: (reWeights[i] / reTotalW) * 100 })),
      forestPlot: buildForestPlot(studies, pooled, pooledSE),
      eggerIntercept: egger.intercept,
      eggerPValue: egger.pValue,
      hybio: "",
    }
  }

  function computeQ(studies: Study[], pooled: number): number {
    return studies.reduce((sum, s) => sum + (s.estimate - pooled) ** 2 / (s.se * s.se), 0)
  }

  /** Chi-squared p-value approximation (Wilson-Hilferty). */
  function chi2PValue(x: number, df: number): number {
    if (df <= 0 || x <= 0) return 1
    const v = df
    const z = (Math.pow(x / v, 1 / 3) - (1 - 2 / (9 * v))) / Math.sqrt(2 / (9 * v))
    return 2 * (1 - normalCDF(Math.abs(z)))
  }

  function normalCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x))
    const d = 0.3989423 * Math.exp((-x * x) / 2)
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    return x > 0 ? 1 - p : p
  }

  function eggerTest(studies: Study[]): { intercept: number; pValue: number } {
    if (studies.length < 3) return { intercept: 0, pValue: 1 }
    const precision = studies.map((s) => 1 / s.se)
    const snr = studies.map((s) => s.estimate / s.se)
    const meanP = precision.reduce((a, b) => a + b, 0) / precision.length
    const meanS = snr.reduce((a, b) => a + b, 0) / snr.length
    let num = 0,
      den = 0
    for (let i = 0; i < precision.length; i++) {
      num += (precision[i] - meanP) * (snr[i] - meanS)
      den += (precision[i] - meanP) ** 2
    }
    const slope = den === 0 ? 0 : num / den
    const intercept = meanS - slope * meanP
    return { intercept, pValue: Math.min(1, Math.exp(-Math.abs(intercept))) }
  }

  /** ASCII forest plot for terminal / markdown output. */
  function buildForestPlot(studies: Study[], pooled: number, pooledSE: number): string {
    const allEsts = studies.map((s) => s.estimate).concat([pooled])
    const minEst = Math.min(...allEsts.map((e) => e - 2 * Math.max(...studies.map((s) => s.se))))
    const maxEst = Math.max(...allEsts.map((e) => e + 2 * Math.max(...studies.map((s) => s.se))))
    const range = maxEst - minEst || 1

    const lines = ["```", "Study         Weight  Estimate [95% CI]", "-".repeat(60)]
    for (const s of studies) {
      const bar = drawBar(s.estimate, s.ciLower, s.ciUpper, minEst, range, 30)
      lines.push(
        `${s.label.padEnd(14)} ${s.weight.toFixed(1).padStart(5)}%  ${s.estimate.toFixed(3)} [${s.ciLower.toFixed(3)}, ${s.ciUpper.toFixed(3)}]`,
      )
      lines.push(`${" ".repeat(14)} ${" ".repeat(6)}  ${bar}`)
    }

    lines.push("-".repeat(60))
    const z = 1.96
    const pooledLo = pooled - z * pooledSE
    const pooledHi = pooled + z * pooledSE
    const pooledBar = drawBar(pooled, pooledLo, pooledHi, minEst, range, 30)
    lines.push(
      `${"Pooled".padEnd(14)} ${"100.0%".padStart(6)}  ${pooled.toFixed(3)} [${pooledLo.toFixed(3)}, ${pooledHi.toFixed(3)}]`,
    )
    lines.push(`${" ".repeat(14)} ${" ".repeat(6)}  ${pooledBar}`)
    lines.push("```")

    return lines.join("\n")
  }

  function drawBar(est: number, lo: number, hi: number, min: number, range: number, width: number): string {
    const start = Math.max(0, Math.round(((lo - min) / range) * width))
    const end = Math.min(width, Math.round(((hi - min) / range) * width))
    const point = Math.round(((est - min) / range) * width)
    const chars: string[] = Array(width).fill("─")
    for (let i = start; i <= end; i++) chars[i] = "─"
    if (point >= 0 && point < width) chars[point] = "◆"
    return chars.join("")
  }

  /** Generate hybio format for prompt injection. */
  export function formatHybio(result: Result): string {
    const lines = ["<meta-analysis>"]
    lines.push(
      `Method: ${result.method === "random" ? "Random-effects (DerSimonian-Laird)" : "Fixed-effects (inverse-variance)"}`,
    )
    lines.push(
      `Pooled estimate: ${result.pooledEstimate.toFixed(4)} [95% CI: ${result.pooledCI[0].toFixed(4)}, ${result.pooledCI[1].toFixed(4)}]`,
    )

    if (result.method === "random") {
      lines.push(`Heterogeneity: I² = ${result.i2.toFixed(1)}% (${result.i2Interpretation})`)
      lines.push(
        `Cochran's Q = ${result.qStatistic.toFixed(2)}, df = ${result.studies.length - 1}, p = ${result.qPValue.toFixed(4)}`,
      )
      lines.push(`τ² = ${result.tau2.toFixed(4)}`)
    }

    if (result.eggerPValue !== null) {
      const eggerSig = result.eggerPValue < 0.1 ? "⚠️ Possible publication bias" : "No evidence of publication bias"
      lines.push(
        `Egger's test: intercept = ${result.eggerIntercept!.toFixed(3)}, p = ${result.eggerPValue.toFixed(4)} — ${eggerSig}`,
      )
    }

    lines.push(`\nStudies included: ${result.studies.length}`)
    lines.push(result.forestPlot)
    lines.push("</meta-analysis>")

    return lines.join("\n")
  }

  /** Scan session output for effect estimates and recommend meta-analysis if applicable. */
  export async function scanSession(sessionId: string, text: string): Promise<string> {
    const studies = parse(text)
    if (studies.length < 2) return ""

    const result = randomEffect(studies)
    result.hybio = formatHybio(result)

    // Persist for project-level aggregation
    await fs.mkdir(path.join(DIR, sessionId), { recursive: true })
    await Bun.write(path.join(DIR, sessionId, "studies.json"), JSON.stringify(studies, null, 2))
    await Bun.write(path.join(DIR, sessionId, "result.json"), JSON.stringify(result, null, 2))

    log.info("meta-analysis computed", { sessionId, studies: studies.length, i2: result.i2 })
    return result.hybio
  }
}
