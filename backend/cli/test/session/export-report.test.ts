import { describe, expect, test } from "bun:test"
import { ExportReport } from "../../src/session/export-report"

describe("ExportReport.worthSaving", () => {
  test("skips empty question-only sessions", () => {
    expect(
      ExportReport.worthSaving({
        assistantText: "",
        conclusion: "",
        findings: 0,
        artifacts: 0,
      }),
    ).toBe(false)
  })

  test("skips short refusals without deliverables", () => {
    expect(
      ExportReport.worthSaving({
        assistantText: "当前方向不能执行单细胞分析。",
        conclusion: "",
        findings: 0,
        artifacts: 0,
      }),
    ).toBe(false)
  })

  test("keeps a real concluding answer", () => {
    expect(
      ExportReport.worthSaving({
        assistantText: "",
        conclusion: "邻域富集在肿瘤区显著高于间质，建议下一步做配体受体。",
        findings: 0,
        artifacts: 0,
      }),
    ).toBe(true)
  })

  test("keeps sessions that produced artifacts", () => {
    expect(
      ExportReport.worthSaving({
        assistantText: "",
        conclusion: "",
        findings: 0,
        artifacts: 2,
      }),
    ).toBe(true)
  })
})

describe("ExportReport filters", () => {
  test("strips ui-locale tags", () => {
    expect(ExportReport.stripLocale('帮我做单细胞测序的分析\n<ui-locale code="zh" />')).toBe("帮我做单细胞测序的分析")
  })

  test("drops punctuation-only findings", () => {
    expect(ExportReport.isJunkClaim("。")).toBe(true)
    expect(ExportReport.isJunkClaim("邻域富集在肿瘤区显著高于间质")).toBe(false)
  })

  test("drops truncated artifact names", () => {
    expect(ExportReport.isJunkArtifact("mtx`")).toBe(true)
    expect(ExportReport.isJunkArtifact("result/umap.png")).toBe(false)
  })
})
