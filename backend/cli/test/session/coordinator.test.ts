import { describe, expect, test } from "bun:test"
import { Coordinator } from "../../src/session/coordinator"

describe("Coordinator", () => {
  test("adds a reviewer after parallel expert tasks", () => {
    const plan = Coordinator.decompose(
      [
        "1. Analyze the single-cell RNA-seq dataset and report cell populations.",
        "2. Train a classifier using the resulting features and compare metrics.",
      ].join("\n"),
    )

    expect(plan.subtasks).toHaveLength(3)
    expect(plan.subtasks.slice(0, 2).every((task) => task.role === "expert")).toBe(true)

    const review = plan.subtasks[2]
    expect(review).toMatchObject({
      agent: "critique",
      role: "reviewer",
      dependencies: ["subtask-1", "subtask-2"],
    })
  })

  test("does not add a reviewer to a single expert task", () => {
    const plan = Coordinator.decompose(
      "Analyze this single-cell RNA-seq dataset and report its quality-control results.",
    )

    expect(plan.subtasks).toHaveLength(1)
    expect(plan.subtasks[0].role).toBe("expert")
  })

  test("formats the role boundary and review dependency", () => {
    const plan = Coordinator.decompose(
      [
        "1. Analyze the single-cell RNA-seq dataset and report cell populations.",
        "2. Train a classifier using the resulting features and compare metrics.",
      ].join("\n"),
    )
    const text = Coordinator.formatPlan(plan)

    expect(text).toContain("| # | 角色 |")
    expect(text).toContain("| 3 | reviewer |")
    expect(text).toContain("subtask-1, subtask-2")
    expect(text).toContain("dependencies 的 <task_result>")
    expect(text).toContain("完整对话历史")
    expect(text).toContain("不重复执行")
  })
})
