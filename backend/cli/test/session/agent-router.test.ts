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

  test("shouldSwitch false between primary harness agents", () => {
    expect(AgentRouter.shouldSwitch("research", { agent: "biology", reason: "bio task" })).toBe(false)
    expect(AgentRouter.shouldSwitch("research", { agent: "ml", reason: "train" })).toBe(false)
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

  test("blocks a panel request when an acronym and deliverable form are unstated", () => {
    const contract = AgentRouter.interpret({
      text: "帮我设计一个 PCF 前列腺癌 50 marker / TLS panel",
    })
    expect(contract.mustClarify).toBe(true)
    expect(contract.missingPremises).toContain("meaning of PCF")
    expect(contract.missingPremises).toContain("meaning of TLS")
    expect(contract.missingPremises).toContain("deliverable form (table / Excel / markdown / figure)")
    expect(contract.missingPremises).toContain(
      "scientific aim (general vs T-biased vs B/TLS vs myeloid vs tumor-stroma)",
    )
  })

  test("IMC lock does not define PCF on a gastric panel request", () => {
    const contract = AgentRouter.interpret({
      text: "帮我设计一个做PCF的胃癌 50 marker panel，主要关注3级淋巴结构",
    })
    expect(contract.mustClarify).toBe(true)
    expect(contract.missingPremises).toContain("meaning of PCF")
    expect(contract.missingPremises).not.toContain(AgentRouter.IMC_CONFIRM)
    expect(contract.missingPremises).toContain(
      "scientific aim (general vs T-biased vs B/TLS vs myeloid vs tumor-stroma)",
    )
  })

  test("does not re-ask a defined acronym or stated panel aim", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计偏 B 的 50 marker panel，输出 Excel",
      history: ["PCF是前列腺肿瘤免疫微环境的一套标记策略"],
    })
    expect(contract.missingPremises).not.toContain("meaning of PCF")
    expect(contract.missingPremises).toContain(AgentRouter.SPECIES_SLOT)
    expect(contract.mustClarify).toBe(true)
  })

  test("project lock does not ask to confirm IMC", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计偏 B 的 50 marker panel，输出 Excel",
      history: ["PCF是前列腺肿瘤免疫微环境的一套标记策略"],
    })
    expect(contract.missingPremises).not.toContain("meaning of PCF")
    expect(contract.missingPremises).not.toContain(AgentRouter.IMC_CONFIRM)
    expect(contract.missingPremises).toContain(AgentRouter.SPECIES_SLOT)
    expect(contract.mustClarify).toBe(true)
  })

  test("asks to confirm IMC when the acronym is used without a definition", () => {
    const contract = AgentRouter.interpret({
      text: "帮我设计一个 IMC 胃癌 50 marker panel，输出 Excel",
    })
    expect(contract.missingPremises).toContain(AgentRouter.IMC_CONFIRM)
  })

  test("PhenoCycler confirmation is oligo chemistry, not IMC metals", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计偏 B 的 50 marker panel，输出 Excel",
      history: ["PCF是PhenoCycler-Fusion，Akoya 前身 CODEX"],
    })
    expect(
      AgentRouter.assayOntology("按这个 PCF 设计偏 B 的 50 marker panel，输出 Excel", "PCF是PhenoCycler-Fusion"),
    ).toBe("phenocycler")
    expect(contract.knownContext).toContain("phenocycler chemistry")
    expect(contract.missingPremises).not.toContain(AgentRouter.IMC_CONFIRM)
  })

  test("does not re-ask IMC after the user confirmed 成像质谱", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计偏 B 的 50 marker panel，输出 Excel",
      history: ["PCF是前列腺肿瘤免疫微环境的一套标记策略", "是的，IMC是成像质谱"],
    })
    expect(contract.missingPremises).not.toContain(AgentRouter.IMC_CONFIRM)
    expect(contract.missingPremises).toContain(AgentRouter.SPECIES_SLOT)
    expect(contract.mustClarify).toBe(true)
  })

  test("blocks a panel request when scientific aim is unstated", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计 50 marker panel，输出 Excel",
      history: ["PCF是前列腺肿瘤免疫微环境的一套标记策略"],
    })
    expect(contract.missingPremises).toContain(
      "scientific aim (general vs T-biased vs B/TLS vs myeloid vs tumor-stroma)",
    )
    expect(contract.mustClarify).toBe(true)
  })

  test("blocks execution only when its required data premise is absent", () => {
    const contract = AgentRouter.interpret({
      text: "Please analyze this dataset and run the differential expression analysis.",
    })
    expect(contract.intent).toBe("data_analysis")
    expect(contract.mustClarify).toBe(true)
    expect(contract.missingPremises).toContain("data location, variables, or analysis target")
  })

  test("treats 生成一个 word as export of the prior panel, not a short answer", () => {
    const contract = AgentRouter.interpret({
      text: "生成一个word",
      history: ["帮我设计一个做PCF的胃癌 50 marker panel", "PCF是PhenoCycler-Fusion"],
    })
    expect(contract.intent).toBe("execution")
    expect(contract.mustClarify).toBe(false)
    expect(contract.knownContext).toContain("agreed deliverable export")
    expect(contract.knownContext).toContain("phenocycler chemistry")
    expect(contract.missingPremises).not.toContain(AgentRouter.IMC_CONFIRM)
  })

  test("asks for a platform when a panel names none", () => {
    const contract = AgentRouter.interpret({ text: "帮我设计一个 50 marker panel，输出 Excel" })
    expect(contract.missingPremises).toContain(AgentRouter.PLATFORM_SLOT)
    expect(contract.mustClarify).toBe(true)
  })

  test("does not re-ask platform when a named assay is already present", () => {
    const contract = AgentRouter.interpret({ text: "帮我设计一个 CyTOF 肺癌 40 marker panel，输出 Excel" })
    expect(contract.missingPremises).not.toContain(AgentRouter.PLATFORM_SLOT)
    expect(contract.missingPremises).toContain(
      "scientific aim (general vs T-biased vs B/TLS vs myeloid vs tumor-stroma)",
    )
    expect(contract.missingPremises).toContain(AgentRouter.SPECIES_SLOT)
  })

  test("asks remaining species and tissue after platform and aim are closed", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 panel 设计偏 B 的 50 marker，输出 Excel",
      history: ["平台是 PhenoCycler-Fusion", "侧重点偏 B / TLS"],
    })
    expect(contract.missingPremises).toContain(AgentRouter.SPECIES_SLOT)
    expect(contract.missingPremises).toContain(AgentRouter.TISSUE_SLOT)
    expect(contract.mustClarify).toBe(true)
  })

  test("does not re-ask closed species and tissue on a fully specified panel", () => {
    const contract = AgentRouter.interpret({
      text: "帮我设计一个 CyTOF 人胃癌 偏T 40 marker panel，输出 Excel",
    })
    expect(contract.missingPremises).not.toContain(AgentRouter.SPECIES_SLOT)
    expect(contract.missingPremises).not.toContain(AgentRouter.TISSUE_SLOT)
    expect(contract.missingPremises).not.toContain(AgentRouter.PLATFORM_SLOT)
    expect(contract.mustClarify).toBe(false)
  })

  test("closes a fingerprinting ontology without treating it as imaging", () => {
    const contract = AgentRouter.interpret({
      text: "按这个 PCF 设计人胃癌偏 T 的 panel，输出 Excel",
      history: ["PCF是Protein Correlation Fingerprinting"],
    })
    expect(contract.knownContext).toContain("fingerprinting chemistry")
    expect(contract.knownContext).not.toContain("phenocycler chemistry")
    expect(contract.knownContext).not.toContain("imc metal chemistry")
    expect(contract.mustClarify).toBe(false)
  })

  test("does not close an ontology on a comparison request", () => {
    const contract = AgentRouter.interpret({ text: "IMC 和 PhenoCycler 有什么区别" })
    expect(contract.knownContext).not.toContain("phenocycler chemistry")
    expect(contract.knownContext).not.toContain("imc metal chemistry")
    expect(contract.mustClarify).toBe(false)
  })

  test("a spatial-transcriptomics methods question is not a design clarify", () => {
    const contract = AgentRouter.interpret({
      text: "FFPE 组织做空间转录组的标准流程是什么？Visium / Xenium / CosMx 怎么选？",
    })
    expect(contract.intent).toBe("direct_answer")
    expect(contract.mustClarify).toBe(false)
    expect(contract.missingPremises).not.toContain(AgentRouter.SPECIES_SLOT)
  })

  test("a bare 生成一个word without prior design is not an export", () => {
    const contract = AgentRouter.interpret({ text: "生成一个word" })
    expect(contract.knownContext).not.toContain("agreed deliverable export")
    expect(contract.intent).toBe("direct_answer")
  })

  test("plans only for explicit parallel or dependent deliverables", () => {
    expect(AgentRouter.interpret({ text: "Explain the pros and cons of two models." }).coordinate).toBe(false)
    expect(
      AgentRouter.interpret({ text: "Run these dependent tasks in parallel and provide separate deliverables." })
        .coordinate,
    ).toBe(true)
  })
})
