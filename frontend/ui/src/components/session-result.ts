import type { AssistantMessage, Part as PartType, ToolPart } from "@hysci/sdk/v2/client"

export type ResultFile = {
  path: string
  name: string
  kind: "xlsx" | "csv" | "tsv" | "md" | "png" | "jpg" | "svg" | "pdf" | "json" | "code" | "other"
  role: "primary" | "supporting"
  mime?: string
  size?: number
  verified: boolean
  clusters?: number
  sheets?: number
}

export type ResultSection = {
  kind: "summary" | "analysis" | "findings" | "recommendations" | "caveat" | "deliverable" | "body"
  text: string
}

function resultKind(name: string): ResultFile["kind"] {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : ""
  if (ext === "xlsx" || ext === "xls") return "xlsx"
  if (ext === "csv") return "csv"
  if (ext === "tsv") return "tsv"
  if (ext === "md" || ext === "markdown") return "md"
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return "png"
  if (ext === "svg") return "svg"
  if (ext === "pdf") return "pdf"
  if (ext === "json" || ext === "jsonl") return "json"
  if (ext === "py" || ext === "r" || ext === "sh") return "code"
  return "other"
}

function resultRole(name: string, parentDir?: string): ResultFile["role"] {
  if (INTERNAL_NAME.test(name)) return "supporting"
  if (/_annotation\.xlsx?$/i.test(name)) return "primary"
  if (/^cluster_annotation/i.test(name)) return "primary"
  if (/figures?\//i.test(parentDir ?? "")) return "primary"
  if (/报告|report|template|模板|annotation|annot/i.test(name)) return "primary"
  return "supporting"
}

const RESULT_EXTS = /\.(xlsx|xls|csv|tsv|md|markdown|png|jpg|jpeg|webp|svg|gif|pdf|json|jsonl|py|r|sh|h5ad|rds)$/i

/** @deprecated Prefer collectTaskFileNames or collectRecentTurnFileNames */
export function collectSessionFileNames(input: {
  assistantMessages: { id: string }[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText: string
}): Set<string> {
  return collectResultFileNames(input)
}

/** Assistant messages belonging to the latest user turn (after the last user message). */
export function assistantMessagesForLastTurn(messages: { id: string; role: string }[]): { id: string }[] {
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) return []
  return messages.slice(lastUserIdx + 1).filter((message) => message.role === "assistant")
}

export function collectResultFileNames(input: {
  assistantMessages: { id: string }[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText: string
}): Set<string> {
  const names = collectInferredFileNamesFromTools(input)
  for (const file of collectResultFiles({
    assistantMessages: input.assistantMessages as AssistantMessage[],
    partsByMessage: input.partsByMessage,
    responseText: input.responseText,
  })) {
    for (const key of artifactPathKeys(file.path)) names.add(key)
    names.add(file.name)
  }
  return names
}

/** Fallback for sessions before verified artifact metadata existed. */
export function collectInferredFileNamesFromTools(input: {
  assistantMessages: { id: string }[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText?: string
}): Set<string> {
  const names = new Set<string>()
  const seenPath = new Set<string>()
  const add = (raw: string) => {
    const path = raw
      .replace(/^file:\/\//, "")
      .replace(/^["'`]+|["'`,;:.]+$/g, "")
      .trim()
    if (!path || path.includes("*") || path.includes("?")) return
    const name = path.split("/").pop() || path
    if (!RESULT_EXTS.test(name)) return
    if (path.includes("/.hyscience/") || path.includes("/.context/")) {
      if (!/annotation|result|report|figure/i.test(name)) return
    }
    if (seenPath.has(path)) return
    seenPath.add(path)
    names.add(name)
    for (const key of artifactPathKeys(path)) names.add(key)
  }
  for (const msg of input.assistantMessages) {
    const parts = input.partsByMessage[msg.id] ?? []
    for (const part of parts) {
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      const state = tool.state as { input?: { filePath?: string; command?: string }; output?: string } | undefined
      if (tool.tool === "write" || tool.tool === "edit") {
        if (state?.input?.filePath) add(state.input.filePath)
        continue
      }
      if (tool.tool !== "bash") continue
      const cmd = state?.input?.command ?? ""
      for (const m of cmd.matchAll(/(?:--output|-o)\s*(?:=\s*)?["']?([^\s"']+)["']?/gi)) add(m[1])
      const output = state?.output ?? ""
      for (const m of output.matchAll(/\.(?:savefig)\s*\(\s*["']([^"']+)["']/gi)) add(m[1])
      for (const m of output.matchAll(
        /\.to_(?:csv|excel|json|hdf|parquet|feather|stata|pickle)\s*\(\s*["']([^"']+)["']/gi,
      ))
        add(m[1])
      for (const m of cmd.matchAll(/open\(\s*["']([^"']+\.\w{2,6})["']\s*,/gi)) add(m[1])
      for (const m of cmd.matchAll(/(?:^|[|&;]\s*)(?:tee\s+|>>?\s*)(?:"([^"]+)"|'([^']+)'|(\S+\.\w+))/gi))
        add(m[1] || m[2] || m[3])
      for (const m of output.matchAll(
        /(?:wrote|saved|output|创建|生成|写入|输出)(?:\s+to)?\s+(?::\s*)?([^\s\n()]+?\.\w{2,6})(?=$|[\s.,;)\]])/gi,
      ))
        add(m[1])
    }
  }
  const fp =
    /(?:^|[\s\[(`"'、，。；：>\-])([^\s\]`"'()、，。；：\n<>]+?\.(?:xlsx|xls|csv|tsv|md|markdown|png|jpg|jpeg|webp|svg|gif|pdf|json|jsonl|py|r|sh|h5ad))(?:$|[\s\]`"'),.、，。；：\n<>])/gi
  for (const m of (input.responseText || "").matchAll(fp)) add(m[1])
  return names
}

export function artifactPathKeys(path: string): string[] {
  const raw = path.replace(/^file:\/\//, "").trim()
  const keys = new Set<string>()
  if (!raw) return []
  keys.add(raw)
  const base = raw.split("/").pop() || raw
  keys.add(base)
  if (raw.startsWith("result/")) keys.add(raw.slice("result/".length))
  const resultIdx = raw.indexOf("/result/")
  if (resultIdx >= 0) keys.add(raw.slice(resultIdx + "/result/".length))
  return [...keys]
}

export function artifactPathsMatch(left: string, right: string): boolean {
  const leftKeys = new Set(artifactPathKeys(left))
  for (const key of artifactPathKeys(right)) {
    if (leftKeys.has(key)) return true
  }
  return false
}

export function collectRecentTurnFileNames(input: {
  messages: { id: string; role: string }[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText?: string
}): Set<string> {
  return collectResultFileNames({
    assistantMessages: assistantMessagesForLastTurn(input.messages),
    partsByMessage: input.partsByMessage,
    responseText: input.responseText ?? "",
  })
}

export function collectTaskFileNames(input: {
  messages: { id: string; role: string }[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText?: string
}): Set<string> {
  return collectResultFileNames({
    assistantMessages: input.messages.filter((message) => message.role === "assistant"),
    partsByMessage: input.partsByMessage,
    responseText: input.responseText ?? "",
  })
}

export function collectResultFiles(input: {
  assistantMessages: AssistantMessage[]
  partsByMessage: Record<string, PartType[] | undefined>
  responseText: string
}): ResultFile[] {
  const seenPath = new Set<string>()
  const seenName = new Set<string>()
  const out: ResultFile[] = []
  const push = (raw: string, extra?: { parentDir?: string; mime?: string; size?: number }) => {
    let path = raw
      .replace(/^file:\/\//, "")
      .replace(/^["'`]+|["'`,;:.]+$/g, "")
      .trim()
    if (!path) return
    if (path.includes("*") || path.includes("?")) return
    const name = path.split("/").pop() || path
    if (!RESULT_EXTS.test(name)) return
    if (path.includes("/.hyscience/") || path.includes("/.context/")) {
      if (!/annotation|result|report|figure/i.test(name)) return
    }
    if (seenPath.has(path) || seenName.has(name.toLowerCase())) return
    seenPath.add(path)
    seenName.add(name.toLowerCase())
    const file: ResultFile = {
      path,
      name,
      kind: resultKind(name),
      role: resultRole(name, extra?.parentDir),
      mime: extra?.mime,
      size: extra?.size,
      verified: true,
    }
    out.push(file)
    return file
  }

  for (const msg of input.assistantMessages) {
    const parts = input.partsByMessage[msg.id] ?? []
    for (const part of parts) {
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      const state = tool.state as
        | {
            metadata?: {
              artifacts?: { path?: string; name?: string; mime?: string; size?: number; verified?: boolean }[]
            }
          }
        | undefined
      for (const artifact of state?.metadata?.artifacts ?? []) {
        if (!artifact.verified || !artifact.path) continue
        push(artifact.path, { mime: artifact.mime, size: artifact.size })
      }
    }
  }

  return out.sort((a, b) => Number(b.role === "primary") - Number(a.role === "primary"))
}

/** Normalize filename stem so `heatmap_v1.png` and `heatmap_v2.png` group together. */
export function artifactStemKey(name: string): string {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name
  return base
    .replace(/\s*\(\d+\)\s*$/i, "")
    .replace(/[-_ ]?(?:v|ver)?\d+$/i, "")
    .replace(/[-_]?(?:old|backup|bak|copy|final|new|draft|tmp|temp|retry|debug|test)$/i, "")
    .toLowerCase()
}

export function artifactVersionScore(name: string): number {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name
  const paren = base.match(/\((\d+)\)\s*$/i)
  if (paren) return Number(paren[1])
  const suffix = base.match(/[-_ ]?(?:v|ver)?(\d+)$/i)
  if (suffix) return Number(suffix[1])
  return 0
}

export function isIntermediateArtifact(name: string): boolean {
  if (/_(old|backup|bak|tmp|temp|draft|copy|retry|debug|test|checkpoint|log)\./i.test(name)) return true
  if (/^(debug|test|tmp|temp|retry|checkpoint|_script_manifest)/i.test(name)) return true
  if (/\.(log|tmp|bak|old)$/i.test(name)) return true
  return false
}

function pickLatestInGroup(files: ResultFile[]): ResultFile {
  return files.reduce((best, file) => {
    const score = artifactVersionScore(file.name)
    const bestScore = artifactVersionScore(best.name)
    if (score > bestScore) return file
    if (score < bestScore) return best
    if (file.role === "primary" && best.role !== "primary") return file
    return best
  })
}

export type OrganizedResults = {
  deliverables: ResultFile[]
  intermediate: ResultFile[]
  hiddenCount: number
}

/** Collapse iteration/version duplicates — BioMni-style "latest deliverable per artifact". */
export function organizeResultFiles(files: ResultFile[]): OrganizedResults {
  const groups = new Map<string, ResultFile[]>()
  for (const file of files) {
    const stem = artifactStemKey(file.name)
    const bucket = groups.get(stem) ?? []
    bucket.push(file)
    groups.set(stem, bucket)
  }

  const deliverables: ResultFile[] = []
  const intermediate: ResultFile[] = []
  let hiddenCount = 0

  for (const group of groups.values()) {
    const latest = pickLatestInGroup(group)
    const superseded = group.filter((file) => file.path !== latest.path)
    hiddenCount += superseded.length

    const intermediateLatest = isIntermediateArtifact(latest.name) && latest.role !== "primary"
    if (intermediateLatest) intermediate.push(latest)
    else deliverables.push(latest)

    for (const file of superseded) intermediate.push(file)
  }

  deliverables.sort(
    (a, b) => Number(b.role === "primary") - Number(a.role === "primary") || a.name.localeCompare(b.name),
  )
  intermediate.sort((a, b) => a.name.localeCompare(b.name))

  return { deliverables, intermediate, hiddenCount }
}

function fileBaseName(name: string): string {
  return name.split("/").pop() || name
}

function pickLatestFileNode<T extends { name: string }>(group: T[]): T {
  return group.reduce((best, node) => {
    const score = artifactVersionScore(fileBaseName(node.name))
    const bestScore = artifactVersionScore(fileBaseName(best.name))
    if (score > bestScore) return node
    return best
  })
}

/** Collapse version duplicates for disk artifact rows (Files grid). */
export function filterLatestFileNodes<T extends { name: string }>(
  nodes: T[],
): { deliverables: T[]; intermediate: T[]; hiddenCount: number } {
  const groups = new Map<string, T[]>()
  for (const node of nodes) {
    const stem = artifactStemKey(fileBaseName(node.name))
    const bucket = groups.get(stem) ?? []
    bucket.push(node)
    groups.set(stem, bucket)
  }

  const deliverables: T[] = []
  const intermediate: T[] = []
  let hiddenCount = 0

  for (const group of groups.values()) {
    const latest = pickLatestFileNode(group)
    const superseded = group.filter((node) => node !== latest)
    hiddenCount += superseded.length

    if (isIntermediateArtifact(fileBaseName(latest.name))) intermediate.push(latest)
    else deliverables.push(latest)

    intermediate.push(...superseded)
  }

  deliverables.sort((a, b) => fileBaseName(a.name).localeCompare(fileBaseName(b.name)))
  intermediate.sort((a, b) => fileBaseName(a.name).localeCompare(fileBaseName(b.name)))

  return { deliverables, intermediate, hiddenCount }
}

const INTERNAL_SECTION =
  /critique|methodology|literature.?(review|search)|reasoning|research.state|script.manifest|reviewer|compaction/i
const INTERNAL_NAME =
  /^(literature-review|reasoning|methodology|research-state)\.(md|markdown)$|^_script_manifest\.jsonl$/i
const DELIVERABLE_PREFIX =
  /^(?:模板已生成|已生成|文件已写入|已保存|已写入|已创建|wrote|saved|created|generated)\s*[:：]/i
const INLINE_SECTION =
  /(?:^|\s)(?:\*\*(Key Findings|Confidence|Caveat|Next Steps|关键发现|置信度|限制|建议|总结|Summary)\*\*|(?:Key Findings|Confidence|Caveat|Next Steps|关键发现|置信度与限制|限制|建议|总结|Summary)\s*:)/gi

const EVIDENCE_BADGE: Record<string, string> = {
  computed: "实测",
  database: "数据库",
  literature: "文献",
  hypothesis: "假设",
}

/** Soften evidence tags and internal markers for reading in the chat pane. */
export function formatResultMarkdown(text: string): string {
  return text
    .replace(/\[(computed|database|literature|hypothesis)\]/gi, (_, tag: string) => {
      const label = EVIDENCE_BADGE[tag.toLowerCase()] ?? tag
      return `\`${label}\``
    })
    .trim()
}

function sectionKind(title: string): ResultSection["kind"] {
  const value = title.trim().toLowerCase()
  if (INTERNAL_SECTION.test(value)) return "body"
  if (/^(总结|摘要|summary|tl;dr)/i.test(value)) return "summary"
  if (/^(分组分析|分组结果|分析结果|analysis|grouped analysis)/i.test(value)) return "analysis"
  if (/^(关键发现|发现|key findings?|findings?)/i.test(value)) return "findings"
  if (/^(confidence|置信度)/i.test(value)) return "caveat"
  if (/^(caveat|限制|注意事项|局限|置信度与限制)/i.test(value)) return "caveat"
  if (/^(建议|recommendations?|next steps?|下一步)/i.test(value)) return "recommendations"
  return "body"
}

function extractDeliverable(text: string) {
  const trimmed = text.trim()
  const match = trimmed.match(/^((?:模板已生成|已生成|文件已写入|已保存|已写入|已创建)[^。\n]*[。!！]?)\s*(.*)$/s)
  if (match?.[1] && DELIVERABLE_PREFIX.test(match[1])) {
    return { deliverable: match[1].trim(), rest: (match[2] ?? "").trim() }
  }
  if (DELIVERABLE_PREFIX.test(trimmed) && trimmed.length < 320) {
    return { deliverable: trimmed, rest: "" }
  }
  return { rest: trimmed }
}

function findSectionBreaks(text: string) {
  const breaks: { index: number; title: string }[] = []
  let offset = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    const h2 = trimmed.match(/^##\s+(.+?)\s*$/)
    const h3 = trimmed.match(/^###\s+(.+?)\s*$/)
    const bold = trimmed.match(/^\*\*(.+?)\*\*\s*$/)
    const label = trimmed.match(
      /^(Confidence|Caveat|Next Steps|Key Findings|关键发现|置信度与限制|置信度|限制|建议|总结|Summary)\s*:?\s*$/i,
    )
    const title = h2?.[1] ?? h3?.[1] ?? bold?.[1] ?? label?.[1]
    if (title) breaks.push({ index: offset, title })
    offset += line.length + 1
  }
  return breaks
}

function splitInlineSections(text: string): ResultSection[] {
  const parts = text.split(
    /\s*(?=(?:\*\*(?:Key Findings|Confidence|Caveat|Next Steps|关键发现|置信度|限制|建议|总结|Summary)\*\*|(?:^|\n)(?:Key Findings|Confidence|Caveat|Next Steps|关键发现|置信度与限制|限制|建议|总结|Summary)\s*:))/gi,
  )
  const sections: ResultSection[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const bold = trimmed.match(/^\*\*([^*]+)\*\*\s*([\s\S]*)$/)
    const label = trimmed.match(
      /^(Key Findings|Confidence|Caveat|Next Steps|关键发现|置信度与限制|置信度|限制|建议|总结|Summary)\s*:?\s*([\s\S]*)$/i,
    )
    const title = bold?.[1] ?? label?.[1]
    const body = (bold?.[2] ?? label?.[2] ?? trimmed).trim()
    if (title) sections.push({ kind: sectionKind(title), text: formatResultMarkdown(body || trimmed) })
    else sections.push({ kind: "body", text: formatResultMarkdown(trimmed) })
  }
  return sections
}

function stripLeadingHeading(text: string) {
  return text
    .replace(/^#{2,3}\s+[^\n]+\n?/m, "")
    .replace(/^\*\*[^*]+\*\*\s*\n?/m, "")
    .trim()
}

/** Give inferred sections a natural scientific heading without changing authored headings. */
export function formatSectionForDisplay(section: ResultSection): string {
  if (section.kind === "body" || section.kind === "deliverable") return section.text
  if (/^#{2,3}\s|^\*\*[^*]+\*\*\s*$/m.test(section.text)) return section.text

  const title = {
    summary: "摘要",
    analysis: "结果",
    findings: "关键结果",
    caveat: "证据与限制",
    recommendations: "下一步",
  }[section.kind]

  return `### ${title}\n\n${formatResultMarkdown(stripLeadingHeading(section.text))}`
}

function splitUnstructured(text: string): ResultSection[] {
  const { deliverable, rest } = extractDeliverable(text)
  const sections: ResultSection[] = []
  if (deliverable) sections.push({ kind: "deliverable", text: formatResultMarkdown(deliverable) })

  const tail = rest || (deliverable ? "" : text)
  if (!tail) return sections.length ? sections : [{ kind: "body", text: formatResultMarkdown(text) }]

  INLINE_SECTION.lastIndex = 0
  if (INLINE_SECTION.test(tail)) {
    sections.push(...splitInlineSections(tail))
    return sections
  }

  sections.push({ kind: deliverable ? "summary" : "body", text: formatResultMarkdown(tail) })
  return sections
}

export function splitResultSections(text: string): ResultSection[] {
  const input = text.trim()
  if (!input) return []

  const breaks = findSectionBreaks(input)
  if (!breaks.length) return splitUnstructured(input)

  const sections: ResultSection[] = []
  const prefix = input.slice(0, breaks[0].index).trim()
  if (prefix) sections.push(...splitUnstructured(prefix))

  for (let index = 0; index < breaks.length; index++) {
    const start = breaks[index].index
    const stop = breaks[index + 1]?.index ?? input.length
    const chunk = input.slice(start, stop).trim()
    sections.push({
      kind: sectionKind(breaks[index].title),
      text: formatResultMarkdown(chunk),
    })
  }

  return sections
}

export function hasStructuredResult(sections: ResultSection[], fileCount: number) {
  if (fileCount > 0) return true
  return sections.some((section) => section.kind !== "body")
}
