import { zipStore } from "./office-zip"
import { escapeXml, plain } from "./office-text"
import type { Cell } from "./office-xlsx"

export type Slide = {
  title: string
  lines?: string[]
  table?: { headers?: string[]; rows: Cell[][] }
}

function textPara(text: string, size: number) {
  return `<a:p><a:r><a:rPr lang="zh-CN" sz="${size}"/><a:t>${escapeXml(plain(text))}</a:t></a:r></a:p>`
}

function slideXml(slide: Slide, index: number) {
  const lines = slide.lines ?? []
  const body = [
    textPara(slide.title || `Slide ${index + 1}`, 2800),
    ...lines.map((line) => textPara(line, 1600)),
    ...((slide.table?.headers ?? []).length ? [textPara((slide.table?.headers ?? []).join(" | "), 1400)] : []),
    ...(slide.table?.rows ?? []).map((row) =>
      textPara(row.map((cell) => (cell == null ? "" : plain(cell))).join(" | "), 1400),
    ),
  ].join("")
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<p:cSld><p:spTree>",
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    "<p:grpSpPr/>",
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>',
    '<p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>',
    `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>`,
    "</p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
  ].join("")
}

export function buildPptx(slides: Slide[]) {
  if (slides.length === 0) throw new Error("At least one slide is required")
  const encoder = new TextEncoder()
  const presentation = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    "<p:sldIdLst>",
    ...slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`),
    "</p:sldIdLst>",
    '<p:sldSz cx="9144000" cy="5143500"/>',
    "</p:presentation>",
  ].join("")
  const rels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...slides.map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
    ),
    "</Relationships>",
  ].join("")
  const types = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    ...slides.map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    ),
    "</Types>",
  ].join("")
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(types) },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
      ),
    },
    { name: "ppt/presentation.xml", data: encoder.encode(presentation) },
    { name: "ppt/_rels/presentation.xml.rels", data: encoder.encode(rels) },
    ...slides.map((slide, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: encoder.encode(slideXml(slide, index)),
    })),
  ])
}
