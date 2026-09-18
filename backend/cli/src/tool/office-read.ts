import { unzip, xmlText } from "./office-zip"
import { decodeEntities } from "./office-text"

export type OfficePreview = {
  kind: "xlsx" | "docx" | "pptx"
  sheets?: { name: string; rows: string[][] }[]
  blocks?: { type: "heading" | "paragraph" | "table"; text?: string; rows?: string[][] }[]
  slides?: { title: string; lines: string[] }[]
}

function decode(value: string) {
  return decodeEntities(value)
}

function texts(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((match) =>
    decode(match[1]).trim(),
  )
}

function parseXlsx(files: Map<string, Uint8Array>): OfficePreview {
  const shared = texts(xmlText(files.get("xl/sharedStrings.xml")), "t")
  const book = xmlText(files.get("xl/workbook.xml"))
  const names = [...book.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => decode(match[1]))
  const sheets = [...files.keys()]
    .filter((name) => name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml"))
    .sort()
    .map((name, index) => {
      const xml = xmlText(files.get(name))
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
          const attrs = cell[1]
          const body = cell[2]
          if (/t="inlineStr"/.test(attrs)) return decode(body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "")
          if (/t="s"/.test(attrs)) return shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "")] ?? ""
          return body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""
        }),
      )
      return { name: names[index] ?? `Sheet${index + 1}`, rows }
    })
  return { kind: "xlsx", sheets }
}

function parseDocx(files: Map<string, Uint8Array>): OfficePreview {
  const xml = xmlText(files.get("word/document.xml"))
  const blocks = [...xml.matchAll(/<(w:p|w:tbl)\b[\s\S]*?<\/\1>/g)].map((match) => {
    if (match[1] === "w:tbl") {
      const rows = [...match[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((row) =>
        [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) => texts(cell[0], "w:t").join("")),
      )
      return { type: "table" as const, rows }
    }
    const text = texts(match[0], "w:t").join("")
    return { type: /Heading/.test(match[0]) ? ("heading" as const) : ("paragraph" as const), text }
  })
  return { kind: "docx", blocks: blocks.filter((block) => block.text || block.rows?.length) }
}

function parsePptx(files: Map<string, Uint8Array>): OfficePreview {
  const slides = [...files.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort()
    .map((name) => {
      const lines = texts(xmlText(files.get(name)), "a:t").filter(Boolean)
      return { title: lines[0] ?? "Slide", lines: lines.slice(1) }
    })
  return { kind: "pptx", slides }
}

export function officePreview(name: string, bytes: Uint8Array): OfficePreview | undefined {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : ""
  if (ext !== "xlsx" && ext !== "xlsm" && ext !== "docx" && ext !== "pptx") return
  const files = unzip(bytes)
  if (ext === "docx") return parseDocx(files)
  if (ext === "pptx") return parsePptx(files)
  return parseXlsx(files)
}
