import { RLMState } from "./rlm/state"
import type { ResearchContext } from "./research-context"
import { TaskDecisionState } from "./task-decisions"
import { MessageV2 } from "./message-v2"

export namespace SubtaskContext {
  export const limits = {
    branches: 4,
    packetChars: 6_000,
    resultChars: 2_800,
    totalChars: 12_000,
    constraints: 800,
    questions: 800,
    artifacts: 6,
  } as const

  const active = new Map<string, number>()

  function truncate(value: string, size: number) {
    const text = value.trim()
    return text.length <= size ? text : text.slice(0, Math.max(0, size - 1)).trimEnd() + "…"
  }

  function text(messages: MessageV2.WithParts[]) {
    return messages.flatMap((message) =>
      message.info.role === "user"
        ? message.parts
            .filter((part): part is MessageV2.TextPart => part.type === "text" && !MessageV2.isHybio(part))
            .map((part) => part.text.trim())
        : [],
    )
  }

  function artifacts(messages: MessageV2.WithParts[]) {
    return [
      ...new Set(
        messages.flatMap((message) =>
          message.info.role !== "user"
            ? []
            : message.parts.flatMap((part) => {
                if (part.type !== "file") return []
                if (part.source?.type === "resource") return [part.source.uri]
                if (part.source?.type === "file" || part.source?.type === "symbol") return [part.source.path]
                return part.filename ? [part.filename] : []
              }),
        ),
      ),
    ]
      .slice(0, limits.artifacts)
      .map((item) => truncate(item, 100))
  }

  function constraints(messages: MessageV2.WithParts[]) {
    const items = text(messages)
      .flatMap((value) => value.split(/\n+/))
      .filter((value) => /(?:必须|仅|只|不要|禁止|保留|忽略|must|only|do not|without)/i.test(value))
    return truncate(items.join("\n"), limits.constraints)
  }

  function questions(messages: MessageV2.WithParts[]) {
    const items = text(messages)
      .flatMap((value) => value.split(/\n+/))
      .filter((value) => /[？?]/.test(value))
    return truncate(items.join("\n"), limits.questions)
  }

  export function acquire(sessionID: string, taskID: string | undefined) {
    const key = `${sessionID}:${taskID ?? "unscoped"}`
    const count = active.get(key) ?? 0
    if (count >= limits.branches) {
      throw new Error(`Subtask branch budget reached (${limits.branches}) for the current task`)
    }
    active.set(key, count + 1)
    return () => {
      const next = (active.get(key) ?? 1) - 1
      if (next <= 0) {
        active.delete(key)
        return
      }
      active.set(key, next)
    }
  }

  export function packet(input: {
    taskID?: string
    description: string
    prompt: string
    entities: ResearchContext.Entities
    decisions: TaskDecisionState.State
    messages: MessageV2.WithParts[]
  }) {
    const value = [
      `<context-packet task_id="${input.taskID ?? "unscoped"}">`,
      "<assigned-task>",
      truncate(input.description, 200),
      truncate(input.prompt, 800),
      "</assigned-task>",
      "<locked-entities>",
      truncate(JSON.stringify(input.entities), 600),
      "</locked-entities>",
      truncate(TaskDecisionState.format(input.taskID ?? "unscoped", input.decisions), 1_200),
      "<user-constraints>",
      constraints(input.messages) || "None recorded.",
      "</user-constraints>",
      "<open-questions>",
      questions(input.messages) || "None recorded.",
      "</open-questions>",
      "<artifact-refs>",
      JSON.stringify(artifacts(input.messages)),
      "</artifact-refs>",
      `<budget packet_chars="${limits.packetChars}" result_chars="${limits.resultChars}" total_parallel_result_chars="${limits.totalChars}" max_parallel_branches="${limits.branches}" />`,
      "</context-packet>",
      "Use only this context packet and the assigned task. Do not request or infer parent conversation history, tool logs, or failed attempts.",
      "Return <rlm_result> with status, findings, failures, assumptions, parameters, artifact_refs, and suggestions. Keep the complete result within the stated result_chars budget.",
    ].join("\n")
    return truncate(value, limits.packetChars)
  }

  export function result(text: string) {
    const value = RLMState.parseExecutorOutput(text)
    const conclusion = truncate(value.findings.join("\n") || text, 600)
    const limitations = value.failures
      .concat(value.assumptions)
      .slice(0, 2)
      .map((item) => truncate(item, 120))
    const evidence = value.artifactRefs.slice(0, 3).map((item) => truncate(item, 60))
    const confidence = value.failures.length > 0 ? "low" : value.findings.length > 0 ? "medium" : "low"
    const output = [
      "<task_result>",
      `<status>${value.status}</status>`,
      `<conclusion>${JSON.stringify(conclusion)}</conclusion>`,
      `<evidence_refs>${JSON.stringify(evidence)}</evidence_refs>`,
      `<confidence>${confidence}</confidence>`,
      `<limitations>${JSON.stringify(limitations)}</limitations>`,
      `<artifact_refs>${JSON.stringify(evidence)}</artifact_refs>`,
      "</task_result>",
    ].join("\n")
    return output
  }
}
