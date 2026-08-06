import { describe, expect, test } from "bun:test"
import { SessionArtifact } from "../../src/session/artifact"

describe("SessionArtifact.collect", () => {
  test("ignores filenames mentioned in glob output", async () => {
    const artifacts = await SessionArtifact.collect({
      tool: "glob",
      args: { pattern: "**/*.md" },
      output: "AGENTS.md\nARCHITECTURE.md\nCHANGELOG.md\n.mcp.json",
    })
    expect(artifacts).toHaveLength(0)
  })

  test("ignores filenames mentioned in list output", async () => {
    const artifacts = await SessionArtifact.collect({
      tool: "list",
      args: { path: "." },
      output: "- AGENTS.md\n- ARCHITECTURE.md\n- CLAUDE.md",
    })
    expect(artifacts).toHaveLength(0)
  })

  test("ignores filenames mentioned in read output", async () => {
    const artifacts = await SessionArtifact.collect({
      tool: "read",
      args: { filePath: "README.md" },
      output: "# HYscience\nSee also ARCHITECTURE.md and CHANGELOG.md",
    })
    expect(artifacts).toHaveLength(0)
  })

  test("ignores filenames mentioned in grep output", async () => {
    const artifacts = await SessionArtifact.collect({
      tool: "grep",
      args: { pattern: "HYscience" },
      output: "README.md:1:# HYscience\nCLAUDE.md:10:agent prompts",
    })
    expect(artifacts).toHaveLength(0)
  })
})
