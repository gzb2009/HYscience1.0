import { describe, expect, test } from "bun:test"
import { OutputClean } from "../../src/session/output-clean"

describe("OutputClean reviewer removal", () => {
  test("truncates reviewer overlay and preserves the original answer", () => {
    const text = [
      "Key finding: 1,248 DEGs found.",
      "",
      "Reviewer (@reviewer) — blind review of the answer above:",
      "",
      "FLAGGED: The p-value cannot be traced.",
    ].join("\n")
    const result = OutputClean.clean(text)
    expect(result).toContain("Key finding: 1,248 DEGs found.")
    expect(result).not.toContain("Reviewer")
    expect(result).not.toContain("FLAGGED")
  })

  test("keeps normal answers unchanged", () => {
    const text = "Main result: cluster 3 is CD8+ T cells."
    expect(OutputClean.clean(text)).toBe(text)
  })

  test("removes standalone internal orchestration narration", () => {
    const text = [
      "我先并行补一轮文献检索并启动子智能体。",
      "CD8A 和 NKG7 支持该群为细胞毒性淋巴细胞，仍需结合 TRAC 和 FCGR3A 排除混合群。",
      "文献 agent 中途中断。",
      "准备重跑内部任务。",
    ].join("\n")
    const result = OutputClean.clean(text)
    expect(result).toBe("CD8A 和 NKG7 支持该群为细胞毒性淋巴细胞，仍需结合 TRAC 和 FCGR3A 排除混合群。")
  })

  test("preserves scientific terms and user-facing failure explanations", () => {
    const text = [
      "该 agent-based model 的参数尚未收敛。",
      "本次分析未完成，因为输入矩阵缺少样本分组列；补充该列后可按相同的差异表达流程复现。",
      "建议重新运行实验以验证批次效应。",
    ].join("\n")
    expect(OutputClean.clean(text)).toBe(text)
  })
})
