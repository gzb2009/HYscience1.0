import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"

export namespace SessionTrace {
  export type Entry = {
    step: number
    phase: string
    action: string
    time: number
    injections?: string[]
    tools?: string[]
    tokens?: {
      input: number
      output: number
      cache: number
    }
  }

  const MAX = 100
  const entries: Record<string, Entry[]> = {}
  const turn: Record<string, { step: number; injections: string[] }> = {}

  export function begin(sessionID: string, step: number) {
    turn[sessionID] = { step, injections: [] }
  }

  export function injection(sessionID: string, name: string) {
    const current = turn[sessionID]
    if (!current) return
    current.injections.push(name)
  }

  export function finish(input: {
    sessionID: string
    phase: string
    action: string
    tools?: string[]
    tokens?: Entry["tokens"]
  }) {
    const current = turn[input.sessionID]
    const entry: Entry = {
      step: current?.step ?? 0,
      phase: input.phase,
      action: input.action,
      time: Date.now(),
      injections: current?.injections,
      tools: input.tools,
      tokens: input.tokens,
    }
    delete turn[input.sessionID]
    const list = entries[input.sessionID] ?? []
    list.push(entry)
    if (list.length > MAX) list.shift()
    entries[input.sessionID] = list
    if (Flag.HYSCIENCE_EXPERIMENTAL) void persist(input.sessionID, entry)
    return entry
  }

  export function list(sessionID: string) {
    return entries[sessionID] ?? []
  }

  export function summary(sessionID: string) {
    const entries = list(sessionID)
    const tokens = entries.reduce(
      (acc, entry) => {
        if (!entry.tokens) return acc
        acc.input += entry.tokens.input
        acc.output += entry.tokens.output
        acc.cache += entry.tokens.cache
        return acc
      },
      { input: 0, output: 0, cache: 0 },
    )
    return {
      turns: entries.length,
      tokens,
      last: entries.at(-1),
    }
  }

  async function persist(sessionID: string, entry: Entry) {
    const dir = path.join(Global.Path.data, "traces")
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, `${sessionID}.jsonl`), `${JSON.stringify(entry)}\n`)
  }
}
