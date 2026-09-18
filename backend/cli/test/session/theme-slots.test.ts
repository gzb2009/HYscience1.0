import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { mkdtemp, writeFile } from "fs/promises"
import { ThemeSlots } from "../../src/session/theme-slots"
import { DataProfile } from "../../src/session/data-profile"
import { SessionReview } from "../../src/session/review"
import { AgentRouter } from "../../src/session/agent-router"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

function contract(text: string): AgentRouter.Contract {
  return AgentRouter.interpret({ text })
}

function msg(text: string): MessageV2.WithParts {
  const id = Identifier.ascending("message")
  const sessionID = Identifier.ascending("session")
  return {
    info: { id, sessionID, role: "user", time: { created: Date.now() } },
    parts: [{ id: Identifier.ascending("part"), messageID: id, sessionID, type: "text", text }],
  } as unknown as MessageV2.WithParts
}

describe("ThemeSlots", () => {
  test("method questions stay silent; panel design opens only unfilled design slots", () => {
    const method = "IMC 和 CyTOF 有什么区别？"
    expect(ThemeSlots.intent(contract(method), method)).toEqual([])
    expect(ThemeSlots.open("imc", method, ThemeSlots.intent(contract(method), method))).toEqual([])

    const design = "帮我设计一个IMC的panel40个，胃癌 FFPE，全景免疫"
    const kinds = ThemeSlots.intent(contract(design), design)
    expect(kinds).toContain("design")
    const ids = ThemeSlots.open("imc", design, kinds).map((slot) => slot.id)
    expect(ids).not.toContain("tissue")
    expect(ids).not.toContain("FFPE")
    expect(ids).not.toContain("panel size")
    expect(ids).not.toContain("scientific aim")
    expect(ids).not.toContain("segmentation")
  })

  test("inject copies option lists and does not invent a modality card", () => {
    const item = msg("帮我设计一个 IMC panel")
    ThemeSlots.inject(item, contract("帮我设计一个 IMC panel"), "imc")
    const block = item.parts.find((part) => part.type === "text" && (part as MessageV2.TextPart).hybio) as
      | MessageV2.TextPart
      | undefined
    expect(block?.text).toContain('<theme-slots theme="imc"')
    expect(block?.text).toContain("[tissue]")
    expect(block?.text).toContain("[FFPE]")
    expect(block?.text).toContain("Do not invent a different modality card")
    ThemeSlots.inject(item, contract("帮我设计一个 IMC panel"), "imc")
    expect(item.parts.filter((part) => part.type === "text" && (part as MessageV2.TextPart).hybio)).toHaveLength(1)
  })

  test("IMC panel table: duplicate isotope is blocking; missing clone column is blocking", () => {
    const dup = [
      "| marker | isotope | clone | compartment |",
      "| --- | --- | --- | --- |",
      "| CD3 | 141Pr | UCHT1 | membrane |",
      "| CD8 | 141Pr | RPA-T8 | membrane |",
      "| Histone H3 | Ir191 | D1H2 | nuclear |",
      "| CD45 | 89Y | HI30 | membrane |",
      "| aSMA | 141Sm | 1A4 | structural |",
    ].join("\n")
    const findings = ThemeSlots.check("imc", dup)
    expect(findings.some((finding) => finding.message.includes("same isotope twice"))).toBe(true)
    expect(findings.every((finding) => finding.severity === "blocking" || finding.severity === "warning")).toBe(true)

    const missing = ["| marker | isotope |", "| --- | --- |", "| CD3 | 141Pr |"].join("\n")
    const cols = ThemeSlots.check("imc", missing)
    expect(cols.some((finding) => finding.message.includes("clone or compartment"))).toBe(true)
  })

  test("single-cell missing clusters vs markers file is blocking", () => {
    const answer = ["| cluster | cell_type |", "| --- | --- |", "| 0 | T |"].join("\n")
    expect(ThemeSlots.check("single-cell", answer, { markerClusters: ["0", "1", "2"] })[0].severity).toBe("blocking")
    expect(ThemeSlots.check("single-cell", answer, { markerClusters: ["0"] })).toEqual([])
  })

  test("spatial spot data labelled as cell types without deconvolution is a warning", () => {
    const findings = ThemeSlots.check("spatial", "Visium spot 数据的细胞类型以 T 细胞为主。")
    expect(findings[0].severity).toBe("warning")
    expect(ThemeSlots.check("spatial", "Visium spot 去卷积后各类型比例见表。")).toEqual([])
  })

  test("theme findings escalate a CLEAN reviewer verdict", () => {
    const extra = ThemeSlots.check("imc", ["| marker | isotope |", "| --- | --- |", "| CD3 | 141Pr |"].join("\n"))
    expect(SessionReview.merge({ verdict: "CLEAN", findings: [] }, extra).verdict).toBe("FLAGGED")
  })

  test("clustersFromCsv reads every cluster id", () => {
    expect(ThemeSlots.clustersFromCsv("cluster,gene\n0,CD3E\n0,CD3D\n7,MS4A1\n")).toEqual(["0", "7"])
  })
})

describe("DataProfile theme extras", () => {
  test("profiles a panel table's metal column without guessing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-panel-"))
    const file = path.join(dir, "panel.csv")
    await writeFile(file, ["marker,isotope,clone", "CD3,141Pr,UCHT1", "CD8,141Pr,RPA-T8"].join("\n"))
    const summary = await DataProfile.profile(file)
    expect(summary?.status).toBe("ok")
    if (summary?.status !== "ok" || summary.kind !== "table") throw new Error("expected table")
    expect(summary.panel?.duplicates).toEqual(["141pr"])
    expect(DataProfile.render(file, summary)).toContain("DUPLICATE isotopes")
  })

  test("mcd/tiff is an image note, not a guessed h5ad", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-mcd-"))
    const file = path.join(dir, "slide.mcd")
    await writeFile(file, "not a real mcd")
    const summary = await DataProfile.profile(file)
    expect(summary).toEqual({
      status: "ok",
      kind: "image",
      bytes: expect.any(Number),
      note: "acquisition image — segmentation required before cells exist",
    })
    expect(DataProfile.render(file, summary!)).toContain("Do not guess channel count")
  })

  test("vcf header peek reads ##reference and sample count", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-vcf-"))
    const file = path.join(dir, "calls.vcf")
    await writeFile(
      file,
      [
        "##fileformat=VCFv4.2",
        "##reference=GRCh37",
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\tS2",
        "1\t100\t.\tA\tG\t.\tPASS\t.\tGT\t0/1\t0/0",
      ].join("\n"),
    )
    const summary = await DataProfile.profile(file)
    expect(summary).toMatchObject({ status: "ok", kind: "vcf", reference: "GRCh37", samples: 2 })
    expect(DataProfile.render(file, summary!)).toContain("##reference=GRCh37")
  })
})
