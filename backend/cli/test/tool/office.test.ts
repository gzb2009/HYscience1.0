import { describe, expect, test } from "bun:test"
import { buildXlsx } from "../../src/tool/office-xlsx"
import { buildDocx } from "../../src/tool/office-docx"
import { buildPptx } from "../../src/tool/office-pptx"
import { officePreview } from "../../src/tool/office-read"

describe("buildXlsx", () => {
  test("writes a real xlsx zip with headers and numeric cells", () => {
    const bytes = buildXlsx([
      {
        name: "Panel",
        headers: ["Marker", "Count"],
        rows: [
          ["CD3", 3],
          ["CXCR5", 1],
        ],
      },
    ])
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("CD3")
    expect(text).toContain("<v>3</v>")
    expect(text).toContain('name="Panel"')
  })

  test("supports multiple sheets and escapes xml", () => {
    const bytes = buildXlsx([
      { name: "A&B", rows: [["<tag>"]] },
      { name: "Notes", rows: [["ok"]] },
    ])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("A&amp;B")
    expect(text).toContain("&lt;tag&gt;")
    expect(text).toContain("sheet2.xml")
  })

  test("decodes html entities into real chinese", () => {
    const xlsx = officePreview(
      "panel.xlsx",
      buildXlsx([
        {
          name: "&#35774;&#35745;&#35828;&#26126;",
          headers: ["PCF / &#21069;&#36523; CODEX"],
          rows: [["&#24179;&#21488;"]],
        },
      ]),
    )
    expect(xlsx?.sheets?.[0]?.name).toBe("设计说明")
    expect(xlsx?.sheets?.[0]?.rows[0]?.[0]).toBe("PCF / 前身 CODEX")
    expect(xlsx?.sheets?.[0]?.rows[1]?.[0]).toBe("平台")
    const raw = new TextDecoder().decode(
      buildXlsx([{ name: "Notes", headers: ["&#21069;&#36523;"], rows: [["&#21069;&#21015;&#33146;&#30284;"]] }]),
    )
    expect(raw).toContain("前身")
    expect(raw).toContain("前列腺癌")
    expect(raw).not.toContain("&#21069;")
  })

  test("roundtrips excel word and powerpoint for in-app preview", () => {
    const xlsx = officePreview("panel.xlsx", buildXlsx([{ name: "Panel", headers: ["Marker"], rows: [["CD3"]] }]))
    expect(xlsx?.kind).toBe("xlsx")
    expect(xlsx?.sheets?.[0]?.rows[1]?.[0]).toBe("CD3")

    const docx = officePreview(
      "notes.docx",
      buildDocx([
        { type: "heading", text: "Aim" },
        { type: "paragraph", text: "B-biased panel" },
        { type: "table", headers: ["Marker"], rows: [["CXCR5"]] },
      ]),
    )
    expect(docx?.kind).toBe("docx")
    expect(docx?.blocks?.some((block) => block.text === "Aim")).toBe(true)
    expect(docx?.blocks?.some((block) => block.rows?.[1]?.[0] === "CXCR5")).toBe(true)

    const pptx = officePreview(
      "brief.pptx",
      buildPptx([{ title: "Panel", lines: ["50 markers"], table: { headers: ["M"], rows: [["CD19"]] } }]),
    )
    expect(pptx?.kind).toBe("pptx")
    expect(pptx?.slides?.[0]?.title).toBe("Panel")
    expect(pptx?.slides?.[0]?.lines.join(" ")).toContain("50 markers")
  })
})
