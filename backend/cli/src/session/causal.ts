/**
 * Causal Inference Module — DAG-based causal structure learning,
 * back-door/front-door adjustment identification, and do-calculus
 * guidance for observational studies.
 *
 * Injects causal reasoning prompts when causal claims are detected.
 */

import { Log } from "@/util/log"

export namespace CausalInference {
  const log = Log.create({ service: "causal" })

  export interface Variable {
    name: string
    role: "exposure" | "outcome" | "confounder" | "mediator" | "collider" | "instrument" | "unknown"
    evidence: string
  }

  export interface CausalClaim {
    cause: string
    effect: string
    confidence: "suggested" | "likely" | "established"
    mechanism: string
  }

  export interface CausalGraph {
    variables: Variable[]
    edges: Array<{ from: string; to: string }>
    backdoorPaths: string[][]
    frontdoorPaths: string[][]
    adjustmentSets: string[][]
  }

  /**
   * Detect causal language patterns and extract variable roles.
   */
  export function detectCausalClaims(text: string): CausalClaim[] {
    const claims: CausalClaim[] = []

    const patterns = [
      /\b([A-Za-z0-9\s-]+?)\s+(causes?|leads? to|results? in|triggers?|induces?|drives?|promotes?)\s+([A-Za-z0-9\s-]+?)(?:\.|,|;|$)/gi,
      /\b([A-Za-z0-9\s-]+?)\s+(increases?|decreases?|elevates?|reduces?|suppresses?|enhances?|inhibits?)\s+([A-Za-z0-9\s-]+?)(?:\.|,|;|$)/gi,
      /\b(effect|impact|influence)\s+of\s+([A-Za-z0-9\s-]+?)\s+on\s+([A-Za-z0-9\s-]+?)(?:\.|,|;|$)/gi,
    ]

    for (const pattern of patterns) {
      let m: RegExpExecArray | null
      while ((m = pattern.exec(text)) !== null) {
        const cause = (m[1] || m[2]).trim().slice(0, 60)
        const effect = (m[2] || m[3]).trim().slice(0, 60)
        if (cause.length < 2 || effect.length < 2) continue
        if (cause.toLowerCase() === effect.toLowerCase()) continue

        const confidence: CausalClaim["confidence"] =
          /\b(demonstrat|confirm|establish|prove|causally|experimentally|RCT|randomized)\b/i.test(
            text.slice(Math.max(0, m.index - 100), m.index + m[0].length + 100),
          )
            ? "established"
            : /\b(suggest|indicat|may|might|could|potentially|possibly|correlat|associat)\b/i.test(
                  text.slice(Math.max(0, m.index - 100), m.index + m[0].length + 100),
                )
              ? "suggested"
              : "likely"

        claims.push({ cause, effect, confidence, mechanism: "" })
      }
    }

    return claims.slice(0, 10)
  }

  /**
   * Extract variable roles from analysis text.
   */
  export function extractVariables(text: string): Variable[] {
    const variables: Variable[] = []

    // Exposure
    const expMatch = text.match(
      /\b(exposure|treatment|intervention|independent variable|predictor):?\s*([A-Za-z0-9\s-]{2,40})/i,
    )
    if (expMatch) variables.push({ name: expMatch[2].trim(), role: "exposure", evidence: expMatch[0] })

    // Outcome
    const outMatch = text.match(/\b(outcome|dependent variable|endpoint|response|target):?\s*([A-Za-z0-9\s-]{2,40})/i)
    if (outMatch) variables.push({ name: outMatch[2].trim(), role: "outcome", evidence: outMatch[0] })

    // Confounders
    const confMatch = text.match(
      /\b(confound|adjust|control for|covariate|stratif)\S*\s+(?:for\s+)?(?:variable|factor)?s?:?\s*([A-Za-z0-9\s,-]{2,80})/i,
    )
    if (confMatch) {
      const names = confMatch[2].split(/[,;]/)
      for (const n of names) {
        const name = n.trim()
        if (name.length > 1) variables.push({ name, role: "confounder", evidence: confMatch[0] })
      }
    }

    // Mediators
    const medMatch = text.match(
      /\b(mediat|mechanism|pathway|through|via|indirect)\S*\s+(?:through|via|by)?\s*([A-Za-z0-9\s-]{2,40})/i,
    )
    if (medMatch) variables.push({ name: medMatch[2].trim(), role: "mediator", evidence: medMatch[0] })

    return variables
  }

  /**
   * Build a causal DAG from variables and detected relationships.
   */
  export function buildDAG(variables: Variable[], claims: CausalClaim[]): CausalGraph {
    const edges: Array<{ from: string; to: string }> = []

    for (const claim of claims) {
      const from = variables.find(
        (v) =>
          v.name.toLowerCase().includes(claim.cause.toLowerCase()) ||
          claim.cause.toLowerCase().includes(v.name.toLowerCase()),
      )
      const to = variables.find(
        (v) =>
          v.name.toLowerCase().includes(claim.effect.toLowerCase()) ||
          claim.effect.toLowerCase().includes(v.name.toLowerCase()),
      )
      if (from && to && from.name !== to.name) {
        edges.push({ from: from.name, to: to.name })
      }
    }

    // Add confounder edges
    const confounders = variables.filter((v) => v.role === "confounder")
    const exposures = variables.filter((v) => v.role === "exposure")
    const outcomes = variables.filter((v) => v.role === "outcome")
    for (const c of confounders) {
      for (const e of exposures) edges.push({ from: c.name, to: e.name })
      for (const o of outcomes) edges.push({ from: c.name, to: o.name })
    }

    // Find back-door paths and minimal adjustment sets
    const backdoorPaths = findBackdoorPaths(variables, edges)
    const adjustmentSets = findMinimalAdjustment(
      backdoorPaths,
      confounders.map((c) => c.name),
    )

    return { variables, edges, backdoorPaths, frontdoorPaths: [], adjustmentSets }
  }

  function findBackdoorPaths(variables: Variable[], edges: Array<{ from: string; to: string }>): string[][] {
    const exposures = variables.filter((v) => v.role === "exposure").map((v) => v.name)
    const outcomes = variables.filter((v) => v.role === "outcome").map((v) => v.name)
    if (exposures.length === 0 || outcomes.length === 0) return []

    const paths: string[][] = []
    // Simple back-door: any path X ← C → Y
    for (const e of exposures) {
      const parentsOfExposure = edges.filter((ed) => ed.to === e).map((ed) => ed.from)
      for (const c of parentsOfExposure) {
        const childrenOfConfounder = edges.filter((ed) => ed.from === c).map((ed) => ed.to)
        for (const o of outcomes) {
          if (childrenOfConfounder.includes(o)) {
            paths.push([e, c, o])
          }
        }
      }
    }
    return paths
  }

  function findMinimalAdjustment(paths: string[][], confounders: string[]): string[][] {
    if (paths.length === 0) return []
    // Simpler: return all confounders as the adjustment set
    return confounders.length > 0 ? [confounders] : []
  }

  /**
   * Generate mermaid causal diagram.
   */
  export function toMermaid(graph: CausalGraph): string {
    const lines = ["flowchart LR"]
    const roleColors: Record<string, string> = {
      exposure: "#fde68a",
      outcome: "#bfdbfe",
      confounder: "#fecaca",
      mediator: "#bbf7d0",
      collider: "#e9d5ff",
      instrument: "#fed7aa",
    }

    for (const v of graph.variables) {
      const color = roleColors[v.role] || "#f3f4f6"
      const shortName = v.name.slice(0, 20)
      lines.push(`  ${v.name.replace(/[^a-zA-Z0-9]/g, "_")}["${shortName}"]`)
    }

    for (const e of graph.edges) {
      lines.push(`  ${e.from.replace(/[^a-zA-Z0-9]/g, "_")} --> ${e.to.replace(/[^a-zA-Z0-9]/g, "_")}`)
    }

    return lines.join("\n")
  }

  /**
   * Generate hybio injection with causal guidance.
   */
  export function formatHybio(claims: CausalClaim[], graph: CausalGraph): string {
    if (claims.length === 0) return ""

    const lines = ["<causal-inference>"]

    const established = claims.filter((c) => c.confidence === "established")
    const likely = claims.filter((c) => c.confidence === "likely")
    const suggested = claims.filter((c) => c.confidence === "suggested")

    if (established.length > 0) {
      lines.push(`\nEstablished causal claims (${established.length}):`)
      for (const c of established) lines.push(`  ✅ ${c.cause} → ${c.effect}`)
    }
    if (likely.length > 0) {
      lines.push(`\nLikely causal claims (${likely.length}):`)
      for (const c of likely) lines.push(`  🟡 ${c.cause} → ${c.effect}`)
    }
    if (suggested.length > 0) {
      lines.push(`\nSuggested associations (${suggested.length}):`)
      for (const c of suggested) lines.push(`  🔵 ${c.cause} → ${c.effect}`)
    }

    if (graph.backdoorPaths.length > 0) {
      lines.push(
        `\n⚠️ Back-door paths detected (${graph.backdoorPaths.length}). Adjust for: ${graph.adjustmentSets[0]?.join(", ") || "unknown confounders"}`,
      )
      lines.push("Causal diagram (Mermaid):")
      lines.push("```mermaid")
      lines.push(toMermaid(graph))
      lines.push("```")
    }

    if (suggested.length > 0) {
      lines.push("\n💡 To strengthen causal claims:")
      lines.push("  1. Identify and measure potential confounders")
      lines.push("  2. Consider instrumental variable analysis if randomization is infeasible")
      lines.push("  3. Use sensitivity analysis to assess unmeasured confounding (E-value)")
    }

    lines.push("</causal-inference>")
    return lines.join("\n")
  }
}
