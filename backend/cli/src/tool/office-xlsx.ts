import { zipStore } from "./office-zip"
import { escapeXml, plain } from "./office-text"

export type Cell = string | number | boolean | null
export type Sheet = {
  name?: string
  headers?: string[]
  rows: Cell[][]
}

const STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2">',
  '<font><sz val="11"/><name val="Calibri"/><charset val="134"/></font>',
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><charset val="134"/></font>',
  "</fonts>",
  '<fills count="3">',
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1D6F42"/><bgColor rgb="FF1D6F42"/></patternFill></fill>',
  "</fills>",
  '<borders count="2">',
  "<border/>",
  '<border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom></border>',
  "</borders>",
  '<cellXfs count="3">',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>',
  "</cellXfs>",
  "</styleSheet>",
].join("")

function sheetName(name: string | undefined, index: number) {
  const raw =
    plain(name ?? `Sheet${index + 1}`)
      .replace(/[:\\/?*\[\]]/g, " ")
      .trim() || `Sheet${index + 1}`
  return raw.slice(0, 31)
}

function column(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return column(Math.floor(index / 26) - 1) + column(index % 26)
}

function span(text: string) {
  return [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
}

function widths(sheet: Sheet) {
  const header = sheet.headers ?? []
  const cols = Math.max(header.length, ...sheet.rows.map((row) => row.length), 1)
  return Array.from({ length: cols }, (_, index) => {
    const cells = [header[index], ...sheet.rows.map((row) => row[index])].map((cell) =>
      cell == null ? "" : String(cell),
    )
    return Math.min(42, Math.max(10, ...cells.map(span)) + 2)
  })
}

function cellXml(value: Cell, ref: string, style: number) {
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`
  if (typeof value === "boolean") return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(plain(value))}</t></is></c>`
}

function rowXml(cells: Cell[], row: number, style: number) {
  const items = cells.map((value, index) => cellXml(value, `${column(index)}${row}`, style)).join("")
  return `<row r="${row}" ht="18" customHeight="1">${items}</row>`
}

function sheetXml(sheet: Sheet) {
  const header = sheet.headers?.length ? [rowXml(sheet.headers.map(plain), 1, 1)] : []
  const start = header.length + 1
  const body = sheet.rows.map((cells, index) => rowXml(cells, start + index, 2))
  const cols = widths(sheet)
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("")
  const freeze = header.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : ""
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    freeze,
    `<cols>${cols}</cols>`,
    "<sheetData>",
    ...header,
    ...body,
    "</sheetData>",
    "</worksheet>",
  ].join("")
}

export function buildXlsx(sheets: Sheet[]) {
  if (sheets.length === 0) throw new Error("At least one sheet is required")
  const names = sheets.map((sheet, index) => sheetName(sheet.name, index))
  const encoder = new TextEncoder()
  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<sheets>",
    ...names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`),
    "</sheets>",
    "</workbook>",
  ].join("")
  const rels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    ...names.map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    ),
    "</Relationships>",
  ].join("")
  const types = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...names.map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
    "</Types>",
  ].join("")
  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    "</Relationships>",
  ].join("")
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(types) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(rels) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ])
}
