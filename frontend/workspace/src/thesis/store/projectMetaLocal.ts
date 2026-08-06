import { createSignal } from "solid-js"
import { moduleEffect } from "@/utils/persist"

/** User-facing description shown on the home project list (not sent to the agent). */
export type LocalProjectMeta = {
  description?: string
  /** Result directory name under the project root, e.g. Hengyi_Biology_Result. */
  resultFolderName?: string
  /** Display name synced with sidebar / workbench when backend name is unavailable. */
  name?: string
}

const KEY = "thesis-project-meta-local-v1"

function readAll(): Record<string, LocalProjectMeta> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const [all, setAllSig] = createSignal<Record<string, LocalProjectMeta>>(readAll())

moduleEffect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(all()))
  } catch {}
})

function get(worktree: string): LocalProjectMeta {
  return all()[worktree] ?? {}
}

function patch(worktree: string, next: LocalProjectMeta) {
  setAllSig((prev) => ({ ...prev, [worktree]: { ...prev[worktree], ...next } }))
}

function remove(worktree: string) {
  setAllSig((prev) => {
    if (!prev[worktree]) return prev
    const next = { ...prev }
    delete next[worktree]
    return next
  })
}

export const projectMetaLocal = {
  all,
  get,
  patch,
  remove,
}
