import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"

describe("SystemPrompt.cacheLayers", () => {
  test("keeps provider text in the frozen block and env in the live block", () => {
    const layers = SystemPrompt.cacheLayers({
      frozen: ["BASE SYSTEM", "ANTHROPIC TAIL"],
      live: ["Working directory: /tmp", "slash-skill"],
    })
    expect(layers).toHaveLength(2)
    expect(layers[0]).toContain("BASE SYSTEM")
    expect(layers[0]).not.toContain("Working directory")
    expect(layers[1]).toContain("Working directory")
    expect(layers[1]).toContain("slash-skill")
  })
})
