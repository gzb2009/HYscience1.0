import { describe, expect, test } from "bun:test"
import { ThemeSlots } from "../../src/session/theme-slots"
import { DataProfile } from "../../src/session/data-profile"
import { SessionReview } from "../../src/session/review"
import { AgentRouter } from "../../src/session/agent-router"
import path from "path"
import os from "os"
import { mkdtemp, writeFile } from "fs/promises"

describe("theme golden gates", () => {
  test("imc: ask on empty design, profile duplicates, check blocks mixed isotopes", async () => {
    const design = "帮我设计一个 IMC panel"
    const kinds = ThemeSlots.intent(AgentRouter.interpret({ text: design }), design)
    expect(ThemeSlots.open("imc", design, kinds).map((slot) => slot.id)).toContain("tissue")

    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-gold-imc-"))
    const file = path.join(dir, "panel.csv")
    await writeFile(file, ["marker,isotope,clone", "CD3,141Pr,UCHT1", "CD8,141Pr,RPA-T8"].join("\n"))
    const summary = await DataProfile.profile(file)
    expect(summary?.status).toBe("ok")
    if (summary?.status !== "ok" || summary.kind !== "table") throw new Error("expected table")
    expect(summary.panel?.duplicates.length).toBeGreaterThan(0)

    const answer = [
      "| marker | isotope | clone | compartment |",
      "| --- | --- | --- | --- |",
      "| CD3 | 141Pr | UCHT1 | membrane |",
      "| CD8 | 141Pr | RPA-T8 | membrane |",
    ].join("\n")
    const findings = ThemeSlots.check("imc", answer)
    expect(SessionReview.merge({ verdict: "CLEAN", findings: [] }, findings).verdict).toBe("FLAGGED")
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings })).toBe(true)
  })

  test("single-cell: ask species, profile is h5ad-shaped, missing clusters block", async () => {
    const text = "分析这个单细胞数据"
    const kinds = ThemeSlots.intent(AgentRouter.interpret({ text }), text)
    expect(ThemeSlots.open("single-cell", text, kinds).some((slot) => slot.id === "Species")).toBe(true)

    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-gold-sc-"))
    const file = path.join(dir, "markers.csv")
    await writeFile(file, "cluster,gene\n0,CD3E\n1,MS4A1\n")
    const summary = await DataProfile.profile(file)
    expect(summary?.status).toBe("ok")

    const answer = ["| cluster | cell_type |", "| --- | --- |", "| 0 | T |"].join("\n")
    const findings = ThemeSlots.check("single-cell", answer, { markerClusters: ["0", "1"] })
    expect(findings[0]?.severity).toBe("blocking")
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings })).toBe(true)
  })

  test("spatial: ask deconvolution, spot-as-cell-type is a warning not a retry", () => {
    const text = "注释这份 visium 空间转录组"
    const kinds = ThemeSlots.intent(AgentRouter.interpret({ text }), text)
    expect(ThemeSlots.open("spatial", text, kinds).some((slot) => slot.id === "deconvolution")).toBe(true)
    const findings = ThemeSlots.check("spatial", "Visium spot 数据的细胞类型以 T 细胞为主。")
    expect(findings[0]?.severity).toBe("warning")
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings })).toBe(false)
  })

  test("genomics: ask reference, vcf profile, mixed assemblies block retry", async () => {
    const text = "分析这个 VCF"
    const kinds = ThemeSlots.intent(AgentRouter.interpret({ text }), text)
    expect(ThemeSlots.open("genomics", text, kinds).some((slot) => slot.id === "Reference")).toBe(true)

    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-gold-vcf-"))
    const file = path.join(dir, "calls.vcf")
    await writeFile(
      file,
      ["##fileformat=VCFv4.2", "##reference=GRCh38", "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1"].join(
        "\n",
      ),
    )
    const summary = await DataProfile.profile(file)
    expect(summary).toMatchObject({ status: "ok", kind: "vcf", reference: "GRCh38" })

    const findings = ThemeSlots.check("genomics", "Variants lifted from hg19 were reported on GRCh38.")
    expect(findings[0]?.severity).toBe("blocking")
    expect(SessionReview.shouldRetry({ attempt: 0, max: 2, findings })).toBe(true)
  })
})
