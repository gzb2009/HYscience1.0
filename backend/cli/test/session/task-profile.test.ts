import { describe, expect, test } from "bun:test"
import { TaskProfile } from "../../src/session/task-profile"

describe("TaskProfile", () => {
  test("routes configured domains to their specialist agents", () => {
    expect(TaskProfile.agent({ domain: "biology" })).toBe("biology")
    expect(TaskProfile.agent({ domain: "physics" })).toBe("physics")
    expect(TaskProfile.agent({ domain: "ml" })).toBe("ml")
    expect(TaskProfile.agent({ domain: "general" })).toBe("research")
  })

  test("uses the configured biology subdomain before automatic detection", () => {
    const fragment = TaskProfile.fragment(
      { domain: "biology", subdomain: "genomics" },
      { text: "analyze a single-cell dataset", filenames: ["cells.h5ad"] },
    )
    expect(fragment).toContain('name="genomics"')
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
