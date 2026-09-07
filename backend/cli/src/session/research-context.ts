/**
 * 研究上下文状态管理器
 *
 * 独立于 Prompt 的结构化实体存储器：
 * - 从对话中自动抽取实体（物种、组织、平台、分组、组学类型、研究目标）
 * - 跨轮次保持状态，支持用户随时修正
 * - 评估信息完备度，按需生成自然追问提示
 */

import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"
import { Log } from "@/util/log"

export namespace ResearchContext {
  const log = Log.create({ service: "research-context" })

  export interface Entities {
    species?: string // 人/小鼠/大鼠/...
    tissue?: string // 肺/肝/肠道/脑/...
    platform?: string // 10x/SMART-seq/Illumina/...
    groups?: string // case/control, treatment info
    omicsTypes: string[] // scRNA/VDJ/spatial/...
    researchAim?: string // 细胞图谱/差异分析/...
    hasVDJ: boolean // 是否明确提及 VDJ 测序
    lastUpdate: number // timestamp
  }

  function contextPath(sessionID: string, taskID?: string): string {
    const suffix = taskID ? `-${taskID}` : ""
    return path.join(Instance.directory, ".hyscience", "memory", `ctx-${sessionID}${suffix}.json`)
  }

  export interface State {
    constraints: Entities
    hypotheses: Partial<Entities>
  }

  // ===== ENTITY EXTRACTION =====

  const ENTITY_PATTERNS: Record<string, RegExp[]> = {
    species: [
      /人|human|homo|sapiens/i,
      /小鼠|mouse|mus|musculus/i,
      /大鼠|rat|rattus|norvegicus/i,
      /斑马鱼|zebrafish|danio/i,
      /果蝇|drosophila|melanogaster/i,
      /猴|monkey|macaque|rhesus/i,
      /猪|pig|porcine|sus/i,
      /拟南芥|arabidopsis/i,
    ],
    tissue: [
      /肺|lung|pulmonary/i,
      /肝|liver|hepatic|hepatocyte/i,
      /肠道|肠|intestine|gut|colon|ileum|jejunum|duodenum/i,
      /脑|brain|cortex|hippocampus|cerebellum|neuron/i,
      /脾|spleen|splenic/i,
      /肾|kidney|renal|nephron/i,
      /心|heart|cardiac|myocardium/i,
      /血|blood|PBMC|peripheral.blood/i,
      /皮肤|skin|dermal|epidermis/i,
      /肿瘤|tumor|cancer|carcinoma|melanoma|glioma/i,
      /骨髓|bone.marrow|marrow/i,
      /淋巴|lymph.node|tonsil/i,
      /胰腺|pancreas|pancreatic/i,
      /脂肪|adipose|fat/i,
    ],
    platform: [
      /10x|10X|chromium/i,
      /SMART.?seq/i,
      /BD.?Rhapsody|Rhapsody/i,
      /华大|BGI|DNB|STOmics/i,
      /Illumina|NovaSeq|HiSeq|NextSeq|MiSeq/i,
      /Nanopore|ONT|MinION|PromethION/i,
      /PacBio|Sequel|Revio/i,
      /Parse.?Bio|Parse/i,
      /in.?drop|Drop.?seq/i,
      /MARS.?seq/i,
      /sci.?RNA/i,
    ],
  }

  const OMICS_PATTERNS: Record<string, RegExp> = {
    scRNA: /单细胞.*RNA|scRNA|sc\.RNA|single.?cell.*transcriptom|单细胞转录组/i,
    scATAC: /scATAC|ATAC.?seq|单细胞.*ATAC/i,
    VDJ: /VDJ|TCR.*seq|BCR.*seq|免疫组库|T细胞受体|B细胞受体|scTCR|scBCR|TRAV|TRBV|TRAJ|IGHV|IGKV/i,
    spatial: /空间转录组|spatial.*transcriptom|STOmics|Visium|MERFISH|Slide.?seq|Stereo.?seq/i,
    CITE: /CITE.?seq|ADT|抗体.*tag|HTO|TotalSeq|表面蛋白/i,
    multiome: /multiome|多组学|ATAC.*RNA|RNA.*ATAC|snRNA.*snATAC/i,
    proteomics: /蛋白组|proteom|质谱|mass.?spec|SomaScan|Olink/i,
    metabolomics: /代谢组|metabolom|LC.?MS|GC.?MS/i,
  }

  export function extractEntities(text: string, current?: Entities): Entities {
    const result: Entities = {
      species: current?.species,
      tissue: current?.tissue,
      platform: current?.platform,
      groups: current?.groups,
      omicsTypes: current?.omicsTypes ?? [],
      researchAim: current?.researchAim,
      hasVDJ: current?.hasVDJ ?? false,
      lastUpdate: Date.now(),
    }

    // Extract species
    for (const [key, patterns] of Object.entries(ENTITY_PATTERNS)) {
      for (const re of patterns) {
        if (re.test(text)) {
          const match = text.match(re)![0]
          if (key === "species") {
            if (/人|human/i.test(match)) result.species = "human"
            else if (/小鼠|mouse/i.test(match)) result.species = "mouse"
            else if (/大鼠|rat/i.test(match)) result.species = "rat"
            else if (/斑马鱼|zebrafish/i.test(match)) result.species = "zebrafish"
            else if (/果蝇|drosophila/i.test(match)) result.species = "drosophila"
            else if (/猴|monkey|macaque/i.test(match)) result.species = "macaque"
            else if (/猪|pig|porcine/i.test(match)) result.species = "pig"
            else if (/拟南芥|arabidopsis/i.test(match)) result.species = "arabidopsis"
            break // first match wins for species
          }
          if (key === "tissue") {
            if (/肺|lung/i.test(match)) result.tissue = "lung"
            else if (/肝|liver/i.test(match)) result.tissue = "liver"
            else if (/肠道|肠|intestine|gut|colon/i.test(match)) result.tissue = "intestine"
            else if (/脑|brain/i.test(match)) result.tissue = "brain"
            else if (/脾|spleen/i.test(match)) result.tissue = "spleen"
            else if (/肾|kidney/i.test(match)) result.tissue = "kidney"
            else if (/血|blood|PBMC/i.test(match)) result.tissue = "blood/PBMC"
            else if (/肿瘤|tumor|cancer/i.test(match)) result.tissue = "tumor"
            else if (/皮肤|skin/i.test(match)) result.tissue = "skin"
            else if (/骨髓|marrow/i.test(match)) result.tissue = "bone-marrow"
            else if (/心|heart|cardiac/i.test(match)) result.tissue = "heart"
            else if (/胰腺|pancreas/i.test(match)) result.tissue = "pancreas"
            break
          }
          if (key === "platform") {
            result.platform = match
            break
          }
        }
      }
    }

    // Extract omics types
    for (const [omics, re] of Object.entries(OMICS_PATTERNS)) {
      if (re.test(text) && !result.omicsTypes.includes(omics)) {
        result.omicsTypes.push(omics)
      }
    }
    if (result.omicsTypes.includes("VDJ")) result.hasVDJ = true

    // Extract research aim
    if (/细胞图谱|cell.?atlas|细胞分群|细胞类型|注释|annotat|cluster/i.test(text))
      result.researchAim = "cell-atlas/annotation"
    else if (/差异|DEG|differential|对比|比较|vs|versus|case.*control/i.test(text))
      result.researchAim = "differential-analysis"
    else if (/细胞通讯|cell.?communication|配体|受体|ligand|receptor|CCI|NicheNet|CellChat/i.test(text))
      result.researchAim = "cell-communication"
    else if (/拟时序|trajectory|pseudotime|分化|development|Monocle|RNA.?velocity/i.test(text))
      result.researchAim = "trajectory/development"
    else if (/整合|integrat|batch.*correct|Harmony|CCA|merge/i.test(text)) result.researchAim = "integration"
    else if (/marker|marker|基因.*列表|gene.*panel/i.test(text)) result.researchAim = "marker-discovery"

    return result
  }

  // ===== STATE PERSISTENCE =====

  function empty(): Entities {
    return { omicsTypes: [], hasVDJ: false, lastUpdate: 0 }
  }

  export async function loadState(sessionID: string, taskID?: string): Promise<State> {
    try {
      const raw = await fs.readFile(contextPath(sessionID, taskID), "utf-8")
      const value = JSON.parse(raw) as State | Entities
      if ("constraints" in value) return value
      return { constraints: value, hypotheses: {} }
    } catch {
      return { constraints: empty(), hypotheses: {} }
    }
  }

  export async function load(sessionID: string, taskID?: string): Promise<Entities> {
    return (await loadState(sessionID, taskID)).constraints
  }

  export async function save(sessionID: string, entities: Entities, taskID?: string): Promise<void> {
    await saveState(sessionID, { constraints: entities, hypotheses: {} }, taskID)
  }

  export async function saveState(sessionID: string, state: State, taskID?: string): Promise<void> {
    await fs.mkdir(path.dirname(contextPath(sessionID, taskID)), { recursive: true })
    await fs.writeFile(contextPath(sessionID, taskID), JSON.stringify(state, null, 2))
  }

  export async function migrate(sessionID: string, taskID: string): Promise<void> {
    if (await Bun.file(contextPath(sessionID, taskID)).exists()) return
    if (!(await Bun.file(contextPath(sessionID)).exists())) return
    await saveState(sessionID, await loadState(sessionID), taskID)
  }

  export async function forget(sessionID: string, taskID: string, suggest: string) {
    const state = await loadState(sessionID, taskID)
    const current = state.constraints
    const drop =
      suggest === "single-cell"
        ? ["scRNA", "scATAC", "CITE"]
        : suggest === "spatial"
          ? ["spatial"]
          : suggest === "imc"
            ? []
            : []
    const omicsTypes = current.omicsTypes.filter((name) => !drop.includes(name))
    const platform =
      suggest === "single-cell" && /10x|chromium|SMART/i.test(current.platform ?? "") ? undefined : current.platform
    const researchAim =
      suggest === "single-cell" && /cell-atlas|annotation|trajectory/i.test(current.researchAim ?? "")
        ? undefined
        : current.researchAim
    const next = { ...current, omicsTypes, platform, researchAim, lastUpdate: Date.now() }
    await saveState(sessionID, { ...state, constraints: next }, taskID)
    return next
  }

  export async function update(sessionID: string, taskID: string, text: string): Promise<Entities> {
    const state = await loadState(sessionID, taskID)
    const current = state.constraints
    const updated = extractEntities(text, current)
    await saveState(sessionID, { ...state, constraints: updated }, taskID)
    log.info("context updated", {
      sessionID,
      species: updated.species ?? "(none)",
      tissue: updated.tissue ?? "(none)",
      omics: updated.omicsTypes.join(",") || "(none)",
      aim: updated.researchAim ?? "(none)",
    })
    return updated
  }

  // ===== COMPLETENESS EVALUATION =====

  export interface CompletenessReport {
    level: "sufficient" | "partial" | "minimal"
    present: string[]
    missing: string[]
    suggestion: string // natural language hint for the LLM
  }

  export function evaluate(entities: Entities): CompletenessReport {
    const present: string[] = []
    const missing: string[] = []

    if (entities.species) present.push("species")
    else missing.push("物种")

    if (entities.tissue) present.push("tissue")
    else missing.push("组织")

    if (entities.omicsTypes.length > 0) present.push("omics")
    else missing.push("组学类型")

    if (entities.researchAim) present.push("research-aim")
    else missing.push("研究目标")

    if (entities.platform) present.push("platform")
    // platform is optional

    const level = present.length >= 4 ? "sufficient" : present.length >= 2 ? "partial" : "minimal"

    const suggestion =
      missing.length > 0
        ? `Current known: ${present.join(", ") || "(none)"}. Missing: ${missing.join(", ")}. Max 1-2 natural follow-up questions — not a checklist.`
        : "All key entities known. Proceed to answer."

    return { level, present, missing, suggestion }
  }

  /** Format a hybio message injecting the context state. */
  export function formatContext(entities: Entities, report: CompletenessReport): string {
    const lines = [
      "<research-context>",
      `## Known Entities`,
      `- Species: ${entities.species ?? "unknown"}`,
      `- Tissue: ${entities.tissue ?? "unknown"}`,
      `- Platform: ${entities.platform ?? "not specified"}`,
      `- Omics: ${entities.omicsTypes.join(", ") || "none"}`,
      `- Research Aim: ${entities.researchAim ?? "not specified"}`,
      `- VDJ: ${entities.hasVDJ ? "yes" : "no"}`,
      "",
      `## Completeness: ${report.level}`,
      report.suggestion,
      "</research-context>",
    ]
    return lines.join("\n")
  }
}
