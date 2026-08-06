/**
 * Adaptive Agent Router v2 — LLM-based semantic intent classification
 * with regex fallback. Routes user input to the best agent + model tier,
 * and recommends whether to search, query databases, or run analysis tools.
 *
 * Uses a cheap/small model for classification (~200 tokens, <1s latency).
 * Falls back to regex matching if the LLM is unavailable.
 */

import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import { LLM } from "./llm"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"

export namespace AgentRouter {
  const log = Log.create({ service: "agent-router" })

  export type Intent =
    | "literature_review"
    | "exploratory_analysis"
    | "hypothesis_testing"
    | "method_development"
    | "result_synthesis"
    | "code_debugging"
    | "general"

  export type ToolCategory = "web_search" | "bio_db" | "file_analysis" | "gpu_compute" | "literature" | "none"

  export type Classification = {
    intent: Intent
    agent: string
    tier: "fast" | "pro" | "ultra"
    shouldSearch: boolean
    tools: ToolCategory[]
    reason: string
    confidence: number
  }

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

  // ===== REGEX FALLBACK (unchanged from v1) =====
  const SIGNALS: Record<Intent, { pattern: RegExp; weight: number }[]> = {
    literature_review: [
      {
        pattern: /\b(literature\s*review|systematic\s*review|prisma|meta.analysis|survey|state\s*of\s*the\s*art)\b/i,
        weight: 3,
      },
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

  // ===== LLM-BASED CLASSIFICATION =====
  const CLASSIFY_PROMPT = [
    "Classify the user's research intent. Reply ONLY with JSON:",
    "{",
    '  "intent": "<literature_review|exploratory_analysis|hypothesis_testing|method_development|result_synthesis|code_debugging|general>",',
    '  "agent": "<research|biology|physics|ml|plan>",',
    '  "tier": "<fast|pro|ultra>",',
    '  "confidence": <0.0-1.0>',
    "}",
    "",
    "Rules:",
    "- literature_review: finding/summarizing papers, systematic reviews, meta-analysis",
    "- exploratory_analysis: exploring data, clustering, QC, preprocessing, visualization",
    "- hypothesis_testing: statistical tests, validating claims, differential analysis, comparing groups",
    "- method_development: building models, training ML, designing pipelines, developing tools",
    "- result_synthesis: summarizing results, writing reports/manuscripts, making figures",
    "- code_debugging: fixing errors, debugging, troubleshooting",
    "- general: none of the above",
    "",
    'agent: "research" for general science, "biology" for bioinformatics/genomics, "physics" for simulation/PDEs, "ml" for ML/AI tasks, "plan" for planning',
    'tier: "fast" for simple/short tasks, "pro" for moderate, "ultra" for complex multi-step research',
    "confidence: 0.9+ for clear intent, 0.5-0.8 for ambiguous, <0.5 for uncertain",
  ].join("\n")

  async function llmClassify(text: string, filenames: string[]): Promise<Classification | undefined> {
    const startTime = Date.now()
    try {
      const model = await Provider.getSmallModel("openai").catch(() => undefined)
      if (!model) return undefined

      const msg = text.slice(0, 2000) + (filenames.length > 0 ? "\nFiles: " + filenames.join(", ") : "")
      const result = await LLM.stream({
        user: {
          id: "router-msg",
          role: "user",
          sessionID: "router",
          time: { created: Date.now() },
          agent: "research",
          model: { providerID: "anthropic", modelID: "claude-haiku-4-5" },
        } as any,
        sessionID: "router",
        model,
        agent: { name: "research", mode: "primary", permission: [], steps: 1 } as any,
        system: [CLASSIFY_PROMPT],
        messages: [{ role: "user", content: msg }],
        tools: {},
        small: true,
        abort: (() => {
          const c = new AbortController()
          setTimeout(() => c.abort(), 8000)
          return c.signal
        })(),
        retries: 0,
      })

      let response = ""
      for await (const chunk of result.textStream) {
        response += chunk
      }

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return undefined
      const parsed = JSON.parse(jsonMatch[0]) as {
        intent?: string
        agent?: string
        tier?: string
        confidence?: number
      }

      const validIntents = new Set([
        "literature_review",
        "exploratory_analysis",
        "hypothesis_testing",
        "method_development",
        "result_synthesis",
        "code_debugging",
        "general",
      ])
      const validAgents = new Set(["research", "biology", "physics", "ml", "plan"])
      const validTiers = new Set(["fast", "pro", "ultra"])

      const intent = validIntents.has(parsed.intent ?? "") ? (parsed.intent as Intent) : "general"
      const agent = validAgents.has(parsed.agent ?? "") ? parsed.agent! : "research"
      const tier = validTiers.has(parsed.tier ?? "") ? (parsed.tier as "fast" | "pro" | "ultra") : "pro"
      const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5

      log.info("llm classify", { intent, agent, tier, confidence, duration: Date.now() - startTime })

      return {
        intent,
        agent,
        tier,
        shouldSearch: intent === "literature_review",
        tools: toolsForIntent(intent),
        reason: `LLM intent classification: ${intent} (${(confidence * 100).toFixed(0)}% confidence)`,
        confidence,
      }
    } catch (err) {
      log.warn("llm classify failed, falling back to regex", { error: String(err), duration: Date.now() - startTime })
      return undefined
    }
  }

  function toolsForIntent(intent: Intent): ToolCategory[] {
    const mapping: Record<Intent, ToolCategory[]> = {
      literature_review: ["web_search", "literature"],
      exploratory_analysis: ["file_analysis", "bio_db"],
      hypothesis_testing: ["file_analysis", "bio_db"],
      method_development: ["gpu_compute", "file_analysis"],
      result_synthesis: ["none"],
      code_debugging: ["file_analysis"],
      general: ["web_search"],
    }
    return mapping[intent] ?? []
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

  /**
   * Conservative deterministic interpretation for the injection boundary.
   * This is not an execution router: it only identifies when an answer needs
   * an auditable scientific qualification. The LLM classifier remains the
   * primary agent-routing path in classify().
   */
  export function interpret(opts: { text: string; history?: string[]; filenames?: string[] }): Contract {
    const text = opts.text.trim()
    const prior = opts.history?.join("\n") ?? ""
    const files = opts.filenames ?? []
    const knownContext = context(`${prior}\n${text}`)
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
    const missingPremises = [
      ...(analysis || execution ? (hasData ? [] : ["data location, variables, or analysis target"]) : []),
      ...(inference ? (knownContext.includes("comparison") ? [] : ["comparison or intervention definition"]) : []),
    ]
    const intent: InteractionIntent = correction
      ? "correction"
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
      mustClarify: (analysis || execution) && !hasData,
      gates,
      coordinate,
      review: highImpact || (inference && /\d/.test(text)),
    }
  }

  // ===== PUBLIC API =====
  function domainFromFilenames(names: string[]): string | undefined {
    if (names.some((n) => /\.(vcf|bcf|bam|fastq|fq|h5ad|loom|pdb|cif|mzml|sdf|mol)/i.test(n))) return "biology"
    if (names.some((n) => /\.(pt|pth|onnx|safetensors|ckpt|weights)/i.test(n))) return "ml"
    if (names.some((n) => /\.(dat|inp|msh|geo|stl)/i.test(n))) return "physics"
    return undefined
  }

  /** Main entry: classify intent using LLM, fall back to regex. */
  export async function classify(opts: { text: string; filenames?: string[] }): Promise<Classification> {
    // Try LLM first
    const llmResult = await llmClassify(opts.text, opts.filenames ?? [])
    if (llmResult && llmResult.confidence >= 0.6) return llmResult

    // Fall back to regex
    const intent = regexDetect(opts.text)
    const domain = domainFromFilenames(opts.filenames ?? [])
    const agent =
      intent === "exploratory_analysis"
        ? domain === "biology"
          ? "biology"
          : domain === "ml"
            ? "ml"
            : "research"
        : intent === "method_development"
          ? domain === "ml"
            ? "ml"
            : "research"
          : intent === "code_debugging"
            ? "research"
            : "research"

    const tier =
      intent === "hypothesis_testing"
        ? "ultra"
        : intent === "literature_review" || intent === "method_development" || intent === "result_synthesis"
          ? "pro"
          : "fast"

    return {
      intent,
      agent,
      tier,
      shouldSearch: intent === "literature_review",
      tools: toolsForIntent(intent),
      reason: `Regex intent classification: ${intent}`,
      confidence: 0.4,
    }
  }

  /** @deprecated — use classify() instead */
  export function detect(text: string): Intent {
    return regexDetect(text)
  }

  /** Generate recommendation from classification result. */
  export function recommend(opts: { current: string; text: string; filenames?: string[] }): Recommendation {
    // Synchronous version for backward compat — uses regex only
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

  /** Should we recommend switching from the current agent? */
  export function shouldSwitch(current: string, rec: Recommendation): boolean {
    if (rec.agent === current) return false
    if (current === "plan") return false
    return rec.agent !== ""
  }
}
