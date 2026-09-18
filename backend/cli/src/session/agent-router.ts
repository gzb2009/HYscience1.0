/**
 * Agent Router — regex-based intent hints for the injection boundary and a
 * deterministic interaction contract (interpret) used by prompt injection.
 */

import { AIM, ASSAY, BIOLOGY_FILE, IMC_CONFIRMED, IMC_TOKEN, PLATFORM_ANY, SPECIES, TISSUE } from "./biology-lexicon"

export namespace AgentRouter {
  export type Intent =
    | "literature_review"
    | "exploratory_analysis"
    | "hypothesis_testing"
    | "method_development"
    | "result_synthesis"
    | "code_debugging"
    | "general"

  export type Recommendation = {
    agent: string
    reason: string
    tier?: "fast" | "pro" | "ultra"
  }

  export type InteractionIntent =
    | "direct_answer"
    | "exploration"
    | "research_design"
    | "data_analysis"
    | "literature_verification"
    | "execution"
    | "correction"
    | "meta_conversation"

  export type RigorGate = "literature" | "inference" | "experiment" | "data"

  /**
   * A small, inspectable interaction contract used by prompt injection. It
   * deliberately describes what the assistant must preserve or verify; it
   * never prescribes a workflow stage, tool, or agent switch.
   */
  export type Contract = {
    intent: InteractionIntent
    confidence: number
    knownContext: string[]
    missingPremises: string[]
    mustClarify: boolean
    gates: RigorGate[]
    coordinate: boolean
    review: boolean
  }

  // ===== REGEX INTENT HINTS =====
  const SIGNALS: Record<Intent, { pattern: RegExp; weight: number }[]> = {
    literature_review: [
      {
        pattern: /\b(literature\s*review|systematic\s*review|prisma|meta.analysis|survey|state\s*of\s*the\s*art)\b/i,
        weight: 3,
      },
      { pattern: /(?:文献调研|调研报告|撰写.*文献)/i, weight: 3 },
      {
        pattern: /\b(find\s*(papers?|references?|articles?|literature)|summarize\s*(the\s*)?literature)\b/i,
        weight: 2,
      },
      { pattern: /\b(pubmed|arxiv|semantic\s*scholar|what\s*is\s*known)\b/i, weight: 2 },
    ],
    exploratory_analysis: [
      { pattern: /\b(explore|exploratory|investigate|characterize|profile|landscape)\b/i, weight: 3 },
      { pattern: /\b(cluster|umap|pca|tsne|dimension\s*reduction|unsupervised)\b/i, weight: 2 },
      { pattern: /\b(qc|quality\s*control|preprocess|normalize|filter)\b/i, weight: 2 },
      { pattern: /\b(load.*data|read.*file|\.(h5ad|fastq|vcf|bam|csv|tsv))\b/i, weight: 1 },
    ],
    hypothesis_testing: [
      { pattern: /\b(test|validate|verify|confirm|refute|differential|statistical\s*test)\b/i, weight: 3 },
      { pattern: /\b(p.value|significant|effect\s*size|fold\s*change|odds\s*ratio|hazard\s*ratio)\b/i, weight: 2 },
      {
        pattern: /\b(vs|versus|compared?\s*to|between.*and|across)\s+(group|condition|treatment|control)\b/i,
        weight: 2,
      },
      { pattern: /\b(hypothesis|h0|h1|null|alternative)\b/i, weight: 3 },
    ],
    method_development: [
      {
        pattern:
          /\b(build|develop|create|design|implement|write)\s+(a\s+)?(model|pipeline|workflow|tool|script|function)\b/i,
        weight: 3,
      },
      {
        pattern:
          /\b(build|develop|create|design|implement|write)\s+(a\s+)?(classifier|regressor|random forest|neural network)\b/i,
        weight: 3,
      },
      { pattern: /\b(train|fine.tune|optimize|hyperparameter|architecture|network)\b/i, weight: 2 },
      { pattern: /\b(simulate|simulation|pde|ode|numerical|solver)\b/i, weight: 2 },
    ],
    result_synthesis: [
      {
        pattern:
          /\b(summarize|synthesize|write\s*(up|a\s*report)|draft|manuscript|paper|figure\s*for\s*publication)\b/i,
        weight: 3,
      },
      { pattern: /\b(conclusion|takeaway|key\s*finding|result\s*summary|finalize)\b/i, weight: 2 },
      { pattern: /\b(latex|overleaf|docx|markdown|notebook)\b/i, weight: 1 },
    ],
    code_debugging: [
      { pattern: /\b(fix|debug|error|bug|broken|failing|issue|wrong|incorrect)\b/i, weight: 3 },
      { pattern: /\b(traceback|exception|stack trace|typeerror|valueerror|runtimeerror)\b/i, weight: 3 },
      { pattern: /\b(why (is|does|are))\b/i, weight: 1 },
    ],
    general: [],
  }

  function regexDetect(text: string): Intent {
    const scores: Record<string, number> = {}
    for (const [intent, signals] of Object.entries(SIGNALS)) {
      let score = 0
      for (const s of signals) {
        if (s.pattern.test(text)) score += s.weight
      }
      scores[intent] = score
    }
    const entries = Object.entries(scores).filter(([, v]) => v > 0)
    if (entries.length === 0) return "general"
    const best = entries.sort((a, b) => b[1] - a[1])[0]
    return best[0] as Intent
  }

  function context(text: string): string[] {
    const values = [
      ["data", /(?:dataset|data|matrix|csv|tsv|h5ad|fastq|数据集|数据|矩阵|文件)/i],
      ["outcome", /(?:outcome|endpoint|response|survival|终点|结局|响应)/i],
      ["comparison", /(?:control|treatment|versus|vs\.?|对照|处理|比较)/i],
      ["source", /(?:doi|pmid|citation|reference|paper|文献|引用)/i],
    ] as const
    return values.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  }

  const UNIVERSAL_ACRONYM =
    /^(?:DNA|RNA|MRNA|CDNA|PCR|QPCR|RTPCR|NGS|WGS|WES|ATAC|CHIP|MHC|HLA|TCR|BCR|UMAP|TSNE|PCA|DEG|FDR|QC|UMI|CSV|TSV|PDF|DOI|PMID|API|GPU|CPU|JSON|HTML|HTTP|HTTPS|ID|OK|UI|USA|UK|FDA|NIH|WHO|IFN|TNF|TGF|VEGF|EGFR|HER2|KRAS|CD\d+|IL\d+)$/
  const FACTUAL_ASK = /(?:^|[\s，。])(?:什么是|是什么|what(?:'s| is)|explain|介绍)\s/i
  const DELIVERABLE = /(?:设计|panel|marker|清单|方案|assay|protocol|写出|输出一份|给我一份|交付)/i
  const FORMAT_SAID =
    /(?:表格|excel|\bxlsx\b|\bcsv\b|\btsv\b|markdown|\.md\b|md格式|图(?:表)?|figure|\bpng\b|word|\bdocx\b|ppt|pptx|powerpoint)/i
  const EXPORT =
    /(?:生成|导出|转成|写成|输出|给我|做一份|改成|来一[个份]).{0,12}(?:word|docx|excel|xlsx|ppt|pptx|word文档)|(?:word|docx|excel)\s*(?:版本|文件|文档|表)/i
  const PRIOR_DESIGN = /(?:设计|panel|marker|清单|assay|方案)|PCF|phenocycler|成像质谱|胃癌|TLS/i

  export function isExportFollowup(text: string, history = "") {
    if (!EXPORT.test(text) || !PRIOR_DESIGN.test(history)) return false
    if (DESIGN_VERB.test(text) && PANEL_OR_ASSAY.test(text)) return false
    return true
  }
  const METHOD_ONLY = /(?:怎么|如何|how (?:to|should)|原理|区别|优缺点)/i
  const PANEL_OR_ASSAY = /(?:panel|marker|清单|assay|抗体[盘组]|panel设计)/i
  const DESIGN_VERB = /(?:设计|做|写|给|输出|交付)/i
  const AIM_SAID = AIM

  export const IMC_CONFIRM = "confirm IMC is imaging mass cytometry (成像质谱)"
  export const PLATFORM_SLOT = "assay or platform that defines reagents and channels"
  export const SPECIES_SLOT = "species (human / mouse / other)"
  export const TISSUE_SLOT = "tissue or cancer type"
  const COMPARE = /(?:区别|差异|对比|比较|versus|\bvs\.?\b|compared to|difference between)/i
  const PLATFORM_SAID = PLATFORM_ANY
  const SPECIES_SAID = SPECIES
  const TISSUE_SAID = TISSUE

  export function isComparison(text: string) {
    return COMPARE.test(text) && !DESIGN_VERB.test(text)
  }

  export function unresolvedAcronyms(text: string, history = "") {
    if (FACTUAL_ASK.test(text) && text.length < 120) return []
    const defined = new Set<string>()
    for (const match of `${history}\n${text}`.matchAll(/\b([A-Z]{2,5})\b\s*(?:是|指|即|is\b|=|（|\()/gi)) {
      defined.add(match[1].toUpperCase())
    }
    const hits: string[] = []
    const seen = new Set<string>()
    for (const match of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
      const token = match[1].toUpperCase()
      if (seen.has(token) || UNIVERSAL_ACRONYM.test(token) || defined.has(token)) continue
      if (token === "IMC") continue
      seen.add(token)
      hits.push(token)
    }
    return hits
  }

  export function assayOntology(text: string, history = ""): "phenocycler" | "imc" | "fingerprinting" | undefined {
    if (isComparison(text)) return undefined
    const blob = `${history}\n${text}`
    if (ASSAY.phenocycler.test(blob)) return "phenocycler"
    if (ASSAY.fingerprinting.test(blob)) return "fingerprinting"
    if (ASSAY.imc.test(blob)) return "imc"
    return undefined
  }

  export function missingImcConfirm(text: string, history = "") {
    if (FACTUAL_ASK.test(text) && text.length < 120) return false
    if (isComparison(text)) return false
    const ontology = assayOntology(text, history)
    if (ontology === "phenocycler" || ontology === "fingerprinting") return false
    if (IMC_CONFIRMED.test(`${history}\n${text}`)) return false
    return IMC_TOKEN.test(text)
  }

  export function missingPlatform(text: string, history = "") {
    if (!PANEL_OR_ASSAY.test(text) || !DESIGN_VERB.test(text)) return false
    if (METHOD_ONLY.test(text) && !/(?:写出|输出|给我一份|交付)/i.test(text)) return false
    if (assayOntology(text, history)) return false
    if (PLATFORM_SAID.test(`${history}\n${text}`)) return false
    if (IMC_TOKEN.test(text) || /\bPCF\b/.test(text)) return false
    if (unresolvedAcronyms(text, history).length > 0) return false
    return true
  }

  export function missingDeliverableForm(text: string) {
    if (!DELIVERABLE.test(text) || FORMAT_SAID.test(text)) return false
    if (METHOD_ONLY.test(text) && !/(?:panel|清单|写出|输出|给我一份|交付)/i.test(text)) return false
    return true
  }

  export function missingDesignAim(text: string, history = "") {
    if (!PANEL_OR_ASSAY.test(text) || !DESIGN_VERB.test(text)) return false
    if (METHOD_ONLY.test(text) && !/(?:写出|输出|给我一份|交付)/i.test(text)) return false
    if (AIM_SAID.test(`${history}\n${text}`)) return false
    return true
  }

  function missingDesignSlot(text: string) {
    if (!PANEL_OR_ASSAY.test(text) || !DESIGN_VERB.test(text)) return false
    if (METHOD_ONLY.test(text) && !/(?:写出|输出|给我一份|交付)/i.test(text)) return false
    return true
  }

  export function missingSpecies(text: string, history = "") {
    if (!missingDesignSlot(text)) return false
    return !SPECIES_SAID.test(`${history}\n${text}`)
  }

  export function missingTissue(text: string, history = "") {
    if (!missingDesignSlot(text)) return false
    return !TISSUE_SAID.test(`${history}\n${text}`)
  }

  /**
   * Conservative deterministic interpretation for the injection boundary.
   * This is not an execution router: it only identifies when an answer needs
   * an auditable scientific qualification. Agent routing itself is
   * handled by TaskProfile.
   */
  export function interpret(opts: { text: string; history?: string[]; filenames?: string[] }): Contract {
    const text = opts.text.trim()
    const prior = opts.history?.join("\n") ?? ""
    const files = opts.filenames ?? []
    const ontology = assayOntology(text, prior)
    const exporting = isExportFollowup(text, prior)
    const knownContext = [
      ...context(`${prior}\n${text}`),
      ...(ontology === "phenocycler" ? ["phenocycler chemistry"] : []),
      ...(ontology === "imc" ? ["imc metal chemistry"] : []),
      ...(ontology === "fingerprinting" ? ["fingerprinting chemistry"] : []),
      ...(exporting ? ["agreed deliverable export"] : []),
    ]
    const correction = /(?:纠正|更正|改为|不是.+而是|actually|correction|i meant)/i.test(text)
    const meta = /(?:你是|你的能力|怎么回答|what can you do|how do you respond)/i.test(text)
    const literature = /(?:文献|论文|引用|研究表明|paper|citation|literature|evidence shows)/i.test(text)
    const design =
      /(?:实验设计|研究设计|随机|对照|重复|样本量|study design|experiment design|randomi[sz]|replicat)/i.test(text)
    const inference =
      /(?:因果|导致|影响|效果|显著|统计|回归|相关|causal|effect|significant|statistic|regression|association)/i.test(
        text,
      )
    const analysis =
      /(?:分析(?:这(?:个)?|该|我的)?数据|运行分析|计算|拟合模型|analy[sz]e (?:this|my|the) data|run (?:an )?analysis|fit (?:a )?model)/i.test(
        text,
      )
    const execution = /(?:执行|运行|处理(?:这个|该)?文件|run|execute|process (?:this|the) file)/i.test(text)
    const coordinate = /(?:并行|分别交付|多个交付物|parallel|separate deliverables|dependent tasks)/i.test(text)
    const highImpact = /(?:临床|患者|诊断|治疗决策|政策|clinical|patient|diagnos|treatment decision|policy)/i.test(text)
    const gates: RigorGate[] = [
      ...(literature ? ["literature" as const] : []),
      ...(inference || knownContext.includes("comparison") ? ["inference" as const] : []),
      ...(design ? ["experiment" as const] : []),
      ...(analysis || execution ? ["data" as const] : []),
    ]
    const hasData = files.length > 0
    const actionable = !exporting && (DELIVERABLE.test(text) || analysis || execution)
    const terms = actionable ? unresolvedAcronyms(text, prior) : []
    const missingPremises = exporting
      ? []
      : [
          ...(analysis || execution ? (hasData ? [] : ["data location, variables, or analysis target"]) : []),
          ...(inference ? (knownContext.includes("comparison") ? [] : ["comparison or intervention definition"]) : []),
          ...terms.map((token) => `meaning of ${token}`),
          ...(actionable && missingImcConfirm(text, prior) ? [IMC_CONFIRM] : []),
          ...(actionable && missingPlatform(text, prior) ? [PLATFORM_SLOT] : []),
          ...(missingDesignAim(text, prior)
            ? ["scientific aim (general vs T-biased vs B/TLS vs myeloid vs tumor-stroma)"]
            : []),
          ...(missingSpecies(text, prior) ? [SPECIES_SLOT] : []),
          ...(missingTissue(text, prior) ? [TISSUE_SLOT] : []),
          ...(missingDeliverableForm(text) ? ["deliverable form (table / Excel / markdown / figure)"] : []),
        ]
    const intent: InteractionIntent = correction
      ? "correction"
      : exporting
        ? "execution"
        : meta
          ? "meta_conversation"
          : analysis
            ? "data_analysis"
            : execution
              ? "execution"
              : literature
                ? "literature_verification"
                : design
                  ? "research_design"
                  : inference
                    ? "exploration"
                    : "direct_answer"

    return {
      intent,
      confidence: text ? 0.75 : 0,
      knownContext,
      missingPremises,
      mustClarify: missingPremises.length > 0,
      gates,
      coordinate,
      review: highImpact || (inference && /\d/.test(text)),
    }
  }

  // ===== PUBLIC API =====
  function domainFromFilenames(names: string[]): string | undefined {
    if (names.some((n) => BIOLOGY_FILE.test(n))) return "biology"
    if (names.some((n) => /\.(pt|pth|onnx|safetensors|ckpt|weights)/i.test(n))) return "ml"
    if (names.some((n) => /\.(dat|inp|msh|geo|stl)/i.test(n))) return "physics"
    return undefined
  }

  export function detect(text: string): Intent {
    return regexDetect(text)
  }

  /** Generate recommendation from classification result. */
  export function recommend(opts: { current: string; text: string; filenames?: string[] }): Recommendation {
    const intent = regexDetect(opts.text)
    const domain = domainFromFilenames(opts.filenames ?? [])

    const mapping: Record<Intent, Recommendation> = {
      literature_review: { agent: "research", reason: "Literature review intent detected", tier: "pro" },
      exploratory_analysis: {
        agent:
          domain === "ml" ? "ml" : domain === "physics" ? "physics" : domain === "biology" ? "biology" : "research",
        reason: "Exploratory analysis intent detected",
        tier: "fast",
      },
      hypothesis_testing: {
        agent: "research",
        reason: "Hypothesis testing intent detected",
        tier: "ultra",
      },
      method_development: {
        agent: domain === "ml" ? "ml" : domain === "physics" ? "physics" : "research",
        reason: "Method development intent detected",
        tier: "pro",
      },
      result_synthesis: { agent: "research", reason: "Result synthesis intent", tier: "pro" },
      code_debugging: { agent: "research", reason: "Code debugging — lightweight path", tier: "fast" },
      general: {
        agent: domain
          ? domain === "biology"
            ? "biology"
            : domain === "ml"
              ? "ml"
              : domain === "physics"
                ? "physics"
                : opts.current
          : opts.current,
        reason: "No specific intent, keeping current agent",
        tier: "fast",
      },
    }

    return mapping[intent]
  }

  export function advice(rec: Recommendation): string {
    const tierStr = rec.tier ? ` tier="${rec.tier}"` : ""
    return [
      `<agent-router recommendation="${rec.agent}" reason="${rec.reason}"${tierStr}>`,
      `Agent router suggests: agent=${rec.agent}${rec.tier ? `, tier=${rec.tier}` : ""}, reason=${rec.reason}`,
      `Use agent: "${rec.agent}" in your next message to switch.`,
      `</agent-router>`,
    ].join("\n")
  }

  const PRIMARY = new Set(["research", "biology", "physics", "ml"])

  /** Should we recommend switching from the current agent? */
  export function shouldSwitch(current: string, rec: Recommendation): boolean {
    if (rec.agent === current) return false
    if (current === "plan") return false
    if (PRIMARY.has(current) && PRIMARY.has(rec.agent)) return false
    return rec.agent !== ""
  }
}
