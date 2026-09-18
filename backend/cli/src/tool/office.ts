import z from "zod"
import path from "path"
import { mkdir } from "fs/promises"
import { Tool } from "./tool"
import DESCRIPTION from "./office.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { decodeEntities } from "./office-text"
import { buildXlsx } from "./office-xlsx"
import { buildDocx, type DocBlock } from "./office-docx"
import { buildPptx, type Slide } from "./office-pptx"

const Value = z.union([z.string(), z.number(), z.boolean(), z.null()])
const Sheet = z.object({
  name: z.string().optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(Value)),
})
const Block = z.object({
  type: z.enum(["heading", "paragraph", "table"]),
  text: z.string().optional(),
  level: z.number().optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(Value)).optional(),
})
const SlideInput = z.object({
  title: z.string(),
  lines: z.array(z.string()).optional(),
  table: z
    .object({
      headers: z.array(z.string()).optional(),
      rows: z.array(z.array(Value)),
    })
    .optional(),
})

function cleanValue(value: z.infer<typeof Value>): z.infer<typeof Value> {
  return typeof value === "string" ? decodeEntities(value) : value
}

function cleanSheet(sheet: z.infer<typeof Sheet>): z.infer<typeof Sheet> {
  return {
    name: sheet.name ? decodeEntities(sheet.name) : sheet.name,
    headers: sheet.headers?.map(decodeEntities),
    rows: sheet.rows.map((row) => row.map(cleanValue)),
  }
}

function asBlocks(sheets: z.infer<typeof Sheet>[]): DocBlock[] {
  return sheets.flatMap((sheet) => [
    { type: "heading" as const, text: sheet.name || "Table", level: 1 },
    { type: "table" as const, headers: sheet.headers, rows: sheet.rows },
  ])
}

function asSlides(sheets: z.infer<typeof Sheet>[]): Slide[] {
  return sheets.map((sheet) => ({
    title: sheet.name || "Table",
    table: { headers: sheet.headers, rows: sheet.rows },
  }))
}

export const OfficeTool = Tool.define("office", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Absolute or project-relative .xlsx / .docx / .pptx path"),
    sheets: z.array(Sheet).optional().describe("Excel sheets, or a table to place in Word/PowerPoint"),
    blocks: z.array(Block).optional().describe("Word blocks: heading, paragraph, or table"),
    slides: z.array(SlideInput).optional().describe("PowerPoint slides with title, lines, optional table"),
  }),
  async execute(params, ctx) {
    const ext = path.extname(params.filePath).toLowerCase()
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)
    const exists = await Bun.file(filepath).exists()
    if (exists) await FileTime.assert(ctx.sessionID, filepath)
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: { filepath },
    })
    const sheets = params.sheets?.map(cleanSheet)
    const blocks = params.blocks?.map((block) => ({
      ...block,
      text: block.text ? decodeEntities(block.text) : block.text,
      headers: block.headers?.map(decodeEntities),
      rows: block.rows?.map((row) => row.map(cleanValue)),
    }))
    const slides = params.slides?.map((slide) => ({
      ...slide,
      title: decodeEntities(slide.title),
      lines: slide.lines?.map(decodeEntities),
      table: slide.table
        ? {
            headers: slide.table.headers?.map(decodeEntities),
            rows: slide.table.rows.map((row) => row.map(cleanValue)),
          }
        : slide.table,
    }))
    const bytes = (() => {
      if (ext === ".xlsx") {
        if (!sheets?.length) throw new Error("Excel requires sheets")
        return buildXlsx(sheets)
      }
      if (ext === ".docx") {
        const next = (blocks?.length ? blocks : sheets ? asBlocks(sheets) : []) as DocBlock[]
        if (next.length === 0) throw new Error("Word requires blocks or sheets")
        return buildDocx(next)
      }
      if (ext === ".pptx") {
        const next = slides?.length ? slides : sheets ? asSlides(sheets) : []
        if (next.length === 0) throw new Error("PowerPoint requires slides or sheets")
        return buildPptx(next)
      }
      throw new Error("Office tool writes .xlsx, .docx, or .pptx")
    })()
    await mkdir(path.dirname(filepath), { recursive: true })
    await Bun.write(filepath, bytes)
    await Bus.publish(File.Event.Edited, { file: filepath })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: filepath,
      event: exists ? "change" : "add",
    })
    FileTime.read(ctx.sessionID, filepath)
    const kind = ext === ".xlsx" ? "Excel" : ext === ".docx" ? "Word" : "PowerPoint"
    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: { filepath, exists, kind },
      output: `Wrote ${kind}: ${path.relative(Instance.directory, filepath)}`,
    }
  },
})
