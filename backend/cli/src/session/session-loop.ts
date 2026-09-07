import type { MessageV2 } from "./message-v2"
import type { SessionStatus } from "./status"

export namespace SessionLoop {
  export type Phase = "processing" | "subtask" | "compacting" | "pruning" | "finalizing"

  export type Action =
    | { type: "run-subtask"; task: MessageV2.SubtaskPart }
    | { type: "run-compaction"; task: MessageV2.CompactionPart }
    | { type: "prune" }
    | { type: "schedule-compaction" }
    | { type: "process" }
    | { type: "halt"; reason: "compaction-max" }

  export function resolve(input: {
    task?: MessageV2.CompactionPart | MessageV2.SubtaskPart
    shouldPrune: boolean
    shouldCompact: boolean
    compactionAttempts: number
  }) {
    if (input.task?.type === "subtask") {
      return { phase: "subtask" as const, action: { type: "run-subtask" as const, task: input.task } }
    }

    if (input.task?.type === "compaction") {
      return { phase: "compacting" as const, action: { type: "run-compaction" as const, task: input.task } }
    }

    if (input.shouldPrune) return { phase: "pruning" as const, action: { type: "prune" as const } }

    if (input.shouldCompact) {
      if (input.compactionAttempts >= 3) {
        return { phase: "processing" as const, action: { type: "halt" as const, reason: "compaction-max" as const } }
      }
      return { phase: "compacting" as const, action: { type: "schedule-compaction" as const } }
    }

    return { phase: "processing" as const, action: { type: "process" as const } }
  }

  export function busy(phase: Phase, step: number): SessionStatus.Info {
    return { type: "busy", phase, step }
  }

  export function actionName(action: Action) {
    if (action.type === "run-subtask") return "run-subtask"
    if (action.type === "run-compaction") return "run-compaction"
    if (action.type === "halt") return `halt:${action.reason}`
    return action.type
  }
}
