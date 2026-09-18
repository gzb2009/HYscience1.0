import { describe, expect, test } from "bun:test"
import { BiologyLexicon, FILES, FOREIGN, PLATFORM_ANY, SPECIES, TISSUE } from "../../src/session/biology-lexicon"
import { BiologyProfile } from "../../src/session/biology-profile"
import { DomainScope } from "../../src/session/domain-scope"
import { AgentRouter } from "../../src/session/agent-router"
import { OutputClean } from "../../src/session/output-clean"

describe("BiologyLexicon", () => {
  test("platform vocabulary is shared by clarification slots", () => {
    expect(PLATFORM_ANY.test("这次用 Xenium 平台")).toBe(true)
    expect(PLATFORM_ANY.test("用光谱流式看一下")).toBe(true)
    expect(AgentRouter.missingPlatform("帮我设计一个 panel", "平台是 CyTOF")).toBe(false)
  })

  test("species and tissue tables drive the design slots", () => {
    expect(SPECIES.test("食蟹猴样本")).toBe(true)
    expect(TISSUE.test("卵巢癌组织")).toBe(true)
    expect(AgentRouter.missingTissue("设计一个 marker 清单", "结直肠癌")).toBe(false)
  })

  test("file tables are shared by profile detection and drift", () => {
    expect(FILES.imc.test("run1.mcd")).toBe(true)
    expect(BiologyProfile.detect({ filenames: ["sample.mcd"] })).toBe("imc")
    expect(DomainScope.drift("single-cell", { text: "跑一下", filenames: ["sample.mcd"] })?.suggest).toBe("imc")
  })

  test("foreign vocabulary never suggests the current direction", () => {
    for (const key of ["imc", "single-cell", "spatial", "genomics"] as const) {
      const sample = FOREIGN[key].source.includes("visium") ? "visium" : "wgs"
      const drift = DomainScope.drift(key, { text: `跑一下 ${sample}`, filenames: [] })
      expect(drift?.suggest).not.toBe(key)
    }
  })

  test("marker normalisation uses the shared alias table", () => {
    expect(BiologyLexicon.normalizeMarkers("GrzB+ FoxP3+ T-bet")).toBe("GZMB+ FOXP3+ TBX21")
    expect(OutputClean.clean("GrzB high")).toBe("GZMB high")
  })
})
