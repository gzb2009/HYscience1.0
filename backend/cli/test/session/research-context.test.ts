import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { ResearchContext } from "../../src/session/research-context"

const project = path.join(__dirname, "../..")

describe("research context", () => {
  test("partitions entities by task scope", async () => {
    const sessionID = `scope-${Date.now()}`
    await Instance.provide({
      directory: project,
      fn: async () => {
        await ResearchContext.update(sessionID, "task-a", "小鼠肺单细胞转录组细胞图谱")
        await ResearchContext.update(sessionID, "task-b", "人肝脏蛋白组差异分析")

        const first = await ResearchContext.loadState(sessionID, "task-a")
        const second = await ResearchContext.loadState(sessionID, "task-b")
        expect(first.constraints.species).toBe("mouse")
        expect(first.constraints.tissue).toBe("lung")
        expect(second.constraints.species).toBe("human")
        expect(second.constraints.tissue).toBe("liver")
        expect(first.hypotheses).toEqual({})
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `ctx-${sessionID}-task-a.json`))
    await fs.rm(path.join(project, ".hyscience", "memory", `ctx-${sessionID}-task-b.json`))
  })

  test("forgets scRNA execution memory after off-theme drift", async () => {
    const sessionID = `forget-${Date.now()}`
    await Instance.provide({
      directory: project,
      fn: async () => {
        await ResearchContext.update(sessionID, "task-a", "小鼠肺 10x 单细胞转录组细胞图谱")
        const before = await ResearchContext.load(sessionID, "task-a")
        expect(before.omicsTypes.includes("scRNA")).toBe(true)
        const after = await ResearchContext.forget(sessionID, "task-a", "single-cell")
        expect(after.omicsTypes.includes("scRNA")).toBe(false)
        expect(after.platform).toBeUndefined()
        expect(after.researchAim).toBeUndefined()
      },
    })
    await fs.rm(path.join(project, ".hyscience", "memory", `ctx-${sessionID}-task-a.json`))
  })
})
