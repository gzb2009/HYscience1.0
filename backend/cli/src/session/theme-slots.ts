import { Identifier } from "../id/id"
import { isBiologyTheme, type BiologyTheme } from "@hysci/util/themes"
import { AIM, TISSUE } from "./biology-lexicon"
import type { AgentRouter } from "./agent-router"
import type { MessageV2 } from "./message-v2"
import type { ReviewRecord } from "./review-record"

/**
 * Machine-readable Ask / Data / Check slots for biology themes.
 * Profile .txt files stay human-readable; this module is the runtime source.
 */
export namespace ThemeSlots {
  export type When = "design" | "compute"
  export type Kind = When | "other"

  export type Ask = {
    id: string
    when: When[]
    question: string
    options: { label: string; description: string }[]
    closed: (blob: string) => boolean
  }

  export type Spec = { theme: BiologyTheme; ask: Ask[]; extra: RegExp }

  const DESIGN = /设计|方案|panel|面板|marker list|实验设计|study design|experiment design/i
  const COMPUTE = /分析|注释|聚类|跑|分割|质控|变异|deconvolv|annotate|cluster|segment|align/i
  const KEY = "theme-slots"

  const SPECIES = /\b(human|mouse|rat|zebrafish|pig|monkey|macaque)\b|人|小鼠|大鼠|斑马鱼|猪|猴/i

  const SPECS: Record<Exclude<BiologyTheme, never>, Spec> = {
    imc: {
      theme: "imc",
      extra: /\.(mcd|ome\.tiff?|tiff?)$/i,
      ask: [
        {
          id: "tissue",
          when: ["design"],
          question: "组织 / 癌种是什么？",
          options: [
            { label: "胃癌", description: "胃腺癌 / 胃组织" },
            { label: "前列腺癌", description: "前列腺肿瘤或癌旁" },
            { label: "乳腺癌", description: "乳腺肿瘤" },
            { label: "其他，我补充", description: "在输入框写具体组织或癌种" },
          ],
          closed: (blob) => TISSUE.test(blob),
        },
        {
          id: "FFPE",
          when: ["design"],
          question: "样本是 FFPE 还是冰冻？",
          options: [
            { label: "FFPE", description: "石蜡包埋，部分表位需验证" },
            { label: "冰冻", description: "新鲜冰冻 / OCT" },
          ],
          closed: (blob) => /FFPE|石蜡|冰冻|frozen|fresh.?frozen|OCT/i.test(blob),
        },
        {
          id: "panel size",
          when: ["design"],
          question: "面板规模（通道 / plex）？",
          options: [
            { label: "约 40", description: "标准 IMC 通道预算" },
            { label: "约 50–60", description: "高plex，需更紧的同位素规划" },
            { label: "我指定数量", description: "在输入框写具体通道数" },
          ],
          closed: (blob) =>
            /(?:panel|面板|plex|通道).{0,8}\d{2,3}|\d{2,3}\s*(?:plex|通道|个(?:marker|指标|通道|抗体))/i.test(blob),
        },
        {
          id: "scientific aim",
          when: ["design"],
          question: "这张面板主要要分辨哪些群体或互作？",
          options: [
            { label: "全景免疫", description: "T / B / 髓系 / 基质均衡覆盖" },
            { label: "偏 T 细胞", description: "T 亚群、耗竭、检查点" },
            { label: "偏髓系 / 基质", description: "TAM、CAF、血管" },
            { label: "我补充目标", description: "写必须解析的群体或互作" },
          ],
          closed: (blob) => AIM.test(blob),
        },
        {
          id: "segmentation",
          when: ["compute"],
          question: "图像是否已经分割？用的什么方法？",
          options: [
            { label: "尚未分割", description: "需要先做 steinbock / Mesmer / cellpose" },
            { label: "已有 mask", description: "沿用现有分割" },
            { label: "已有细胞表", description: "cells.csv / intensities，跳过分割" },
          ],
          closed: (blob) => /steinbock|mesmer|cellpose|已分割|mask|cells\.csv|intensit/i.test(blob),
        },
        {
          id: "comparison",
          when: ["compute"],
          question: "比较分组是什么？",
          options: [
            { label: "病例 vs 对照", description: "两组比较" },
            { label: "治疗前后", description: "配对或纵向" },
            { label: "先做描述", description: "本轮不做组间统计" },
          ],
          closed: (blob) => /对照|分组|case.?control|treatment|治疗前|治疗后|比较组/i.test(blob),
        },
      ],
    },
    "single-cell": {
      theme: "single-cell",
      extra: /\.(rds)$/i,
      ask: [
        {
          id: "Species",
          when: ["design", "compute"],
          question: "物种和组织？",
          options: [
            { label: "人", description: "Homo sapiens" },
            { label: "小鼠", description: "Mus musculus" },
            { label: "其他", description: "在输入框写物种 + 组织" },
          ],
          closed: (blob) => SPECIES.test(blob) && TISSUE.test(blob),
        },
        {
          id: "Processing",
          when: ["compute"],
          question: "数据现在到哪一步了？",
          options: [
            { label: "原始 counts", description: "尚未 QC / 归一化" },
            { label: "已 QC / 归一化", description: "从聚类或注释接着做" },
            { label: "已聚类，只要注释", description: "有 marker 表即可" },
          ],
          closed: (blob) => /已(?:QC|质控|归一|聚类|注释)|raw counts|already (?:qc|normali|cluster)/i.test(blob),
        },
        {
          id: "batch",
          when: ["compute"],
          question: "多样本是否需要批次校正？",
          options: [
            { label: "单样本", description: "不做批次校正" },
            { label: "多样本，要校正", description: "Harmony / scVI 等" },
            { label: "多样本，先不校正", description: "先看批次结构" },
          ],
          closed: (blob) => /单样本|多样本|批次|batch|harmony|scvi/i.test(blob),
        },
        {
          id: "Annotation",
          when: ["compute"],
          question: "注释范围？",
          options: [
            { label: "全部 cluster", description: "markers 文件里每一个都注释" },
            { label: "只做某一谱系", description: "如 T/NK 或髓系" },
          ],
          closed: (blob) => /全部 cluster|所有 cluster|谱系|T\/NK|髓系|lineage subset/i.test(blob),
        },
      ],
    },
    spatial: {
      theme: "spatial",
      extra: /$^/,
      ask: [
        {
          id: "Platform",
          when: ["design", "compute"],
          question: "平台和分辨率？spot/bin 混合细胞，还是单细胞靶向？",
          options: [
            { label: "Visium / Stereo-seq", description: "spot 或 bin，需要去卷积才能谈细胞类型" },
            { label: "Xenium / MERFISH / CosMx", description: "单细胞靶向 panel" },
          ],
          closed: (blob) => /visium|stereo|merfish|xenium|cosmx|spot|bin|靶向/i.test(blob),
        },
        {
          id: "Coordinate",
          when: ["compute"],
          question: "坐标 / 配准和 H&E 或 DAPI 图是否可用？",
          options: [
            { label: "有 spatial 坐标和图", description: "h5ad obsm['spatial'] + 组织图" },
            { label: "只有表达矩阵", description: "需要先补坐标" },
          ],
          closed: (blob) => /obsm|spatial|配准|H&E|DAPI|坐标/i.test(blob),
        },
        {
          id: "deconvolution",
          when: ["compute"],
          question: "是否有同组织同物种的 scRNA-seq 参考用于去卷积？",
          options: [
            { label: "有参考", description: "同组织同物种" },
            { label: "没有参考", description: "只做区域 / niche，不报细胞类型" },
          ],
          closed: (blob) => /参考|deconvolv|去卷积|没有参考|无参考/i.test(blob),
        },
        {
          id: "Comparison",
          when: ["compute"],
          question: "比较设计？",
          options: [
            { label: "区域之间", description: "niche / ROI" },
            { label: "样本 / 条件之间", description: "病例对照或处理" },
            { label: "先描述空间结构", description: "本轮不做组间" },
          ],
          closed: (blob) => /区域|ROI|条件|样本间|对照|描述空间/i.test(blob),
        },
      ],
    },
    genomics: {
      theme: "genomics",
      extra: /\.(vcf)(\.gz)?$/i,
      ask: [
        {
          id: "Reference",
          when: ["compute"],
          question: "参考基因组是 GRCh38 还是 GRCh37/hg19？",
          options: [
            { label: "GRCh38", description: "hg38" },
            { label: "GRCh37 / hg19", description: "旧坐标，不能和 38 混用" },
          ],
          closed: (blob) => /GRCh38|GRCh37|hg19|hg38|参考基因组/i.test(blob),
        },
        {
          id: "Germline",
          when: ["compute"],
          question: "胚系还是体细胞？有没有配对正常？",
          options: [
            { label: "胚系", description: "germline" },
            { label: "体细胞，有配对正常", description: "tumour–normal" },
            { label: "仅肿瘤", description: "tumour-only，必须标明" },
          ],
          closed: (blob) => /胚系|体细胞|germline|somatic|配对|tumou?r-?only|仅肿瘤/i.test(blob),
        },
        {
          id: "Sequencing",
          when: ["compute"],
          question: "测序类型？读段是否已经比对？",
          options: [
            { label: "WGS，未比对", description: "fastq" },
            { label: "WES / panel，已比对", description: "bam / cram" },
            { label: "已有 VCF", description: "从变异表接着做" },
          ],
          closed: (blob) => /WGS|WES|targeted panel|已比对|fastq|bam|vcf/i.test(blob),
        },
        {
          id: "Analysis aim",
          when: ["design", "compute"],
          question: "这一轮的分析目标？",
          options: [
            { label: "致病变异", description: "ACMG / ClinVar" },
            { label: "驱动基因 / 体细胞", description: "driver discovery" },
            { label: "CNV 或 GWAS", description: "结构或关联" },
          ],
          closed: (blob) => /致病|驱动|CNV|GWAS|screen|pathogenic|driver/i.test(blob),
        },
      ],
    },
  }

  export function spec(theme: string | undefined): Spec | undefined {
    if (!isBiologyTheme(theme)) return undefined
    return SPECS[theme]
  }

  export function intent(contract: AgentRouter.Contract, text: string): Kind[] {
    if (contract.intent === "direct_answer" && !DESIGN.test(text) && !COMPUTE.test(text)) return []
    if (contract.intent === "literature_verification" && !DESIGN.test(text) && !COMPUTE.test(text)) return []
    if (contract.intent === "meta_conversation") return []
    const out: Kind[] = []
    if (contract.intent === "research_design" || DESIGN.test(text)) out.push("design")
    if (contract.intent === "data_analysis" || contract.intent === "execution" || COMPUTE.test(text))
      out.push("compute")
    return out
  }

  export function open(theme: string | undefined, blob: string, kinds: Kind[]) {
    const item = spec(theme)
    if (!item || kinds.length === 0) return []
    return item.ask.filter((slot) => slot.when.some((when) => kinds.includes(when)) && !slot.closed(blob))
  }

  export function extra(theme: string | undefined) {
    return spec(theme)?.extra
  }

  export function render(theme: string, kinds: Kind[], slots: Ask[]) {
    const lines = [
      `<${KEY} theme="${theme}" intent="${kinds.join("+")}">`,
      "Open result-changing slots. One question tool call covering ALL of them, then stop.",
      "Copy these options. Do not invent a different modality card (IMC vs CyTOF vs scRNA) or extra slots.",
      ...slots.map((slot, index) => {
        const options = slot.options.map((option) => `   ${option.label} — ${option.description}`).join("\n")
        return `${index + 1}. [${slot.id}] ${slot.question}\n${options}`
      }),
      `</${KEY}>`,
    ]
    return lines.join("\n")
  }

  export function inject(userMessage: MessageV2.WithParts, contract: AgentRouter.Contract, theme?: string) {
    if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(`<${KEY} `))) return
    const text = userMessage.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    const user = userMessage.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.hybio)
      .map((part) => part.text)
      .join("\n")
    const kinds = intent(contract, user)
    const slots = open(theme, text, kinds)
    if (slots.length === 0 || !theme) return
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: render(theme, kinds, slots),
      hybio: true,
    })
  }

  const PIPE = /\|/
  const ISOTOPE = /^(?:isotope|metal|channel|金属|同位素)$/i
  const CLONE = /^(?:clone|克隆)$/i
  const COMPARTMENT = /^(?:compartment|定位|compartment\/target)$/i
  const MARKER = /^(?:marker|hgnc|gene|抗体)$/i

  export function tables(text: string) {
    const out: { headers: string[]; rows: string[][] }[] = []
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length - 1; i++) {
      if (!PIPE.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue
      const headers = lines[i]
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim())
      const rows: string[][] = []
      for (let j = i + 2; j < lines.length; j++) {
        if (!PIPE.test(lines[j])) break
        const trimmed = lines[j]
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((cell) => cell.trim())
        if (trimmed.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
        rows.push(trimmed)
      }
      if (headers.length) out.push({ headers, rows })
    }
    return out
  }

  function col(headers: string[], pattern: RegExp) {
    return headers.findIndex((header) => pattern.test(header))
  }

  function imcFindings(text: string): ReviewRecord.Finding[] {
    const found = tables(text).filter((table) => col(table.headers, ISOTOPE) >= 0 || col(table.headers, MARKER) >= 0)
    if (found.length === 0) return []
    const out: ReviewRecord.Finding[] = []
    for (const table of found) {
      const isotopeAt = col(table.headers, ISOTOPE)
      const cloneAt = col(table.headers, CLONE)
      const compartmentAt = col(table.headers, COMPARTMENT)
      if (cloneAt < 0 || compartmentAt < 0) {
        out.push({
          severity: "blocking",
          message: "IMC panel table is missing a clone or compartment column.",
          evidence: [table.headers.join(" | ")],
        })
      }
      if (isotopeAt >= 0) {
        const values = table.rows.map((row) => row[isotopeAt]?.replace(/\s+/g, "")).filter(Boolean)
        const seen = new Map<string, number>()
        for (const value of values) seen.set(value.toLowerCase(), (seen.get(value.toLowerCase()) ?? 0) + 1)
        const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
        if (dup.length) {
          out.push({
            severity: "blocking",
            message: `IMC panel assigns the same isotope twice: ${dup.join(", ")}.`,
            evidence: dup,
          })
        }
      }
      const blob = table.rows.flat().join(" ")
      const nuclear = /Ir191|Ir193|Histone H3|DNA/i.test(blob)
      const membrane = /CD45|E-?cadherin|pan-?CK|NaK|membrane/i.test(blob)
      const structural = /αSMA|aSMA|vimentin|collagen|stroma/i.test(blob)
      if (!nuclear || !membrane || !structural) {
        out.push({
          severity: "warning",
          message: "IMC panel is missing an explicit nuclear, membrane, or structural/QC channel.",
          evidence: [
            nuclear ? "nuclear ok" : "nuclear missing",
            membrane ? "membrane ok" : "membrane missing",
            structural ? "structural ok" : "structural missing",
          ],
        })
      }
    }
    return out
  }

  function clusterIds(text: string) {
    const ids = new Set<string>()
    for (const table of tables(text)) {
      const at = table.headers.findIndex((header) => /^(?:cluster|id|cluster id)$/i.test(header))
      if (at < 0) continue
      for (const row of table.rows) {
        const value = row[at]?.trim()
        if (value && /^\d+$/.test(value)) ids.add(value)
      }
    }
    for (const match of text.matchAll(/\bcluster\s*[#:]?\s*(\d+)\b/gi)) ids.add(match[1])
    return ids
  }

  export function clustersFromCsv(text: string) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length < 2) return []
    const delim = lines[0].includes("\t") ? "\t" : ","
    const headers = lines[0].split(delim).map((cell) => cell.trim())
    const at = headers.findIndex((header) => /cluster/i.test(header))
    if (at < 0) return []
    const ids = new Set<string>()
    for (const line of lines.slice(1)) {
      const value = line.split(delim)[at]?.trim()
      if (value) ids.add(value)
    }
    return [...ids]
  }

  function scrnaFindings(text: string, markers?: string[]): ReviewRecord.Finding[] {
    if (!markers?.length) return []
    const answered = clusterIds(text)
    const missing = markers.filter((id) => !answered.has(id))
    if (missing.length === 0) return []
    return [
      {
        severity: "blocking",
        message: `Annotation is missing clusters present in the markers file: ${missing.join(", ")}.`,
        evidence: missing,
      },
    ]
  }

  function spatialFindings(text: string): ReviewRecord.Finding[] {
    const spot = /visium|stereo|spot|bin-?level|spot-?level/i.test(text)
    const typed = /细胞类型|cell types?/i.test(text)
    const deconv = /deconvolv|去卷积|RCTD|cell2location|tangram/i.test(text)
    if (spot && typed && !deconv) {
      return [
        {
          severity: "warning",
          message: "Spot/bin data is described as cell types without deconvolution.",
          evidence: [],
        },
      ]
    }
    return []
  }

  export function check(theme: string | undefined, text: string, extras?: { markerClusters?: string[] }) {
    if (theme === "imc") return imcFindings(text)
    if (theme === "single-cell") return scrnaFindings(text, extras?.markerClusters)
    if (theme === "spatial") return spatialFindings(text)
    if (theme === "genomics") return genomicsFindings(text)
    return []
  }

  function genomicsFindings(text: string): ReviewRecord.Finding[] {
    const hg38 = /GRCh38|hg38/i.test(text)
    const hg19 = /GRCh37|hg19/i.test(text)
    if (hg38 && hg19) {
      return [
        {
          severity: "blocking",
          message: "Answer mixes GRCh38/hg38 with GRCh37/hg19 coordinates.",
          evidence: ["reference genome"],
        },
      ]
    }
    return []
  }
}
