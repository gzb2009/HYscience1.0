import { expect, test } from "bun:test"
import { runningSessionCount } from "./project-session-status"

test("统计忙碌和重试中的项目会话", () => {
  const count = runningSessionCount([{ id: "busy" }, { id: "retry" }, { id: "idle" }], {
    busy: { type: "busy" },
    retry: { type: "retry" },
    idle: { type: "idle" },
  })

  expect(count).toBe(2)
})

test("未知状态不会显示为运行中", () => {
  expect(runningSessionCount([{ id: "missing" }, { id: "idle" }], { idle: { type: "idle" } })).toBe(0)
})
