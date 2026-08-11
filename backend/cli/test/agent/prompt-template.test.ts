import { describe, expect, test } from "bun:test"
import { PromptTemplate } from "../../src/agent/prompt-template"
import { PromptLoader } from "../../src/agent/prompt-loader"
import { BUILTIN } from "../../src/agent/definitions/builtin"

describe("prompt-template", () => {
  test("replaces known variables", () => {
    const text = "Model: {{model_name}} on {{date}}"
    expect(PromptTemplate.render(text, { model_name: "gpt-5", date: "2026-08-11" })).toBe("Model: gpt-5 on 2026-08-11")
  })

  test("leaves unknown variables unchanged", () => {
    expect(PromptTemplate.render("{{missing}}", {})).toBe("{{missing}}")
  })
})

describe("prompt-loader", () => {
  test("loads known prompt files", () => {
    expect(PromptLoader.load("explore.txt").length).toBeGreaterThan(100)
    expect(PromptLoader.names()).toContain("research-core-v2.txt")
  })

  test("applies template variables when loading", () => {
    const rendered = PromptLoader.load("title.txt", { date: "2026-08-11" })
    expect(rendered).toBe(PromptLoader.load("title.txt"))
  })
})

describe("agent.definitions.builtin", () => {
  test("defines all native agents", () => {
    const keys = BUILTIN.map((item) => item.key)
    expect(keys).toContain("research")
    expect(keys).toContain("biology")
    expect(keys).toContain("compaction")
    expect(keys).toHaveLength(14)
  })
})
