import z from "zod"
import { Identifier } from "@/id/id"
import { MessageV2 } from "./message-v2"

export namespace TaskScope {
  export const Info = z.object({
    id: z.string(),
    messageID: Identifier.schema("message"),
    status: z.enum(["active", "archived"]),
    summary: z.string().optional(),
    mergedScopeIDs: z.string().array().optional(),
    time: z.object({
      created: z.number(),
      archived: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const State = z.object({
    currentID: z.string(),
    items: Info.array(),
  })
  export type State = z.infer<typeof State>

  const explicit =
    /(?:^|[\s:：])(?:\/new-task|\/clear-context|new task|新任务|开始新任务|忽略上一任务上下文|清除上下文)(?=$|[\s:：])/i
  const correction = /(纠正|更正|不是.+而是|actually|correction|i meant)/i
  const dimensions: Array<[string, RegExp]> = [
    ["species", /\b(human|mouse|rat|zebrafish|pig|monkey|macaque)\b|小鼠|大鼠|人|斑马鱼|猪|猴/i],
    [
      "omics",
      /\b(single-cell|scRNA|snRNA|spatial|proteom|metabolom|TCR|multi-omics)\b|单细胞|空间|蛋白组|代谢组|免疫组|多组学/i,
    ],
    [
      "domain",
      /\b(physics|chemistry|machine learning|software|coding|legal|finance)\b|物理|化学|机器学习|编程|法律|金融/i,
    ],
  ]

  export function create(messageID: string): State {
    const item: Info = {
      id: `task_${Identifier.ascending("message")}`,
      messageID,
      status: "active",
      time: { created: Date.now() },
    }
    return { currentID: item.id, items: [item] }
  }

  function text(message: MessageV2.WithParts) {
    return message.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && !MessageV2.isHybio(part))
      .map((part) => part.text)
      .join(" ")
  }

  function tags(value: string) {
    return new Set(
      dimensions.flatMap(([name, pattern]) => {
        const match = value.match(pattern)?.[0]?.toLowerCase()
        return match ? [`${name}:${match}`] : []
      }),
    )
  }

  export function shouldStart(previous: string, current: string, requested = false) {
    if (requested || explicit.test(current)) return true
    if (correction.test(current)) return false
    const old = tags(previous)
    const next = tags(current)
    const changed = [...next].filter((item) => !old.has(item))
    return next.size >= 2 && changed.length >= 2
  }

  export function resolve(
    state: State | undefined,
    messages: MessageV2.WithParts[],
    message: MessageV2.WithParts,
    requested = false,
    mergePrevious = false,
  ): State {
    if (!state) return create(message.info.id)
    const current = state.items.find((item) => item.id === state.currentID)
    if (!current) return create(message.info.id)
    const currentMessages = messages.filter((item) => item.info.id >= current.messageID)
    const history = currentMessages.slice(0, -1).map(text).join("\n")
    if (!shouldStart(history, text(message), requested)) return state
    const next: Info = {
      id: `task_${Identifier.ascending("message")}`,
      messageID: message.info.id,
      status: "active",
      mergedScopeIDs: mergePrevious ? [current.id] : undefined,
      time: { created: Date.now() },
    }
    return {
      currentID: next.id,
      items: state.items
        .map((item) =>
          item.id === current.id
            ? {
                ...item,
                status: "archived" as const,
                summary: history.trim().slice(0, 500) || undefined,
                time: { ...item.time, archived: Date.now() },
              }
            : item,
        )
        .concat(next),
    }
  }

  export function current(state: State | undefined) {
    return state?.items.find((item) => item.id === state.currentID)
  }

  export function messages(messages: MessageV2.WithParts[], state: State | undefined) {
    const scope = current(state)
    if (!scope) return messages
    const index = messages.findIndex((message) => message.info.id === scope.messageID)
    if (index < 0) return messages
    return messages.slice(index)
  }

  export function context(state: State | undefined) {
    const scope = current(state)
    if (!scope) return ""
    const merged = state?.items.filter((item) => scope.mergedScopeIDs?.includes(item.id)) ?? []
    return [
      `<task-scope id="${scope.id}">`,
      "Use only the current task's conversation history and research entities.",
      ...(merged.length === 0
        ? []
        : [
            "<merged-task-summaries>",
            ...merged.map((item) => `- ${item.id}: ${item.summary || "No archived summary available."}`),
            "</merged-task-summaries>",
            "These are user-approved reference-only summaries. Do not inherit their entities, constraints, failures, or outputs.",
          ]),
      "Other task scopes and sibling subtasks are withheld. Cross-task context enters only through an explicit user merge.",
      "</task-scope>",
    ].join("\n")
  }
}
