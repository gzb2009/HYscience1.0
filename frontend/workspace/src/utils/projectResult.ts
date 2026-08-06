import { projectMetaLocal } from "@/thesis/store/projectMetaLocal"

export const RESULT_DIR = "result"
export const UPLOAD_DIR = "upload"

function basename(path: string) {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? "Project"
}

export function projectRoot(worktree: string) {
  const parts = worktree.replace(/\/+$/, "").split("/")
  // Strip legacy *_Result dirs and the new result/ dir
  while (true) {
    const last = parts.at(-1) ?? ""
    if (
      last === RESULT_DIR ||
      last === "results" ||
      last === UPLOAD_DIR ||
      /^[A-Za-z0-9][A-Za-z0-9_]*_Result$/i.test(last)
    )
      parts.pop()
    else break
  }
  return parts.join("/") || "/"
}

/** Always returns "result" — fixed directory name for all projects. */
export function resultFolderName(_worktree?: string, _name?: string) {
  return RESULT_DIR
}

export function uploadFolderName() {
  return UPLOAD_DIR
}

export function resultDirectory(worktree: string, _name?: string) {
  const root = projectRoot(worktree)
  return `${root}/${RESULT_DIR}`
}

export function uploadDirectory(worktree: string) {
  const root = projectRoot(worktree)
  return `${root}/${UPLOAD_DIR}`
}

export function isResultFolderName(input: string) {
  const trimmed = input.trim()
  return trimmed === RESULT_DIR || trimmed === "results" || /^[A-Za-z0-9][A-Za-z0-9_]*_Result$/.test(trimmed)
}

export function isResultDirectory(path: string) {
  const name = path.split("/").filter(Boolean).at(-1) ?? ""
  return isResultFolderName(name)
}

async function postJSON<T>(url: string, fetchFn: typeof fetch, body: unknown): Promise<T> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? data?.message ?? `request failed: ${res.status}`)
  return data as T
}

export function ensureDirectory(baseUrl: string, fetchFn: typeof fetch, directory: string, path = ".") {
  const url = `${baseUrl}/file/directory/ensure?directory=${encodeURIComponent(directory)}`
  return postJSON<{ path: string }>(url, fetchFn, { path })
}

export function migrateResultDirectory(
  baseUrl: string,
  fetchFn: typeof fetch,
  worktree: string,
  from: string,
  to: string,
) {
  if (!from || !to || from === to) return Promise.resolve({ migrated: false })
  const url = `${baseUrl}/file/directory/migrate?directory=${encodeURIComponent(worktree)}`
  return postJSON<{ migrated: boolean }>(url, fetchFn, { from, to })
}

/** Compatibility shim — always returns "result". Kept for existing importers. */
export function normalizeResultFolderName(_input: string, _fallback?: string) {
  return RESULT_DIR
}
