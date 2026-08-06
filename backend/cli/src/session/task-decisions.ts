import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"

export namespace TaskDecisionState {
  export type Status = "pending" | "chosen" | "recommended"
  const locks = new Map<string, Promise<void>>()

  export interface Decision {
    id: string
    status: Status
    recommendation?: string
    choice?: string
    reason?: string
    options?: string[]
    time: number
  }

  export interface State {
    version: 1
    decisions: Decision[]
    constraints: string[]
    locale?: string
    updatedAt: number
  }

  function filepath(sessionID: string, taskID: string) {
    return path.join(Instance.directory, ".hyscience", "memory", `decisions-${sessionID}-${taskID}.json`)
  }

  function empty(): State {
    return { version: 1, decisions: [], constraints: [], updatedAt: 0 }
  }

  function normalize(value: Partial<State>): State {
    return {
      version: 1,
      decisions: Array.isArray(value.decisions) ? value.decisions : [],
      constraints: Array.isArray(value.constraints) ? value.constraints : [],
      locale: typeof value.locale === "string" ? value.locale : undefined,
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    }
  }

  export async function load(sessionID: string, taskID: string): Promise<State> {
    try {
      return normalize(JSON.parse(await fs.readFile(filepath(sessionID, taskID), "utf8")) as Partial<State>)
    } catch {
      return empty()
    }
  }

  export async function save(sessionID: string, taskID: string, value: Omit<State, "version" | "updatedAt">) {
    const state: State = {
      version: 1,
      decisions: value.decisions,
      constraints: value.constraints,
      locale: value.locale,
      updatedAt: Date.now(),
    }
    const file = filepath(sessionID, taskID)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(state, null, 2))
    return state
  }

  export async function update(sessionID: string, taskID: string, fn: (state: State) => State) {
    const key = `${sessionID}:${taskID}`
    const previous = locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    locks.set(key, queued)
    await previous
    try {
      return await save(sessionID, taskID, fn(await load(sessionID, taskID)))
    } finally {
      release()
      if (locks.get(key) === queued) locks.delete(key)
    }
  }

  export async function setDecision(
    sessionID: string,
    taskID: string,
    input: Omit<Decision, "time"> & { time?: number },
  ) {
    return update(sessionID, taskID, (state) => {
      const decision = { ...input, time: input.time ?? Date.now() }
      const index = state.decisions.findIndex((item) => item.id === input.id)
      const decisions = index === -1 ? [...state.decisions, decision] : state.decisions.with(index, decision)
      return { ...state, decisions }
    })
  }

  export function blocks(state: State) {
    return state.decisions.some((item) => item.status === "pending" || item.status === "recommended")
  }

  export async function setLocale(sessionID: string, taskID: string, locale: string) {
    const state = await load(sessionID, taskID)
    return save(sessionID, taskID, { ...state, locale })
  }

  export function format(taskID: string, state: State, merged = false) {
    const chosen = state.decisions.filter((item) => item.status === "chosen")
    const recommended = state.decisions.filter((item) => item.status === "recommended")
    const pending = state.decisions.filter((item) => item.status === "pending")
    const entry = (item: Decision) =>
      `- ${item.id}: ${item.choice ?? item.recommendation ?? "unselected"}${item.reason ? ` (${item.reason})` : ""}`
    return [
      `<task-decisions task_id="${taskID}"${merged ? ' source="merged-reference"' : ""}>`,
      `locale=${state.locale ?? "unspecified"}`,
      "<runtime-constraints>",
      ...(state.constraints.length > 0 ? state.constraints.map((item) => `- ${item}`) : ["- None recorded."]),
      "</runtime-constraints>",
      "<chosen-decisions>",
      ...(chosen.length > 0 ? chosen.map(entry) : ["- None chosen."]),
      "</chosen-decisions>",
      "<recommended-decisions>",
      ...(recommended.length > 0 ? recommended.map(entry) : ["- None recorded."]),
      "</recommended-decisions>",
      "<open-decisions>",
      ...(pending.length > 0 ? pending.map(entry) : ["- None pending."]),
      "</open-decisions>",
      "Open and recommended decisions are state only, not verified findings or completed work.",
      "</task-decisions>",
    ].join("\n")
  }
}
