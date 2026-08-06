/**
 * Coordinator — 任务拆分 + 多 Agent 并行调度
 *
 * 接收用户复杂请求 → LLM 拆分任务 → 并行分派 sub-agent → 汇总结果。
 * 与 agent-router 互补：router 负责意图分类，coordinator 负责任务编排。
 */

import { AgentRouter } from "./agent-router"

export namespace Coordinator {
  export type Role = "coordinator" | "expert" | "reviewer"

  export interface Subtask {
    id: string
    description: string
    agent: string
    role: Role
    dependencies: string[] // subtask ids this depends on
    priority: number // 1=highest
  }

  export interface Plan {
    subtasks: Subtask[]
    reasoning: string
  }

  /**
   * Regex-based task decomposition. For complex requests (100+ chars, multiple
   * question marks or numbered items), split into subtasks.
   * Full LLM-driven decomposition would use a cheap model; regex is the fast path.
   */
  export function decompose(text: string): Plan {
    const subtasks: Subtask[] = []

    const review = () => {
      if (subtasks.length < 2) return
      const dependencies = subtasks.map((task) => task.id)
      subtasks.push({
        id: `subtask-${subtasks.length + 1}`,
        description:
          "Audit the named expert outputs for citations, computations, and code-to-figure consistency. Do not repeat execution.",
        agent: "critique",
        role: "reviewer",
        dependencies,
        priority: subtasks.length + 1,
      })
    }

    // Detect multi-part questions: numbered items, multiple ?, "and also", "additionally"
    const numberedItems = text.match(/(?:^|\n)\s*(?:\d+[.)]\s*|[-*]\s+)([^\n]+)/g)
    if (numberedItems && numberedItems.length >= 2) {
      for (let i = 0; i < numberedItems.length; i++) {
        const item = numberedItems[i].replace(/^\s*(?:\d+[.)]\s*|[-*]\s+)/, "").trim()
        if (item.length < 10) continue
        const rec = AgentRouter.recommend({ current: "research", text: item })
        subtasks.push({
          id: `subtask-${i + 1}`,
          description: item,
          agent: rec.agent,
          role: "expert",
          dependencies: [],
          priority: i + 1,
        })
      }
      review()
      return { subtasks, reasoning: `Decomposed into ${subtasks.length} subtasks from numbered list` }
    }

    // Detect "A and B" pattern for two distinct domains
    const domains: Array<{ pattern: RegExp; agent: string }> = [
      { pattern: /\b(?:分析|数据|统计|bioinfo|genomic|RNA|seq|cell|cluster)\b/i, agent: "biology" },
      { pattern: /\b(?:文献|paper|literature|review|summarize|find.*paper)\b/i, agent: "research" },
      { pattern: /\b(?:train|model|ML|machine.learning|deep.learning|neural)\b/i, agent: "ml" },
    ]

    const matched = domains.filter((d) => d.pattern.test(text)).map((d) => d.agent)
    const unique = [...new Set(matched)]
    if (unique.length >= 2) {
      for (let i = 0; i < unique.length; i++) {
        subtasks.push({
          id: `subtask-${i + 1}`,
          description: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
          agent: unique[i],
          role: "expert",
          dependencies: [],
          priority: i + 1,
        })
      }
      review()
      return {
        subtasks,
        reasoning: `Decomposed into ${subtasks.length} domain-specific subtasks: ${unique.join(", ")}`,
      }
    }

    // Single task, no decomposition needed
    const rec = AgentRouter.recommend({ current: "research", text })
    return {
      subtasks: [
        { id: "subtask-1", description: text, agent: rec.agent, role: "expert", dependencies: [], priority: 1 },
      ],
      reasoning: "Single task — no decomposition needed",
    }
  }

  /** Format coordination plan as hybio injection for the agent. */
  export function formatPlan(plan: Plan): string {
    if (plan.subtasks.length <= 1) return ""
    const lines = [
      "<coordinator-plan>",
      `## 任务拆分为 ${plan.subtasks.length} 个子任务`,
      plan.reasoning,
      "",
      "| # | 角色 | 子任务 | Agent | 依赖 |",
      "|---|------|--------|-------|------|",
      ...plan.subtasks.map(
        (s) =>
          `| ${s.id.split("-")[1]} | ${s.role} | ${s.description.slice(0, 60)}... | ${s.agent} | ${s.dependencies.length > 0 ? s.dependencies.join(", ") : "无"} |`,
      ),
      "",
      "执行策略：",
      "- coordinator 负责委派与汇总；expert 子任务可在无依赖时并行执行（使用 Task 工具）",
      "- reviewer 必须在所有 dependencies 的 <task_result> 可引用后执行；只接收这些结构化结果，不接收专家分支的完整对话历史",
      "- reviewer 只核查引用、计算和代码-图表一致性，不重复执行",
      "- reviewer 的阻断性发现必须在最终汇总前解决或明确标注",
      "</coordinator-plan>",
    ]
    return lines.join("\n")
  }
}
