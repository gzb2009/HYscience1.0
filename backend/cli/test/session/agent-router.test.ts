import { describe, test, expect } from "bun:test"
import { AgentRouter } from "../../src/session/agent-router"

const cases = [
  // [text, files, expected_agent, expected_tier]
  ["帮我做一下单细胞RNA-seq数据的降维和聚类分析", ["data.h5ad"], "biology", "fast"],
  ["查一下TP53基因在肺癌中的突变频率", [], "research", "fast"],
  ["Compare drug A vs drug B using t-test on clinical trial data", ["trial.csv"], "research", "ultra"],
  ["Build a random forest classifier to predict patient outcomes", ["features.parquet"], "research", "pro"],
  ["Write a manuscript summarizing our findings on CRISPR screen results", ["results.csv"], "research", "pro"],
  ["Fix the error: TypeError: Cannot read property 'X' of undefined", ["analysis.py"], "research", "fast"],
  ["Find papers about CAR-T therapy for solid tumors published after 2023", [], "research", "pro"],
  ["explore and cluster this single-cell dataset", ["cells.h5ad"], "biology", "fast"],
] as const

describe("AgentRouter v2 regex fallback", () => {
  for (const [text, files, expectedAgent, expectedTier] of cases) {
    test(`routes "${text.slice(0, 40)}..."`, () => {
      const rec = AgentRouter.recommend({
        current: "research",
        text: text as string,
        filenames: [...files],
      })
      expect(rec.agent).toBe(expectedAgent)
      expect(rec.tier).toBe(expectedTier)
    })
  }

  test("detect returns valid intent for any input", () => {
    const result = AgentRouter.detect("hello world")
    expect([
      "general",
      "literature_review",
      "exploratory_analysis",
      "hypothesis_testing",
      "method_development",
      "result_synthesis",
      "code_debugging",
    ]).toContain(result)
  })

  test("shouldSwitch false when same agent", () => {
    expect(AgentRouter.shouldSwitch("research", { agent: "research", reason: "no change" })).toBe(false)
  })

  test("shouldSwitch true when different agent", () => {
    expect(AgentRouter.shouldSwitch("research", { agent: "biology", reason: "bio task" })).toBe(true)
  })

  test("shouldSwitch false for plan agent", () => {
    expect(AgentRouter.shouldSwitch("plan", { agent: "research", reason: "switch" })).toBe(false)
  })

  test("advice generates valid hybio string", () => {
    const result = AgentRouter.advice({ agent: "biology", reason: "test", tier: "pro" })
    expect(result).toContain("<agent-router")
    expect(result).toContain("biology")
    expect(result).toContain("pro")
  })

  test("classify returns classification with all fields", async () => {
    // regex path (no LLM available in test)
    const classification = await AgentRouter.classify({
      text: "help me analyze single-cell RNA-seq data with clustering",
      filenames: ["data.h5ad"],
    })
    expect(classification).toHaveProperty("intent")
    expect(classification).toHaveProperty("agent")
    expect(classification).toHaveProperty("tier")
    expect(classification).toHaveProperty("shouldSearch")
    expect(classification).toHaveProperty("tools")
    expect(classification).toHaveProperty("reason")
    expect(classification).toHaveProperty("confidence")
  })

  test("preserves a correction over earlier research context", () => {
    const contract = AgentRouter.interpret({
      text: "纠正：不是小鼠，而是人源样本；比较两组的结果。",
      history: ["小鼠队列的对照组和处理组"],
    })
    expect(contract.intent).toBe("correction")
    expect(contract.knownContext).toContain("comparison")
    expect(contract.gates).toContain("inference")
  })

  test("does not require files for a general methods question", () => {
    const contract = AgentRouter.interpret({
      text: "How should I choose a normalization method for bulk RNA-seq?",
    })
    expect(contract.mustClarify).toBe(false)
    expect(contract.gates).not.toContain("data")
  })

  test("blocks execution only when its required data premise is absent", () => {
    const contract = AgentRouter.interpret({
      text: "Please analyze this dataset and run the differential expression analysis.",
    })
    expect(contract.intent).toBe("data_analysis")
    expect(contract.mustClarify).toBe(true)
    expect(contract.missingPremises).toContain("data location, variables, or analysis target")
  })

  test("plans only for explicit parallel or dependent deliverables", () => {
    expect(AgentRouter.interpret({ text: "Explain the pros and cons of two models." }).coordinate).toBe(false)
    expect(
      AgentRouter.interpret({ text: "Run these dependent tasks in parallel and provide separate deliverables." })
        .coordinate,
    ).toBe(true)
  })
})
