import { describe, expect, test } from "bun:test"
import { TaskScope } from "../../src/session/task-scope"
import { MessageV2 } from "../../src/session/message-v2"

function message(id: string, text: string): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role: "user",
      time: { created: Date.now() },
    },
    parts: [{ id: `${id}-part`, messageID: id, sessionID: "ses_test", type: "text", text }],
  } as MessageV2.WithParts
}

describe("task scope", () => {
  test("keeps correction in the current scope", () => {
    expect(TaskScope.shouldStart("小鼠单细胞肺组织分析", "纠正一下，是人肺单细胞数据")).toBe(false)
  })

  test("starts a new scope for an explicit request", () => {
    const first = message("msg_1", "小鼠肺 scRNA 分析")
    const next = message("msg_2", "新任务：比较蛋白组与代谢组")
    const state = TaskScope.resolve(TaskScope.create(first.info.id), [first, next], next)
    expect(state.items).toHaveLength(2)
    expect(TaskScope.current(state)?.messageID).toBe(next.info.id)
    expect(TaskScope.messages([first, next], state)).toEqual([next])
  })

  test("requires multiple new dimensions for automatic transition", () => {
    expect(TaskScope.shouldStart("小鼠肺 scRNA 分析", "人空间转录组分析")).toBe(true)
    expect(TaskScope.shouldStart("小鼠肺 scRNA 分析", "人样本分析")).toBe(false)
  })

  test("withholds old messages unless the user explicitly merges the prior scope", () => {
    const first = message("msg_1", "小鼠肺 scRNA 分析")
    const next = message("msg_2", "新任务：分析人肝蛋白组")
    const state = TaskScope.resolve(TaskScope.create(first.info.id), [first, next], next)

    expect(TaskScope.messages([first, next], state)).toEqual([next])
    expect(TaskScope.context(state)).not.toContain("小鼠肺")
    expect(TaskScope.context(state)).toContain("Cross-task context enters only through an explicit user merge")

    const merged = TaskScope.resolve(TaskScope.create(first.info.id), [first, next], next, true, true)
    expect(TaskScope.context(merged)).toContain("小鼠肺 scRNA 分析")
    expect(TaskScope.context(merged)).toContain("Do not inherit their entities, constraints, failures, or outputs")
  })
})
