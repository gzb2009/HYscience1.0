export const taskControls = [
  {
    id: "new",
    label: "新任务（保留会话）",
    description: "下一条消息会创建新任务，但保留在当前会话中。",
  },
  {
    id: "from-here",
    label: "从此处开始新任务",
    description: "将当前输入作为新任务的第一条消息。",
  },
  {
    id: "ignore-context",
    label: "忽略上一任务上下文",
    description: "下一条消息创建隔离任务，不合并上一任务信息。",
  },
  {
    id: "clear-context",
    label: "清除上下文",
    description: "下一条消息创建完全隔离的新任务，不继承任何上一任务上下文或摘要。",
  },
  {
    id: "merge-previous",
    label: "合并上一任务摘要",
    description: "下一条消息创建新任务，并仅合并上一任务的摘要；不会继承实体、失败记录或完整输出。",
  },
] as const

export type TaskControl = (typeof taskControls)[number]["id"]

export function startsTask(control: TaskControl | undefined) {
  return control !== undefined
}

export function mergesContext(control: TaskControl | undefined) {
  return control === "merge-previous"
}
