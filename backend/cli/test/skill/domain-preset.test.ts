import { describe, expect, test } from "bun:test"
import { domainSkillAllowed } from "../../src/skill/domain-preset"

describe("domainSkillAllowed", () => {
  test("lets IMC share scanpy without treating it as a direction lock", () => {
    expect(domainSkillAllowed("imc", "imc-analysis")).toBe(true)
    expect(domainSkillAllowed("imc", "literature-review")).toBe(true)
    expect(domainSkillAllowed("imc", "scanpy")).toBe(true)
    expect(domainSkillAllowed("imc", "anndata")).toBe(true)
  })

  test("keeps single-cell pipelines on the single-cell domain", () => {
    expect(domainSkillAllowed("single-cell", "single-cell-pipeline")).toBe(true)
    expect(domainSkillAllowed("single-cell", "scanpy")).toBe(true)
    expect(domainSkillAllowed("single-cell", "imc-analysis")).toBe(false)
  })
})
