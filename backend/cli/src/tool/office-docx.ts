import { zipStore } from "./office-zip"
import { escapeXml, plain } from "./office-text"
import type { Cell } from "./office-xlsx"

export type DocBlock =
  | { type: "heading"; text: string; level?: number }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers?: string[]; rows: Cell[][] }

function run(text: string, shade?: boolean) {
  const color = shade ? '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' : ""
  return `<w:r>${color}<w:t xml:space="preserve">${escapeXml(plain(text))}</w:t></w:r>`
}

function paragraph(text: string, style?: string) {
  const pr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""
  return `<w:p>${pr}${run(text)}</w:p>`
}

function cell(value: Cell, shade?: boolean) {
  const fill = shade ? '<w:tcPr><w:shd w:val="clear" w:fill="1D6F42"/></w:tcPr>' : ""
  return `<w:tc>${fill}<w:p>${run(value == null ? "" : String(value), shade)}</w:p></w:tc>`
}

function table(headers: string[] | undefined, rows: Cell[][]) {
  const head = headers?.length ? `<w:tr>${headers.map((item) => cell(item, true)).join("")}</w:tr>` : ""
  const body = rows.map((row) => `<w:tr>${row.map((item) => cell(item)).join("")}</w:tr>`).join("")
  return [
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>',
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D5DD"/><w:left w:val="single" w:sz="4" w:color="D0D5DD"/><w:bottom w:val="single" w:sz="4" w:color="D0D5DD"/><w:right w:val="single" w:sz="4" w:color="D0D5DD"/><w:insideH w:val="single" w:sz="4" w:color="D0D5DD"/><w:insideV w:val="single" w:sz="4" w:color="D0D5DD"/></w:tblBorders>',
    `</w:tblPr>${head}${body}</w:tbl>`,
  ].join("")
}

function blockXml(block: DocBlock) {
  if (block.type === "heading") return paragraph(block.text, `Heading${Math.min(block.level ?? 1, 3)}`)
  if (block.type === "table") return table(block.headers, block.rows)
  return paragraph(block.text)
}

export function buildDocx(blocks: DocBlock[]) {
  if (blocks.length === 0) throw new Error("At least one Word block is required")
  const encoder = new TextEncoder()
  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    ...blocks.map(blockXml),
    "</w:body>",
    "</w:document>",
  ].join("")
  const styles = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>',
    "</w:styles>",
  ].join("")
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      ),
    },
    { name: "word/document.xml", data: encoder.encode(document) },
    { name: "word/styles.xml", data: encoder.encode(styles) },
  ])
}
