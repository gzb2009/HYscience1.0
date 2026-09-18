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

  test("strips a passed self-check line", () => {
    const text = [
      "现在只差把你手上的矩阵（路径 + 格式 + 物种）发我，就能实际开始并出注释结果。",
      "",
      "[SELF-CHECK PASSED] — 已用一句直接确认回答，未重复冗长清单，未虚构任何执行结果。",
    ].join("\n")
    expect(OutputClean.clean(text)).toBe("现在只差把你手上的矩阵（路径 + 格式 + 物种）发我，就能实际开始并出注释结果。")
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

  test("shortens a conversion ack that names tools or structure", () => {
    const text = "好的，把同一套 50-marker 设计转成 Word 文档（docx），结构与 Excel 一致，直接用 office 工具生成。"
    expect(OutputClean.clean(text)).toBe("好的，正在把 Excel 转成 Word。")
  })

  test("strips a standalone rate-limit status line", () => {
    const text = ["文献核验中，刚触发了一次限流。我放慢节奏逐个确认关键支撑文献。", "", "CD8A 在该群稳定高表达。"].join(
      "\n",
    )
    expect(OutputClean.clean(text)).toBe("CD8A 在该群稳定高表达。")
  })

  test("rewrites antibody-catalog marker nicknames to official symbols", () => {
    const text = "胞内靶标如 FoxP3、Ki-67、GrzB、Grmb 在 PCF 上依赖透化。"
    expect(OutputClean.clean(text)).toBe("胞内靶标如 FOXP3、Ki-67、GZMB、GZMB 在 PCF 上依赖透化。")
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
