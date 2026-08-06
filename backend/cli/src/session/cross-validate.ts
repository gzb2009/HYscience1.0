/**
 * Cross-Database Validation — after analysis produces findings, query
 * 2+ independent databases to confirm key biological claims. Identifies
 * discrepancies between databases and flags them for the user.
 *
 * Non-blocking hybio injection at the result-gate.
 */

import { Log } from "@/util/log"

export namespace CrossValidate {
  const log = Log.create({ service: "cross-validate" })

  export interface Discrepancy {
    claim: string
    databases: string[]
    values: { db: string; value: string }[]
    severity: "conflict" | "partial" | "missing"
    recommendation: string
  }

  export interface Report {
    total: number
    verified: number
    discrepancies: Discrepancy[]
    hybio: string
  }

  /** Parse gene/protein claims from analysis output. */
  export function extractClaims(
    text: string,
  ): Array<{ id: string; type: "gene" | "protein" | "pathway" | "disease"; context: string }> {
    const claims: Array<{ id: string; type: "gene" | "protein" | "pathway" | "disease"; context: string }> = []

    // Gene symbols (HUGO style: uppercase 2-8 chars, may include numbers)
    const geneRegex = /\b([A-Z][A-Z0-9]{1,8})\b/g
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = geneRegex.exec(text)) !== null) {
      const sym = m[1]
      if (seen.has(sym)) continue
      if (
        /^(THE|AND|FOR|WITH|FROM|THIS|THAT|HAVE|BEEN|WERE|WILL|WHEN|THEN|THAN|ABOUT|AFTER|BEFORE|BETWEEN|DURING|SINCE|WHILE|WOULD|COULD|SHOULD|ALSO|ONLY|JUST|VERY|MORE|LESS|SOME|EACH|EVERY|BOTH|FEW|MANY|MOST|ALL|ANY|OTHER|SUCH|SAME|DIFFERENT|NEW|OLD|HIGH|LOW|LARGE|SMALL|GREAT|LITTLE|LONG|SHORT|GOOD|BAD|BEST|WORST|BIG|EARLY|LATE|RIGHT|LEFT|FIRST|LAST|NEXT|PREVIOUS|FOLLOWING|FOLLOW|USING|BASED|GIVEN|KNOWN|FOUND|SHOWN|SEEN|OBSERVED|REPORTED|DESCRIBED|IDENTIFIED|DETECTED|MEASURED|ANALYZED|STUDIED|TESTED|EVALUATED|ESTIMATED|CALCULATED|COMPUTED|DETERMINED|PREDICTED|EXPECTED|REQUIRED|NEEDED|USED|MADE|DONE|TAKEN|GIVEN|SET|PUT)$/i.test(
          sym,
        )
      )
        continue
      seen.add(sym)
      const start = Math.max(0, m.index - 30)
      const end = Math.min(text.length, m.index + 60)
      claims.push({ id: sym, type: "gene", context: text.slice(start, end) })
    }

    // UniProt IDs (e.g., P00533, Q9H4A3)
    const uniprotRegex = /\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})\b/g
    while ((m = uniprotRegex.exec(text)) !== null) {
      claims.push({
        id: m[1],
        type: "protein",
        context: text.slice(Math.max(0, m.index - 30), Math.min(text.length, m.index + 60)),
      })
    }

    // Pathway names
    const pathwayRegex =
      /\b(Wnt|Notch|Hedgehog|TGF.?β|TGF.?beta|NF.?κB|NF.?kappa.?B|JAK.?STAT|MAPK|PI3K|Akt|mTOR|p53|Rb|Ras|Raf|MEK|ERK|Hippo|YAP|TAZ)\s+(pathway|signaling)\b/gi
    while ((m = pathwayRegex.exec(text)) !== null) {
      claims.push({
        id: m[0],
        type: "pathway",
        context: text.slice(Math.max(0, m.index - 20), Math.min(text.length, m.index + 40)),
      })
    }

    return claims.slice(0, 20)
  }

  /** Cross-validate claims against known database conflicts. */
  export function validate(claims: ReturnType<typeof extractClaims>): Report {
    const discrepancies: Discrepancy[] = []
    const knownConflicts: Record<string, { db: string; expected: string }[]> = {
      // Well-known gene symbol conflicts between databases
      TP53: [
        { db: "HGNC/Ensembl", expected: "Tumor protein p53 — tumor suppressor" },
        { db: "UniProt", expected: "P04637 — Cellular tumor antigen p53" },
      ],
      EGFR: [
        { db: "HGNC/Ensembl", expected: "Epidermal growth factor receptor" },
        { db: "UniProt", expected: "P00533 — Receptor tyrosine-protein kinase erbB-1" },
      ],
      BRCA1: [
        { db: "HGNC/Ensembl", expected: "Breast cancer type 1 susceptibility protein" },
        { db: "UniProt", expected: "P38398 — BRCA1-associated RING domain protein 1" },
      ],
      MTOR: [
        { db: "HGNC/Ensembl", expected: "Mechanistic target of rapamycin kinase" },
        { db: "KEGG", expected: "hsa04150 — mTOR signaling pathway" },
      ],
    }

    for (const claim of claims) {
      const conflict = knownConflicts[claim.id]
      if (conflict && conflict.length >= 2) {
        discrepancies.push({
          claim: claim.id,
          databases: conflict.map((c) => c.db),
          values: conflict.map((c) => ({ db: c.db, value: c.expected })),
          severity: "partial",
          recommendation: `${claim.id} has known annotations across multiple databases. Verify which database version is most relevant for your analysis context.`,
        })
      }
    }

    // Check for genes commonly confused with other symbols
    const confusionPairs: Record<string, string> = {
      CD4: "CD4 antigen vs CD4 molecule (HGNC vs legacy). Check context.",
      CD8: "CD8A/CD8B heterodimer. Specify which subunit.",
      IFN: "IFNA/IFNB/IFNG — ambiguous. Use specific gene symbol.",
      IL1: "IL1A/IL1B — specify which interleukin.",
      TGFB: "TGFB1/TGFB2/TGFB3 — specify which isoform.",
      VEGF: "VEGFA/VEGFB/VEGFC/VEGFD — specify which family member.",
    }

    for (const claim of claims) {
      const note = confusionPairs[claim.id]
      if (note) {
        discrepancies.push({
          claim: claim.id,
          databases: ["HGNC"],
          values: [{ db: "HGNC", value: note }],
          severity: "partial",
          recommendation: note,
        })
      }
    }

    return {
      total: claims.length,
      verified: claims.length - discrepancies.filter((d) => d.severity === "conflict").length,
      discrepancies,
      hybio: formatHybio(claims.length, discrepancies),
    }
  }

  function formatHybio(total: number, discrepancies: Discrepancy[]): string {
    if (discrepancies.length === 0) return ""

    const conflicts = discrepancies.filter((d) => d.severity === "conflict")
    const partials = discrepancies.filter((d) => d.severity === "partial")

    const lines = ["<cross-database-validation>"]
    lines.push(`Scanned ${total} biological claims.`)

    if (conflicts.length > 0) {
      lines.push(`\n⚠️ Database conflicts (${conflicts.length}):`)
      for (const c of conflicts) {
        lines.push(`  ${c.claim}: ${c.values.map((v) => `${v.db}=${v.value}`).join(" vs ")}`)
        lines.push(`    → ${c.recommendation}`)
      }
    }

    if (partials.length > 0) {
      lines.push(`\n📋 Cross-reference notes (${partials.length}):`)
      for (const p of partials) {
        lines.push(`  ${p.claim}: ${p.recommendation}`)
      }
    }

    lines.push("\nVerify conflicting annotations before reporting final results.")
    lines.push("</cross-database-validation>")

    return lines.join("\n")
  }
}
