import { describe, expect, test } from "bun:test"
import { parseDomainSwitch, switchFromParts } from "./switch"

describe("parseDomainSwitch", () => {
  test("reads an execute card", () => {
    const hit = parseDomainSwitch(
      `<domain-switch current="imc" suggest="single-cell" currentTitle="IMC 分析" suggestTitle="单细胞分析" kind="execute"></domain-switch>`,
    )
    expect(hit?.kind).toBe("execute")
    expect(hit?.suggest).toBe("single-cell")
  })

  test("finds the card among parts", () => {
    expect(
      switchFromParts([
        { type: "text", text: "你能不能做单细胞测序的分析" },
        {
          type: "text",
          text: `<domain-switch current="imc" suggest="single-cell" currentTitle="IMC 分析" suggestTitle="单细胞分析" kind="ask"></domain-switch>`,
        },
      ])?.kind,
    ).toBe("ask")
  })
})
