import path from "path"
import fs from "fs"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"

export namespace SessionArtifact {
  export type Item = {
    path: string
    name: string
    mime: string
    size: number
    verified: true
  }

  const EXTENSIONS = /\.(?:xlsx|xls|csv|tsv|md|markdown|png|jpg|jpeg|webp|svg|gif|pdf|json|jsonl|py|r|sh|h5ad|rds)$/i

  function mime(name: string) {
    const ext = path.extname(name).slice(1).toLowerCase()
    if (ext === "png") return "image/png"
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
    if (ext === "webp") return "image/webp"
    if (ext === "gif") return "image/gif"
    if (ext === "svg") return "image/svg+xml"
    if (ext === "pdf") return "application/pdf"
    if (ext === "csv") return "text/csv"
    if (ext === "tsv") return "text/tab-separated-values"
    if (ext === "md" || ext === "markdown") return "text/markdown"
    if (ext === "json" || ext === "jsonl") return "application/json"
    return "application/octet-stream"
  }

  function paths(input: { tool: string; args: unknown; output: string }) {
    const args = input.args as { filePath?: string; path?: string; output?: string } | undefined
    const values =
      input.tool === "write" || input.tool === "edit"
        ? [args?.filePath].filter((value): value is string => !!value)
        : [args?.output].filter((value): value is string => !!value)
    const text = input.output ?? ""
    for (const match of text.matchAll(
      /(?:wrote|saved|output|created|生成|写入|保存|输出)(?:\s+to)?\s*:?\s*([^\s\n()]+?\.\w{2,8})(?=$|[\s.,;)\]])/gi,
    )) {
      values.push(match[1])
    }
    for (const match of text.matchAll(/([^\s"'`()]+?\.\w{2,8})(?=$|[\s.,;)\]])/g)) {
      if (EXTENSIONS.test(match[1])) values.push(match[1])
    }
    return [...new Set(values.map((value) => value.replace(/^file:\/\//, "").replace(/^["'`]+|["'`,;:.]+$/g, "")))]
  }

  async function recent(since: number) {
    const top = await fs.promises.readdir(Instance.directory, { withFileTypes: true }).catch(() => [])
    const dirs = top
      .filter(
        (entry) =>
          entry.isDirectory() && (entry.name === "result" || entry.name === "results" || /_Result$/i.test(entry.name)),
      )
      .map((entry) => path.join(Instance.directory, entry.name))
    const roots = [Instance.directory, ...dirs]
    const out: string[] = []
    for (const root of roots) {
      const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = path.join(root, entry.name)
        if (entry.isFile() && EXTENSIONS.test(entry.name)) {
          const stat = await fs.promises.stat(full).catch(() => undefined)
          if (stat && stat.mtimeMs >= since - 1_000) out.push(full)
          continue
        }
        if (!entry.isDirectory() || root === Instance.directory) continue
        const nested = await fs.promises.readdir(full, { withFileTypes: true }).catch(() => [])
        for (const child of nested) {
          if (!child.isFile() || !EXTENSIONS.test(child.name)) continue
          const target = path.join(full, child.name)
          const stat = await fs.promises.stat(target).catch(() => undefined)
          if (stat && stat.mtimeMs >= since - 1_000) out.push(target)
        }
      }
    }
    return out
  }

  export async function collect(input: {
    tool: string
    args: unknown
    output: string
    since?: number
  }): Promise<Item[]> {
    const discovered = input.tool === "bash" && input.since ? await recent(input.since) : []
    const out: Item[] = []
    for (const candidate of [...paths(input), ...discovered]) {
      if (!candidate || !EXTENSIONS.test(candidate)) continue
      const full = path.isAbsolute(candidate) ? candidate : path.resolve(Instance.directory, candidate)
      if (!Filesystem.containsReal(Instance.worktree, full)) continue
      const file = Bun.file(full)
      const stat = await file.stat().catch(() => undefined)
      if (!stat?.isFile()) continue
      out.push({
        path: path.relative(Instance.directory, full),
        name: path.basename(full),
        mime: file.type || mime(full),
        size: stat.size,
        verified: true,
      })
    }
    return out
  }
}
