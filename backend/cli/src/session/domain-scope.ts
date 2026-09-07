export type DirectionId = "imc" | "single-cell" | "spatial" | "genomics"

export type Drift = {
  current: DirectionId
  suggest: string
  currentTitle: string
  suggestTitle: string
  kind: "execute" | "ask"
}

type Foreign = Partial<Record<DirectionId | "general", RegExp>>

type Direction = {
  title: string
  focus: string
  foreign: Foreign
  files?: RegExp
}

/** Full scRNA pipelines — not bare「单细胞」, which IMC also uses for protein cells. */
const SCRNA =
  /\b(scrna|sc-?rna|scrna-seq|10x(?:\s+genomics)?|chromium|seurat|scanpy|h5ad)\b|单细胞转录组|单细胞测序|单细胞 rna/i
const SCRNA_RUN = /单细胞分析|单细胞细胞/
const KNOW =
  /区别|差异|对比|比较|检索|搜索|查阅|文献|论文|调研|综述|概述|介绍|原理|机制|优缺点|哪个|什么是|是什么|what is|how does|compared to|difference between|versus|\bvs\.?\b|review|survey/i
const ASK = /能不能|可不可以|可以做|会不会|能做吗|也能做|可以分析|can you|could you/i
const RUN =
  /帮我做|给我做|请做|请分析|跑一下|分析一下|做一下|开始跑|开始分析|执行分析|执行.{0,8}代码|跑代码|analyze this|run this|process this/i

const HOLD = new Map<string, Drift>()

const DIRECTION: Record<DirectionId, Direction> = {
  imc: {
    title: "IMC 分析",
    focus:
      "成像质谱（IMC / Hyperion / CODEX / MIBI）蛋白质成像：分割、表型、邻域、区域组成、蛋白共表达。执行范围不包括 scRNA-seq、空间转录组或基因组变异分析。",
    files: /\.(mcd)$/i,
    foreign: {
      "single-cell": SCRNA,
      spatial: /\b(visium|merfish|xenium|stereo.?seq|slide.?seq|spatial.?transcriptom)\b|空间转录组/i,
      genomics: /\b(wgs|wes|gwas|vcf|bwa|gatk|crispr screen)\b|\.vcf\b|\.bam\b|全基因组|外显子组|变异检测/i,
      general: /\b(smiles|docking|alphafold|fine-?tun(e|ing)|lora)\b|分子对接|大模型微调/i,
    },
  },
  "single-cell": {
    title: "单细胞分析",
    focus:
      "scRNA-seq / 单细胞：质控、整合、聚类、注释、差异基因、轨迹、细胞通讯。执行范围不包括 IMC 成像、空间转录组平台分析或基因组变异分析。",
    files: /\.(h5ad|loom|h5seurat)$/i,
    foreign: {
      imc: /\b(imc|imaging.?mass|hyperion|codex|mibi)\b|\.mcd\b|成像质谱/i,
      spatial: /\b(visium|merfish|xenium|stereo.?seq|slide.?seq|spatial.?transcriptom)\b|空间转录组/i,
      genomics: /\b(wgs|wes|gwas|vcf|bwa|gatk)\b|\.vcf\b|\.bam\b|全基因组|外显子组|变异检测/i,
      general: /\b(smiles|docking|alphafold|fine-?tun(e|ing)|lora)\b|分子对接|大模型微调/i,
    },
  },
  spatial: {
    title: "空间转录组",
    focus:
      "空间转录组（Visium / Stereo-seq / MERFISH 等）：空间邻域、配体受体、去卷积、与单细胞参考整合。执行范围不包括 IMC 蛋白成像或基因组变异分析。",
    foreign: {
      imc: /\b(imc|imaging.?mass|hyperion|codex|mibi)\b|\.mcd\b|成像质谱/i,
      "single-cell": SCRNA,
      genomics: /\b(wgs|wes|gwas|vcf|bwa|gatk)\b|\.vcf\b|\.bam\b|全基因组|外显子组|变异检测/i,
      general: /\b(smiles|docking|alphafold|fine-?tun(e|ing)|lora)\b|分子对接|大模型微调/i,
    },
  },
  genomics: {
    title: "基因组分析",
    focus: "基因组：比对、变异、注释、GWAS、表达定量、富集。执行范围不包括 IMC 成像、单细胞聚类或空间转录组平台分析。",
    files: /\.(vcf|bcf|bam|sam|cram|fastq|fq)(\.gz)?$/i,
    foreign: {
      imc: /\b(imc|imaging.?mass|hyperion|codex|mibi)\b|\.mcd\b|成像质谱/i,
      "single-cell": SCRNA,
      spatial: /\b(visium|merfish|xenium|stereo.?seq|slide.?seq|spatial.?transcriptom)\b|空间转录组/i,
      general: /\b(smiles|docking|alphafold|fine-?tun(e|ing)|lora)\b|分子对接|大模型微调/i,
    },
  },
}

const TITLES: Record<string, string> = {
  imc: "IMC 分析",
  "single-cell": "单细胞分析",
  spatial: "空间转录组",
  genomics: "基因组分析",
  general: "通用研究",
}

function matchForeign(key: DirectionId, blob: string) {
  for (const [suggest, pattern] of Object.entries(DIRECTION[key].foreign)) {
    if (pattern.test(blob)) return suggest
  }
  if (key !== "single-cell" && SCRNA_RUN.test(blob) && (RUN.test(blob) || ASK.test(blob))) return "single-cell"
}

function matchForeignFiles(key: DirectionId, filenames: string[]) {
  const names = filenames.join("\n")
  if (!names) return undefined
  for (const [id, item] of Object.entries(DIRECTION)) {
    if (id === key) continue
    if (item.files?.test(names)) return id
  }
}

function hit(key: DirectionId, suggest: string, kind: Drift["kind"]): Drift {
  return { current: key, suggest, currentTitle: TITLES[key], suggestTitle: TITLES[suggest] ?? TITLES.general, kind }
}

export namespace DomainScope {
  export function id(subdomain: string | undefined): DirectionId | undefined {
    if (subdomain === "imc" || subdomain === "single-cell" || subdomain === "spatial" || subdomain === "genomics")
      return subdomain
    return undefined
  }

  export function title(subdomain: string | undefined) {
    return TITLES[subdomain ?? ""] ?? "通用研究"
  }

  export function focus(subdomain: string | undefined) {
    const key = id(subdomain)
    return key ? DIRECTION[key].focus : undefined
  }

  export function drift(
    subdomain: string | undefined,
    input: { text: string; filenames: string[] },
  ): Drift | undefined {
    const key = id(subdomain)
    if (!key) return undefined
    const blob = `${input.text}\n${input.filenames.join("\n")}`
    const files = matchForeignFiles(key, input.filenames)
    const suggest = matchForeign(key, blob) ?? files
    if (!suggest) return undefined
    if (KNOW.test(input.text) && !RUN.test(input.text)) return undefined
    const kind = RUN.test(input.text) || files ? "execute" : ASK.test(input.text) ? "ask" : "execute"
    return hit(key, suggest, kind)
  }

  export function hold(sessionID: string, item?: Drift) {
    if (item?.kind === "execute") {
      HOLD.set(sessionID, item)
      return
    }
    HOLD.delete(sessionID)
  }

  export function blocked(sessionID: string) {
    return HOLD.get(sessionID)
  }

  export function lock(subdomain: string | undefined) {
    const key = id(subdomain)
    if (!key) return undefined
    const item = DIRECTION[key]
    const others = Object.keys(TITLES)
      .filter((name) => name !== key)
      .map((name) => TITLES[name])
      .join("、")
    return [
      `<project-research subdomain="${key}">`,
      `BLOCKING direction lock: ${item.title}.`,
      `This project's execution scope is ${item.title}. The direction was chosen when the project was created — it is not inferred from which skills are loaded.`,
      `Skills are shared tools. scanpy / anndata / spatial libraries may be used when they serve ${item.title}.`,
      `In scope for execution: ${item.focus}`,
      `Allowed in any depth: literature retrieval, comparison, and method discussion of ${others}.`,
      `Not allowed: starting an analysis job whose subject is another direction. Do not collect those data paths or launch that job here.`,
      `「能不能做」means capability, not permission to start. Explain and compare; do not collect files or launch jobs.`,
      `If the user asks to run off-theme analysis: refuse; say this project is locked to ${item.title}; tell them to 切换领域 to the matching direction (or 通用研究).`,
      `</project-research>`,
    ].join("\n")
  }

  export function card(item: Drift) {
    return `<domain-switch current="${item.current}" suggest="${item.suggest}" currentTitle="${item.currentTitle}" suggestTitle="${item.suggestTitle}" kind="${item.kind}"></domain-switch>`
  }

  export function notice(item: Drift) {
    if (item.kind === "ask") {
      return `当前项目是${item.currentTitle}，可以讨论${item.suggestTitle}的方法与文献，但不能在这里执行。要跑分析请通过「切换领域」到${item.suggestTitle}（或通用研究）。`
    }
    return `当前项目是${item.currentTitle}，无法在这里执行${item.suggestTitle}。请通过「切换领域」到${item.suggestTitle}（或通用研究）后再发起分析。`
  }

  export function refuse(item: Drift) {
    return `Blocked off-theme execution. ${notice(item)}`
  }

  export function alert(item: Drift) {
    if (item.kind === "ask") {
      return [
        "<system-reminder>",
        `Capability question about ${item.suggestTitle} inside a ${item.currentTitle} project.`,
        `You may answer in detail: methods, literature, and comparison are in scope.`,
        `Do not execute a ${item.suggestTitle} job. Shared skills may still be discussed. Do not ask for those files or launch that job.`,
        notice(item),
        "</system-reminder>",
      ].join("\n")
    }
    return [
      "<system-reminder>",
      `BLOCKING off-theme execution: current direction is ${item.currentTitle}; this message is a ${item.suggestTitle} analysis job.`,
      `Do not start a ${item.suggestTitle} analysis job. Shared skills are fine when they serve ${item.currentTitle}.`,
      notice(item),
      `Literature, comparison, and method discussion of ${item.suggestTitle} remain allowed — this block is execution only.`,
      "</system-reminder>",
    ].join("\n")
  }
}
