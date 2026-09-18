import { describe, expect, test } from "bun:test"
import { TaskProfile } from "../../src/session/task-profile"

describe("TaskProfile", () => {
  test("always routes the session to the research harness", () => {
    expect(TaskProfile.agent({ domain: "biology" })).toBe("research")
    expect(TaskProfile.agent({ domain: "physics" })).toBe("research")
    expect(TaskProfile.agent({ domain: "ml" })).toBe("research")
    expect(TaskProfile.agent({ domain: "general" })).toBe("research")
  })

  test("maps configured domains to discipline packs", () => {
    expect(TaskProfile.pack({ domain: "biology" })).toBe("biology")
    expect(TaskProfile.pack({ domain: "physics" })).toBe("physics")
    expect(TaskProfile.pack({ domain: "ml" })).toBe("ml")
    expect(TaskProfile.pack({ domain: "general" })).toBeUndefined()
  })

  test("uses the configured biology subdomain before automatic detection", () => {
    const fragment = TaskProfile.fragment(
      { domain: "biology", subdomain: "genomics" },
      { text: "analyze a single-cell dataset", filenames: ["cells.h5ad"] },
    )
    expect(fragment).toContain('name="genomics"')
  })

  test("states the IMC project direction without over-locking", () => {
    const context = TaskProfile.context({ domain: "biology", subdomain: "imc" })
    expect(context).toContain('subdomain="imc"')
    expect(context).toContain("Hard limit")
    expect(context).toContain("Not limited")
    expect(context).not.toContain("BLOCKING")
  })

  test("loads physics and ML subdomain strategies", () => {
    expect(TaskProfile.fragment({ domain: "physics", subdomain: "simulation" }, { text: "", filenames: [] })).toContain(
      'name="simulation"',
    )
    expect(TaskProfile.fragment({ domain: "ml", subdomain: "evaluation" }, { text: "", filenames: [] })).toContain(
      'name="evaluation"',
    )
  })
})
