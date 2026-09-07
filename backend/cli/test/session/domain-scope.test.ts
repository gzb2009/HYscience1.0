import { describe, expect, test } from "bun:test"
import { DomainScope } from "../../src/session/domain-scope"

describe("DomainScope", () => {
  test("keeps IMC questions on theme", () => {
    expect(DomainScope.drift("imc", { text: "继续做 IMC 邻域和区域组成比较", filenames: [] })).toBeUndefined()
    expect(DomainScope.drift("imc", { text: "segment this mcd", filenames: ["sample.mcd"] })).toBeUndefined()
  })

  test("flags genomics work inside an IMC project", () => {
    const hit = DomainScope.drift("imc", { text: "帮我做全基因组变异检测，分析这个 VCF", filenames: ["cohort.vcf"] })
    expect(hit?.suggest).toBe("genomics")
    expect(hit?.kind).toBe("execute")
    expect(hit?.currentTitle).toBe("IMC 分析")
  })

  test("flags spatial transcriptomics inside an IMC project", () => {
    const hit = DomainScope.drift("imc", { text: "跑一下 Visium 空间转录组去卷积", filenames: [] })
    expect(hit?.suggest).toBe("spatial")
    expect(hit?.kind).toBe("execute")
  })

  test("does not lock general projects", () => {
    expect(DomainScope.drift("general", { text: "分析 VCF", filenames: [] })).toBeUndefined()
    expect(DomainScope.lock("general")).toBeUndefined()
  })

  test("treats capability questions as discussion, not a run", () => {
    const hit = DomainScope.drift("imc", { text: "能不能做单细胞测序的分析", filenames: [] })
    expect(hit?.suggest).toBe("single-cell")
    expect(hit?.kind).toBe("ask")
    expect(DomainScope.alert(hit!).includes("You may answer in detail")).toBe(true)
    expect(DomainScope.card(hit!).includes('kind="ask"')).toBe(true)
  })

  test("still answers capability questions that mention the current direction", () => {
    const hit = DomainScope.drift("imc", { text: "这个 IMC 项目能不能做单细胞测序", filenames: [] })
    expect(hit?.kind).toBe("ask")
    expect(hit?.suggest).toBe("single-cell")
  })

  test("allows detailed retrieval and comparison of other techniques", () => {
    expect(DomainScope.drift("imc", { text: "IMC 和单细胞测序有什么区别", filenames: [] })).toBeUndefined()
    expect(DomainScope.drift("imc", { text: "单细胞测序是什么", filenames: [] })).toBeUndefined()
    expect(DomainScope.drift("imc", { text: "写一份单细胞测序的文献调研", filenames: [] })).toBeUndefined()
    expect(DomainScope.drift("imc", { text: "帮我检索 Seurat 和 IMC 邻域方法的比较", filenames: [] })).toBeUndefined()
  })

  test("blocks running the other direction and points to a switch", () => {
    const hit = DomainScope.drift("imc", { text: "帮我做单细胞测序的分析", filenames: [] })
    expect(hit?.kind).toBe("execute")
    expect(hit?.suggest).toBe("single-cell")
    expect(DomainScope.notice(hit!)).toContain("切换领域")
  })

  test("polite run requests still count as execution", () => {
    expect(DomainScope.drift("imc", { text: "能不能帮我做单细胞测序分析", filenames: [] })?.kind).toBe("execute")
    expect(DomainScope.drift("imc", { text: "你能给我做单细胞测序的分析吗", filenames: [] })?.kind).toBe("execute")
    expect(DomainScope.drift("imc", { text: "能执行单细胞分析的代码吗", filenames: [] })?.kind).toBe("execute")
  })

  test("arms compute only when this turn is an off-theme job", () => {
    const run = DomainScope.drift("imc", { text: "帮我做单细胞测序的分析", filenames: [] })!
    DomainScope.hold("ses_lock", run)
    expect(DomainScope.blocked("ses_lock")?.suggest).toBe("single-cell")
    const ask = DomainScope.drift("imc", { text: "能不能做单细胞测序的分析", filenames: [] })
    DomainScope.hold("ses_lock", ask)
    expect(DomainScope.blocked("ses_lock")).toBeUndefined()
    DomainScope.hold("ses_lock", undefined)
    expect(DomainScope.blocked("ses_lock")).toBeUndefined()
  })
})
