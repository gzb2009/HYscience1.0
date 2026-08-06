import { createSignal } from "solid-js"
import { moduleEffect } from "@/utils/persist"

type SessionTitleEntry = {
  title: string
}

const KEY = "thesis-session-title-local-v1"

function readAll(): Record<string, SessionTitleEntry> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const [all, setAllSig] = createSignal<Record<string, SessionTitleEntry>>(readAll())

moduleEffect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(all()))
  } catch {}
})

function get(sessionID: string): SessionTitleEntry | undefined {
  return all()[sessionID]
}

function patch(sessionID: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  const next = { ...all(), [sessionID]: { title: trimmed } }
  setAllSig(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

function remove(sessionID: string) {
  setAllSig((prev) => {
    if (!prev[sessionID]) return prev
    const next = { ...prev }
    delete next[sessionID]
    return next
  })
}

export const sessionTitleLocal = {
  all,
  get,
  patch,
  remove,
}
