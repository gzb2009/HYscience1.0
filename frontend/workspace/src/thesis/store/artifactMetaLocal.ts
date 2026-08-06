import { createSignal } from "solid-js"
import { moduleEffect } from "@/utils/persist"

export type ArtifactMeta = {
  starred?: boolean
  hidden?: boolean
}

type Store = Record<string, Record<string, ArtifactMeta>>

const KEY = "thesis-artifact-meta-local-v1"

function readAll(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const [all, setAll] = createSignal<Store>(readAll())

moduleEffect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(all()))
  } catch {}
})

function get(directory: string, path: string): ArtifactMeta {
  return all()[directory]?.[path] ?? {}
}

function patch(directory: string, path: string, next: ArtifactMeta) {
  setAll((prev) => ({
    ...prev,
    [directory]: {
      ...(prev[directory] ?? {}),
      [path]: { ...(prev[directory]?.[path] ?? {}), ...next },
    },
  }))
}

function remove(directory: string, path: string) {
  setAll((prev) => {
    const dir = prev[directory]
    if (!dir?.[path]) return prev
    const nextDir = { ...dir }
    delete nextDir[path]
    return { ...prev, [directory]: nextDir }
  })
}

function move(directory: string, from: string, to: string) {
  setAll((prev) => {
    const meta = prev[directory]?.[from]
    if (!meta) return prev
    const nextDir = { ...(prev[directory] ?? {}) }
    delete nextDir[from]
    nextDir[to] = meta
    return { ...prev, [directory]: nextDir }
  })
}

export const artifactMetaLocal = {
  all,
  get,
  patch,
  remove,
  move,
}
