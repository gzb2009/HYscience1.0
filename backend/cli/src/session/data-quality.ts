/**
 * Data Quality Validator — scans agent output for data quality issues
 * and injects warnings into the session.
 */

import { Log } from "@/util/log"

export namespace DataQuality {
  const log = Log.create({ service: "data-quality" })

  export interface Issue {
    severity: "error" | "warning"
    category: string
    message: string
    suggestion: string
  }

  export function analyze(text: string): Issue[] {
    const issues: Issue[] = []

    // Missing values without handling
    if (
      (/\b(NA|NaN|null|missing)\b/i.test(text) || /\b\d+\s*(?:missing|NA|NaN|null|空值)\b/i.test(text)) &&
      !/\b(imput|dropna|fillna|complete.?case|remove.*missing|missing.*remov)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "missing_data",
        message: "Missing values detected without handling strategy",
        suggestion:
          "Report how missing values were handled: imputation method, removal criteria, or explicit exclusion.",
      })
    }

    // Outliers without mention of treatment
    if (
      /\b(outlier|离群值|anomal|extreme value)\b/i.test(text) &&
      !/\b(winsoriz|clip|trim|remove.*outlier|filter.*outlier|robust)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "outliers",
        message: "Outliers mentioned without treatment strategy",
        suggestion:
          "Specify how outliers were handled: Winsorization, clipping, removal with threshold, or robust methods used.",
      })
    }

    // Batch effect not addressed in multi-sample analysis
    if (
      /\b(sample|condition|treatment|control|patient|donor)s?\s+\d+/i.test(text) &&
      /\b(batch|plate|lane|run|date|site)\b/i.test(text) &&
      !/\b(batch correct|batch effect|combat|harmony|scanorama|regress.*batch)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "batch_effect",
        message: "Multiple samples with potential batch effects — no correction mentioned",
        suggestion: "Consider batch effect correction (ComBat, Harmony, Scanorama) or include batch as a covariate.",
      })
    }

    // Zero-count genes in scRNA-seq without filtering
    if (
      /\b(single.?cell|scrna|scATAC)\b/i.test(text) &&
      /\b(\d+)\s*(genes?|features?)\b/i.test(text) &&
      !/\b(filter.*gene|min.*cells|expressed.*in|detected.*in)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "low_expression",
        message: "scRNA-seq analysis: verify gene filtering by minimum cells expressed",
        suggestion:
          "Filter genes expressed in fewer than 3 cells. Report the number of genes before and after filtering.",
      })
    }

    return issues
  }

  export function formatHybio(issues: Issue[]): string {
    if (issues.length === 0) return ""
    const lines = ["<data-quality>", "Data quality checks:"]
    for (const i of issues) {
      const icon = i.severity === "error" ? "❌" : "⚠️"
      lines.push(`  ${icon} ${i.message}`)
      lines.push(`    → ${i.suggestion}`)
    }
    lines.push("</data-quality>")
    return lines.join("\n")
  }
}
