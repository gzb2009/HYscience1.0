import { expect, test } from "bun:test"
import { startsTask, taskControls } from "./task-control"

test("任务控制将下一条消息标记为新任务", () => {
  for (const control of taskControls) {
    expect(startsTask(control.id)).toBe(true)
  }
})

test("未选择任务控制时沿用当前任务", () => {
  expect(startsTask(undefined)).toBe(false)
})
