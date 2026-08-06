/**
 * Active Learning Advisor — recommends the most informative samples to
 * label next using uncertainty sampling, entropy-based selection, and
 * diversity sampling strategies.
 *
 * For classification/annotation tasks in biology (cell type annotation,
 * disease classification, etc.), reduces labeling cost by prioritizing
 * the most informative examples.
 */

import { Log } from "@/util/log"

export namespace ActiveLearn {
  const log = Log.create({ service: "active-learn" })

  export interface Sample {
    id: string
    label: string | null
    predictedClass: string | null
    confidence: number
    entropy: number
    unlabeled: boolean
  }

  export interface Recommendation {
    strategy: string
    samples: string[]
    rationale: string
    expectedGain: string
    hybio: string
  }

  /**
   * Parse prediction results from analysis output and identify
   * unlabeled/low-confidence samples.
   */
  export function parsePredictions(text: string): Sample[] {
    const samples: Sample[] = []

    // Detect prediction tables (common formats)
    const tableRegex = /([A-Za-z0-9_-]+)\s+([A-Za-z0-9_\s-]+?)\s+(0?\.\d+)\s+(0?\.\d+)/g
    let m: RegExpExecArray | null
    while ((m = tableRegex.exec(text)) !== null) {
      samples.push({
        id: m[1],
        label: m[2].trim(),
        predictedClass: m[2].trim(),
        confidence: parseFloat(m[3]),
        entropy: -parseFloat(m[3]) * Math.log2(Math.max(parseFloat(m[3]), 0.001)),
        unlabeled: parseFloat(m[3]) < 0.6,
      })
    }

    // Detect "unlabeled" or "unknown" annotations
    const unknownRegex = /([A-Za-z0-9_-]+)\s+(?:unlabeled|unknown|uncertain|low.confidence)/gi
    while ((m = unknownRegex.exec(text)) !== null) {
      samples.push({
        id: m[1],
        label: null,
        predictedClass: null,
        confidence: 0.3,
        entropy: 1.5,
        unlabeled: true,
      })
    }

    // Detect high-uncertainty predictions
    const highEntropyRegex = /([A-Za-z0-9_-]+).*?(?:entropy|uncertainty).*?(\d+\.?\d*)/gi
    while ((m = highEntropyRegex.exec(text)) !== null) {
      const id = m[1]
      const existing = samples.find((s) => s.id === id)
      if (!existing) {
        const entropy = parseFloat(m[2])
        samples.push({
          id,
          label: null,
          predictedClass: null,
          confidence: entropy > 1 ? 0.3 : 0.5,
          entropy: Math.min(entropy, 3),
          unlabeled: entropy > 1,
        })
      }
    }

    return samples
  }

  /**
   * Uncertainty sampling: recommend samples with lowest model confidence.
   */
  export function uncertaintySampling(samples: Sample[], n: number = 5): Recommendation {
    const unlabeled = samples.filter((s) => s.unlabeled)
    const byConfidence = [...unlabeled].sort((a, b) => a.confidence - b.confidence)
    const selected = byConfidence.slice(0, n)

    return {
      strategy: "Uncertainty Sampling (least confident)",
      samples: selected.map((s) => s.id),
      rationale: `Selected ${selected.length} samples with lowest prediction confidence (range: ${selected[0]?.confidence.toFixed(3) ?? "N/A"} - ${selected[selected.length - 1]?.confidence.toFixed(3) ?? "N/A"})`,
      expectedGain: `Expected to resolve ${selected.length} high-uncertainty predictions, improving overall accuracy by ~${estimateGain(selected.length, samples.length).toFixed(1)}%`,
      hybio: "",
    }
  }

  /**
   * Entropy-based sampling: recommend samples with highest prediction entropy.
   */
  export function entropySampling(samples: Sample[], n: number = 5): Recommendation {
    const unlabeled = samples.filter((s) => s.unlabeled)
    const byEntropy = [...unlabeled].sort((a, b) => b.entropy - a.entropy)
    const selected = byEntropy.slice(0, n)

    return {
      strategy: "Entropy Sampling (maximum entropy)",
      samples: selected.map((s) => s.id),
      rationale: `Selected ${selected.length} samples with highest entropy (range: ${selected[0]?.entropy.toFixed(2) ?? "N/A"} - ${selected[selected.length - 1]?.entropy.toFixed(2) ?? "N/A"})`,
      expectedGain: `Expected to reduce overall entropy by ~${(
        (selected.reduce((s, x) => s + x.entropy, 0) /
          Math.max(
            samples.reduce((s, x) => s + x.entropy, 0),
            0.01,
          )) *
        100
      ).toFixed(1)}%`,
      hybio: "",
    }
  }

  /**
   * Hybrid strategy combining uncertainty + diversity.
   */
  export function hybridSampling(samples: Sample[], n: number = 5): Recommendation {
    const unlabeled = samples.filter((s) => s.unlabeled)
    if (unlabeled.length === 0) return uncertaintySampling(samples, n)

    // Sort by uncertainty (lowest confidence)
    const sorted = [...unlabeled].sort((a, b) => a.confidence - b.confidence)

    // Select diverse top candidates
    const selected: Sample[] = []
    const selectedIds = new Set<string>()
    for (const s of sorted) {
      if (selected.length >= n) break
      // Skip if too similar to already selected (simple dedup on predicted class)
      const duplicate = selected.some((sel) => sel.predictedClass === s.predictedClass)
      if (duplicate && selected.length > 1) continue
      selected.push(s)
      selectedIds.add(s.id)
    }

    return {
      strategy: "Hybrid (uncertainty + diversity)",
      samples: [...selectedIds],
      rationale: `Selected ${selected.length} diverse, low-confidence samples from ${unlabeled.length} unlabeled items`,
      expectedGain: `Diverse selection ensures broad coverage. Expected ~${estimateGain(selected.length, samples.length).toFixed(1)}% accuracy improvement.`,
      hybio: "",
    }
  }

  function estimateGain(labeled: number, total: number): number {
    if (total === 0) return 0
    const fraction = labeled / total
    return Math.min(15, fraction * 100 * 0.3)
  }

  /**
   * Generate hybio injection with active learning recommendations.
   */
  export function formatHybio(rec: Recommendation, totalSamples: number, totalUnlabeled: number): string {
    const lines = ["<active-learning>"]

    lines.push(`Dataset: ${totalSamples} total samples, ${totalUnlabeled} unlabeled/low-confidence`)

    if (totalUnlabeled === 0) {
      lines.push("All samples have high-confidence predictions. No active learning needed.")
      lines.push("</active-learning>")
      return lines.join("\n")
    }

    lines.push(`\n🎯 Strategy: ${rec.strategy}`)
    lines.push(`Recommended samples to label: ${rec.samples.join(", ")}`)
    lines.push(`Rationale: ${rec.rationale}`)
    lines.push(`Expected gain: ${rec.expectedGain}`)

    lines.push("\n💡 Active learning workflow:")
    lines.push("  1. Label the recommended samples (or a subset)")
    lines.push("  2. Retrain the classifier with new labels")
    lines.push("  3. Re-run active learning to identify next batch")
    lines.push(`  4. Stop when accuracy stabilizes or labeling budget is exhausted`)

    lines.push("</active-learning>")
    return lines.join("\n")
  }
}
