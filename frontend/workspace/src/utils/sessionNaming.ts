const GENERIC_TITLE_RE =
  /^(?:新子任务|新对话|新交流|new\s*chat|new\s*sub[\s-]?task|chat|draft|未命名|untitled|对话|项目|session)(?:[\s_-]*\d+|[\s_-]*[a-f0-9]{4,12})?$/i

const DEFAULT_TITLE_RE = /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const CHILD_DEFAULT_TITLE_RE = /^Child session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const TASK_SLUG_RULES: Array<[RegExp, string]> = [
  [/空间蛋白|spatial\s*protein|spatial\s*proteomic/i, "空间蛋白检测"],
  [/空间转录组|spatial\s*transcriptom|visium/i, "空间转录组"],
  [/热图|heatmap|clustermap/i, "热图分析"],
  [/火山图|volcano/i, "火山图"],
  [/\bumap\b/i, "UMAP 降维"],
  [/\btsne\b|t-?sne/i, "t-SNE 降维"],
  [/dot\s*plot|dotplot/i, "Dot plot"],
  [/violin/i, "小提琴图"],
  [/box\s*plot|boxplot/i, "箱线图"],
  [/scatter/i, "散点图"],
  [/bar\s*plot|barplot/i, "柱状图"],
  [/\bpca\b/i, "PCA 分析"],
  [/qc|质控|quality\s*control/i, "质控分析"],
  [/deg|差异表达|differential/i, "差异表达分析"],
  [/聚类|cluster|leiden|louvain/i, "聚类分析"],
  [/注释|annot|celltypist|cell\s*type/i, "细胞注释"],
  [/富集|pathway|gsea|enrich/i, "通路富集"],
  [/轨迹|trajectory|paga/i, "轨迹分析"],
  [/通讯|communication|cellphone/i, "细胞通讯"],
  [/空间|spatial/i, "空间组学分析"],
  [/scrna|单细胞|scanpy|h5ad|pbmc/i, "单细胞分析"],
  [/预处理|preprocess|normalize/i, "数据预处理"],
  [/随机数据|模拟数据|mock\s*data|hybio\s*data/i, "模拟数据"],
  [/上传|upload/i, "数据上传"],
]

export function summarizeTaskTitle(task: string, max = 56): string {
  let t = task.trim().replace(/\s+/g, " ")
  if (!t) return ""
  if (t.includes("在此基础上：")) {
    t = t.split("在此基础上：").pop()?.trim() || t
  }
  const parts = t
    .split(/[；;。]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const uniq: string[] = []
  for (const p of parts) {
    if (!uniq.includes(p)) uniq.push(p)
  }
  if (uniq.length === 1) t = uniq[0]
  else if (uniq.length > 1) t = uniq[uniq.length - 1]
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function stripMessageForTitle(text: string): string {
  let t = text.trim()
  t = t.replace(/^\[SubAgent\]\s*/i, "")
  t = t.replace(/^\[[^\]]+\]\s*/, "")
  t = t.replace(/^选择:\s*[^·]+(?:\s*·\s*)?/u, "")
  t = t.replace(/\n---[\s\S]*/m, "")
  return t.replace(/\s+/g, " ").trim()
}

function matchIntentLabel(text: string): string | null {
  for (const [pattern, label] of TASK_SLUG_RULES) {
    if (pattern.test(text)) return label
  }
  return null
}

function matchComparisonTitle(text: string): string | null {
  const match = text.match(
    /\b([a-z][a-z0-9-]{1,15})\s*(?:和|与|vs\.?|versus)\s*([a-z][a-z0-9-]{1,15})\b.*(?:区别|差异|对比|比较|选择)/i,
  )
  if (!match) return null
  return `${match[1].toUpperCase()} 与 ${match[2].toUpperCase()} 对比`
}

export function isDefaultSessionTitle(title: string | undefined | null): boolean {
  const t = (title ?? "").trim()
  if (!t) return true
  return DEFAULT_TITLE_RE.test(t) || CHILD_DEFAULT_TITLE_RE.test(t)
}

export function isGenericSessionTitle(title: string | undefined | null): boolean {
  const t = (title ?? "").trim()
  if (!t) return true
  if (isDefaultSessionTitle(t)) return true
  if (GENERIC_TITLE_RE.test(t)) return true
  if (/^chat[\s_-]*\d*$/i.test(t)) return true
  if (/^新子任务[\s_-]*\d*$/i.test(t)) return true
  return false
}

/** Sidebar-visible title from the user's first message / intent. */
export function deriveSessionTitleFromMessage(text: string): string {
  const raw = stripMessageForTitle(text)
  if (!raw) return "新子任务"

  const comparisonTitle = matchComparisonTitle(raw)
  if (comparisonTitle) return comparisonTitle

  const intentLabel = matchIntentLabel(raw)
  if (intentLabel) return intentLabel

  if (/[\u4e00-\u9fff]/.test(raw)) {
    const summary = summarizeTaskTitle(raw, 36)
    if (summary && !isGenericSessionTitle(summary)) return summary
  }

  const summary = summarizeTaskTitle(raw, 36)
  if (summary && summary.length >= 4 && !isGenericSessionTitle(summary)) {
    return summary
  }

  const tokens = raw.match(/[a-zA-Z][a-zA-Z0-9_-]{0,31}/g)
  if (tokens?.length) {
    return tokens.slice(0, 4).join(" ").replace(/_/g, " ")
  }

  return summary || "新子任务"
}

export function makeUniqueSessionTitle(title: string, existing: Iterable<string | null | undefined>): string {
  const normalized = (value: string) => value.trim().toLocaleLowerCase()
  const used = new Set(
    [...existing]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value)
      .map(normalized),
  )
  if (!used.has(normalized(title))) return title

  for (const index of Array.from({ length: 999 }, (_, offset) => offset + 2)) {
    const candidate = `${title}（${index}）`
    if (!used.has(normalized(candidate))) return candidate
  }

  return `${title}（${Date.now()}）`
}
