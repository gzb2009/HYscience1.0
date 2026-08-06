/**
 * Analysis Tracker — 跟踪当前会话中已完成的分析步骤，防止 Agent 重复计算。
 *
 * 每个分析步骤记录：输入文件 → 操作 → 输出文件 → 结果摘要。
 * Agent 可以查询 `completed()` 来判断某步骤是否已执行。
 */

export namespace AnalysisTracker {
  /**
   * 单个分析步骤
   */
  export interface Step {
    /** 步骤编号（自动递增） */
    id: number
    /** 步骤名称（如 "QC", "clustering", "deg"） */
    operation: string
    /** 操作描述（中文，给用户看） */
    description: string
    /** 输入文件路径 */
    input: string[]
    /** 输出文件路径 */
    output: string[]
    /** 结果摘要 */
    summary: string
    /** 时间戳 */
    timestamp: number
  }

  /**
   * 会话分析状态
   */
  export interface State {
    steps: Step[]
    /** 当前工作数据文件路径（最新的 .h5ad / .tiff 等） */
    activeData: string | null
    /** 已加载的 skill 列表 */
    loadedSkills: string[]
  }

  let state: State = {
    steps: [],
    activeData: null,
    loadedSkills: [],
  }

  /**
   * 记录一个新的分析步骤
   */
  export function record(step: Omit<Step, "id" | "timestamp">): Step {
    const s: Step = {
      ...step,
      id: state.steps.length + 1,
      timestamp: Date.now(),
    }
    state.steps.push(s)

    // 更新活跃数据文件
    if (step.output.length > 0) {
      const lastOutput = step.output[step.output.length - 1]
      if (lastOutput.endsWith(".h5ad") || lastOutput.endsWith(".tiff") || lastOutput.endsWith(".tif")) {
        state.activeData = lastOutput
      }
    }

    return s
  }

  /**
   * 检查某个操作是否已完成
   */
  export function completed(operation: string): boolean {
    return state.steps.some((s) => s.operation === operation)
  }

  /**
   * 检查某个操作是否已完成（基于输出文件）
   */
  export function hasOutput(file: string): boolean {
    return state.steps.some((s) => s.output.includes(file))
  }

  /**
   * 获取当前活跃数据文件
   */
  export function active(): string | null {
    return state.activeData
  }

  /**
   * 获取所有已完成步骤
   */
  export function all(): Step[] {
    return [...state.steps]
  }

  /**
   * 获取最后一步
   */
  export function last(): Step | undefined {
    return state.steps[state.steps.length - 1]
  }

  /**
   * 记录已加载的 skill
   */
  export function skillLoaded(name: string) {
    if (!state.loadedSkills.includes(name)) {
      state.loadedSkills.push(name)
    }
  }

  /**
   * 检查 skill 是否已加载
   */
  export function isSkillLoaded(name: string): boolean {
    return state.loadedSkills.includes(name)
  }

  /**
   * 生成分析步骤摘要（给 Agent 注入 system prompt）
   */
  export function summarize(): string {
    if (state.steps.length === 0) return ""

    const lines: string[] = ["## 已完成的分析步骤"]
    for (const s of state.steps) {
      lines.push(`${s.id}. **${s.operation}**: ${s.description} → 输出 ${s.output.join(", ") || "无文件"}`)
    }
    if (state.activeData) {
      lines.push(`\n当前活跃数据: \`${state.activeData}\``)
    }
    return lines.join("\n")
  }

  /**
   * 清空状态（新会话时调用）
   */
  export function reset() {
    state = {
      steps: [],
      activeData: null,
      loadedSkills: [],
    }
  }
}
