import type { Project } from "@hysci/sdk/v2/client"
import { projectRoot } from "@/utils/projectResult"

export function findProjectByWorktree(projects: Project[], worktree: string): Project | undefined {
  return projects.find((p) => p.worktree === worktree)
}

/** Resolved workspace for tasks, files, and SDK scope (defaults to project worktree). */
export function resolveProjectWorkingDir(worktree: string): string {
  return projectRoot(worktree)
}

export function formatWorkingDirLabel(path: string): string {
  const p = (path || "").trim()
  if (!p) return ""
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")
}

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/")
}

function guessHomeFromPath(value: string) {
  const match = value.match(/^\/(?:Users|home)\/[^/]+/)
  return match?.[0] ?? ""
}

function expandHomePath(value: string, home: string) {
  if (value === "~") return home
  if (value.startsWith("~/")) return `${home}${value.slice(1)}`
  return value
}

function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)
}

function dirname(value: string) {
  const index = value.lastIndexOf("/")
  if (index <= 0) return value.startsWith("/") ? "/" : "."
  return value.slice(0, index)
}

function basename(value: string) {
  const index = value.lastIndexOf("/")
  return index >= 0 ? value.slice(index + 1) : value
}

function stripRootPrefix(full: string, root: string) {
  const normalized = normalizeSlashes(full.replace(/\/$/, ""))
  const base = normalizeSlashes(root.replace(/\/$/, ""))
  if (normalized === base) return ""
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return undefined
}

export type HostFileRef = {
  directory: string
  path: string
}

function normalizeRelativePath(value: string) {
  const parts = normalizeSlashes(value.replace(/^\.\//, "")).split("/").filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    if (out.length && out[out.length - 1] === part) continue
    out.push(part)
  }
  return out.join("/")
}

/** Map agent / message paths to SDK `directory` + relative `path` for file.read. */
export function resolveHostFileRef(worktree: string, raw: string, home?: string): HostFileRef {
  const root = normalizeSlashes((worktree || "").trim().replace(/\/$/, ""))
  const cleaned = raw
    .trim()
    .replace(/^file:\/\//, "")
    .replace(/^["'`]+|["'`,;:.]+$/g, "")
  if (!cleaned) return { directory: root, path: "" }

  const resolvedHome = home || guessHomeFromPath(root)
  let full = normalizeSlashes(expandHomePath(cleaned, resolvedHome))
  full = full.replace(/^\.\//, "")

  if (!isAbsolutePath(full)) return { directory: root, path: normalizeRelativePath(full) }

  const relative = stripRootPrefix(full, root)
  if (relative !== undefined) return { directory: root, path: normalizeRelativePath(relative) }

  const parent = dirname(full)
  return { directory: parent, path: basename(full) }
}

export function formatHostFilePath(directory: string, path: string) {
  const root = normalizeSlashes((directory || "").trim().replace(/\/$/, ""))
  const rel = normalizeSlashes((path || "").trim().replace(/^\.\//, ""))
  if (!root) return formatWorkingDirLabel(rel)
  if (!rel) return formatWorkingDirLabel(root)
  if (isAbsolutePath(rel)) return formatWorkingDirLabel(rel)
  return formatWorkingDirLabel(`${root}/${rel}`)
}
