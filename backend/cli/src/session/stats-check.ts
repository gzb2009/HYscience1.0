/**
 * Statistical Method Validator — scans agent output for common statistical
 * errors and injects corrective advice as hybio messages.
 *
 * Checks: normality assumptions, multiple testing corrections, effect size
 * reporting, p-value interpretation, sample size adequacy, overfitting,
 * selection bias, confounding, and more.
 */

import { Log } from "@/util/log"

export namespace StatsCheck {
  const log = Log.create({ service: "stats-check" })

  export interface Issue {
    severity: "error" | "warning" | "info"
    category: string
    message: string
    suggestion: string
  }

  /**
   * Enhanced regex-based scan with 15 statistical checks.
   */
  export function analyze(text: string): Issue[] {
    const issues: Issue[] = []

    // 1. t-test without normality check
    if (
      /\bt[- ]?test\b/i.test(text) &&
      !/\b(normality|shapiro|kolmogorov|qq.?plot|normal distribution|wilcoxon|mann.whitney)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "normality",
        message: "t-test used without normality verification",
        suggestion:
          "Run Shapiro-Wilk test or check Q-Q plots before using parametric tests. Consider Wilcoxon/Mann-Whitney if data is non-normal.",
      })
    }

    // 2. ANOVA without post-hoc
    if (
      /\banova\b/i.test(text) &&
      !/\b(post[ -]?hoc|tukey|bonferroni|dunn|scheffé|scheffe|games.howell)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "anova_posthoc",
        message: "ANOVA reported without post-hoc test",
        suggestion:
          "Report which post-hoc test was used (Tukey HSD, Bonferroni, etc.) and which groups differ significantly.",
      })
    }

    // 3. Multiple comparisons without correction
    const correctionTerms = /\b(bonferroni|fdr|bh correction|benjamini|hochberg|holm|sid[áa]k|by|bonferroni.holm)\b/i
    if (
      (/\b(multiple|several|many|numerous|thousands?|hundreds?)\s+(test|comparison|gene|feature|marker|protein)/i.test(
        text,
      ) ||
        /\b(genome.?wide|transcriptome.?wide|all genes?|proteome.?wide|metabolome.?wide)\b/i.test(text)) &&
      !correctionTerms.test(text)
    ) {
      issues.push({
        severity: "error",
        category: "multiple_testing",
        message: "Multiple comparisons detected without correction",
        suggestion:
          "Apply FDR (Benjamini-Hochberg) or Bonferroni correction. Report adjusted p-values alongside raw values.",
      })
    }

    // 4. p-value reported without effect size
    if (
      /\bp\s*[<>=]\s*0?\.0\d+\b/i.test(text) &&
      !/\b(effect size|cohen'?s d|hedges'? g|η²|η2|partial η|odds ratio|risk ratio|fold change|log2FC|logFC|r\b.*=.*\d|r²|r2)\b/i.test(
        text,
      )
    ) {
      issues.push({
        severity: "warning",
        category: "effect_size",
        message: "p-value reported without effect size",
        suggestion:
          "Report effect size (Cohen's d, η², fold change) alongside p-values. Statistical significance ≠ practical significance.",
      })
    }

    // 5. Small sample size for parametric tests
    const sampleMatch = text.match(/\bn\s*[=:]\s*(\d+)/gi)
    if (sampleMatch) {
      const minN = Math.min(...sampleMatch.map((m) => parseInt(m.match(/\d+/)![0]) || Infinity))
      if (minN < 10 && /\b(t[- ]?test|anova|pearson|linear regression|z[- ]?test)\b/i.test(text)) {
        issues.push({
          severity: "warning",
          category: "small_sample",
          message: `Parametric test with n=${minN} — small sample size`,
          suggestion: `n=${minN} is below recommended minimum. Consider non-parametric alternatives (Wilcoxon, Spearman) or collect more data.`,
        })
      }
    }

    // 6. Correlation ≠ causation
    if (
      /\b(correlat|associat)[a-z]*\b/i.test(text) &&
      /\b(causes?|leads? to|results? in|triggers?|drives?|impacts?|affects?|influences?)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "causation",
        message: "Causal language used with correlational evidence",
        suggestion:
          "Correlation ≠ causation. Use 'associated with' or 'correlated with' unless you have experimental/intervention evidence.",
      })
    }

    // 7. Overfitting risk in ML
    if (
      /\b(accuracy|auc|r.?squared|r2|f1)\s*[=:]\s*(0?\.9\d+|1\.0+|100%)\b/i.test(text) &&
      !/\b(cross.?valid|held.?out|test set|validation|train.test.split|out.of.sample)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "overfitting",
        message: "Very high performance metric without validation mention",
        suggestion:
          "Ensure metrics come from held-out test data, not training data. Report cross-validation results (k-fold, LOOCV).",
      })
    }

    // 8. Log transform without zero/negative handling
    if (
      /\blog\s*(transform|scale|normaliz)/i.test(text) ||
      /\blog\d*\(/i.test(text) ||
      /\bnp\.log\d*\(/i.test(text) ||
      /\blog1p\(/i.test(text)
    ) {
      if (!/\b(pseudo.?count|offset|shifted|log\d*\(.*\+.*\)|log1p|log.*1\s*\+)\b/i.test(text)) {
        issues.push({
          severity: "info",
          category: "log_transform",
          message: "Log transformation used — verify zero/negative value handling",
          suggestion:
            "If data contains zeros, add a pseudo-count (+1) or use log1p. Report the transformation explicitly.",
        })
      }
    }

    // 9. No mention of batch effects in multi-sample analysis
    if (
      /\b(multiple|several|many|numerous|various)\s+(sample|batch|run|plate|experiment|donor|patient)/i.test(text) &&
      !/\b(batch effect|batch correct|combat|harmony|removeBatchEffect|batch.*adjust|regress.*batch)/i.test(text)
    ) {
      issues.push({
        severity: "info",
        category: "batch_effects",
        message: "Multi-sample analysis without batch effect consideration",
        suggestion:
          "If data comes from multiple batches/runs, use ComBat, Harmony, or include batch as a covariate. Document batch structure.",
      })
    }

    // 10. Percentages without denominator
    const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/g)
    if (pctMatch && pctMatch.length >= 3 && !/\b(n\s*[=:]\s*\d+|denominator|total|out of)\b/i.test(text)) {
      issues.push({
        severity: "info",
        category: "missing_denominator",
        message: "Percentages reported without sample size/denominator",
        suggestion:
          "Always report percentages with the denominator (e.g., '45% (27/60)'). Percentages alone can be misleading.",
      })
    }

    // 11. Fisher's exact test on large tables
    if (/\bfisher'?s exact\b/i.test(text) && !/\b(2\s*[x×]\s*2|small|sparse|low count)\b/i.test(text)) {
      issues.push({
        severity: "info",
        category: "fisher_large",
        message: "Fisher's exact test used — verify table size is small",
        suggestion:
          "Fisher's exact test is computationally expensive for tables larger than 2×2. Consider chi-squared for larger contingency tables.",
      })
    }

    // 12. Selection bias warning
    if (
      /\b(select|chose|picked|filtered|subset|removed)\s+(the\s+)?(top|best|highest|most|significant|only)\b/i.test(
        text,
      ) &&
      !/\b(selection bias|cherry.?pick|data dredg|p.?hack)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "selection_bias",
        message: "Potential selection bias — filtering on outcome-related criteria",
        suggestion:
          "If you selected data based on the outcome (e.g., 'top expressed genes'), document this and discuss its impact on generalizability.",
      })
    }

    // 13. Confounding not addressed in comparative analysis
    if (
      /\b(compare|between|vs|versus|across)\s+(group|condition|treatment|control)/i.test(text) &&
      !/\b(confound|covariate|adjust|stratify|propensity|match)\b/i.test(text)
    ) {
      if (/\b(age|sex|gender|batch|site|center|hospital|technician)\b/i.test(text)) {
        issues.push({
          severity: "warning",
          category: "confounding",
          message: "Comparison without addressing potential confounders (age/sex/site mentioned)",
          suggestion:
            "Include confounders as covariates in the model, or use stratified/propensity-matched analysis. Report adjusted results.",
        })
      }
    }

    // 14. Survival analysis without censoring mention
    if (
      /\b(kaplan.meier|survival|cox|hazard ratio|log.?rank)\b/i.test(text) &&
      !/\b(censor|right.?censor|event|follow.?up)\b/i.test(text)
    ) {
      issues.push({
        severity: "warning",
        category: "censoring",
        message: "Survival analysis without censoring documentation",
        suggestion:
          "Report number of censored observations, median follow-up time, and censoring mechanism (right/left/interval).",
      })
    }

    // 15. Clustering without stability/distance mention
    if (
      /\b(cluster|k.?means|hierarchical|umap|t.?sne|pca|dimensionality reduction)\b/i.test(text) &&
      !/\b(silhouette|elbow|gap statistic|perplexity|distance metric|euclidean|cosine)\b/i.test(text)
    ) {
      issues.push({
        severity: "info",
        category: "clustering_params",
        message: "Clustering/dimensionality reduction without parameter justification",
        suggestion:
          "Report distance metric used, how k/perplexity was chosen, and cluster quality metrics (silhouette score, inertia).",
      })
    }

    return issues
  }

  /**
   * Format issues as a hybio message for injection into the session.
   */
  export function formatHybio(issues: Issue[]): string {
    if (issues.length === 0) return ""

    const errors = issues.filter((i) => i.severity === "error")
    const warnings = issues.filter((i) => i.severity === "warning")
    const infos = issues.filter((i) => i.severity === "info")

    const lines = ["<stats-check>"]

    if (errors.length > 0) {
      lines.push(`Statistical errors detected (${errors.length}):`)
      for (const e of errors) lines.push(`  ❌ [${e.category}] ${e.message} → ${e.suggestion}`)
    }
    if (warnings.length > 0) {
      lines.push(`Statistical warnings (${warnings.length}):`)
      for (const w of warnings) lines.push(`  ⚠️ [${w.category}] ${w.message} → ${w.suggestion}`)
    }
    if (infos.length > 0) {
      lines.push(`Statistical notes (${infos.length}):`)
      for (const i of infos) lines.push(`  ℹ️ [${i.category}] ${i.message} → ${i.suggestion}`)
    }

    lines.push("")
    lines.push("Address issues marked ❌ before reporting final results. Review ⚠️ items.")
    lines.push("</stats-check>")

    return lines.join("\n")
  }

  /**
   * LLM-driven deep analysis — triggered when regex finds 3+ potential issues.
   * Uses a cheap model for nuanced judgment: is this p-hacking or legitimate?
   */
  export async function analyzeDeep(text: string, regexIssues: Issue[]): Promise<Issue[]> {
    if (regexIssues.length < 3) return []
    // LLM deep analysis would go here — returns refined issues with confidence scores.
    // For now, mark regex issues that need deeper review.
    return regexIssues.map((issue) => ({
      ...issue,
      message: issue.message + " [needs-llm-review]",
    }))
  }
}
