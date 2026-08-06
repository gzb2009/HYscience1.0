import { TaskDecisionState } from "./task-decisions"
import { TaskScope } from "./task-scope"
import type { Session } from "."

export namespace DecisionGate {
  const readonly = new Set(["read", "list", "glob", "grep", "webfetch", "question", "todoread"])

  export function blocks(tool: string) {
    return !readonly.has(tool)
  }

  export async function assert(input: { session: Pick<Session.Info, "id" | "taskScope">; tool: string }) {
    if (!blocks(input.tool)) return
    const task = TaskScope.current(input.session.taskScope)
    if (!task) return
    const state = await TaskDecisionState.load(input.session.id, task.id)
    if (!TaskDecisionState.blocks(state)) return
    const decisions = state.decisions
      .filter((item) => item.status === "pending" || item.status === "recommended")
      .map((item) => item.id)
      .join(", ")
    throw new Error(
      `Execution blocked until the user confirms the pending strategy decision${decisions ? `: ${decisions}` : ""}. ` +
        "Read-only inspection and low-cost QC remain available.",
    )
  }
}
