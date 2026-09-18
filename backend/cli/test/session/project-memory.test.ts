import { describe, expect, test } from "bun:test"
import { ProjectMemory } from "../../src/session/project-memory"

describe("ProjectMemory", () => {
  test("extracts species, reference, panel, and env facts", () => {
    const blob = "小鼠胃癌 IMC panel 40 plex, GRCh38, scanpy 1.10"
    expect(ProjectMemory.facts(blob)).toEqual([
      "species: 小鼠",
      "reference: GRCh38",
      "panel: panel 40",
      "env: scanpy 1.10",
    ])
  })

  test("mergeMd upserts keys and marks the file untrusted", () => {
    const first = ProjectMemory.mergeMd("", ["species: mouse", "reference: GRCh38"])
    expect(first).toContain("UNTRUSTED")
    expect(first).toContain("- species: mouse")
    const next = ProjectMemory.mergeMd(first, ["reference: GRCh37"])
    expect(next).toContain("- reference: GRCh37")
    expect(next).toContain("- species: mouse")
  })

  test("formatRecall labels recalled sessions as untrusted", () => {
    const text = ProjectMemory.formatRecall([
      {
        sessionId: "s1",
        title: "IMC panel",
        summary: "Used 141Pr twice by mistake",
        keywords: ["imc"],
        agent: "biology",
        timestamp: Date.now(),
        outcome: "partial",
      },
    ])
    expect(text).toContain("UNTRUSTED")
    expect(text).toContain("<project-memory>")
    expect(text).toContain("IMC panel")
  })
})
