import path from "path"
import fs from "fs/promises"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { AgentRouter } from "./agent-router"
import { ExperimentDesign } from "./experiment-design"
import { StatsCheck } from "./stats-check"
import { CrossValidate } from "./cross-validate"
import { LiteratureCheck } from "./literature-check"
import { MetaAnalysis } from "./meta-analysis"
import { CausalInference } from "./causal"
import { ActiveLearn } from "./active-learn"
import { DataQuality } from "./data-quality"
import { TaskProfile } from "./task-profile"
import { Coordinator } from "./coordinator"
import { ProjectMemory } from "./project-memory"
import { ResearchContext } from "./research-context"
import { TaskDecisionState } from "./task-decisions"
import { TaskScope } from "./task-scope"
import { Session } from "."
import { Config } from "../config/config"
import { ComputeSettings } from "../server/routes/settings/compute"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import PROMPT_PLAN_ENTER from "../session/prompt/plan-enter.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import RESULT_DELIVERY from "../session/prompt/result-delivery.txt"
import BIOLOGY_SERVICE_CONTRACT from "../agent/prompt/biology-service-contract.txt"

const log = Log.create({ service: "prompt-inject" })

const STATS_RE =
  /\b(statistics?|statistical|p-value|p value|fdr|padj|fold change|differential|enrichment|effect size|significance|hypothesis test|anova|regression|correlation|chi-square|t-test|wilcoxon|survival)\b/i
const DATA_RE =
  /\b(dataset|dataframe|matrix|expression|counts|vcf|bam|h5ad|fastq|rds|parquet|csv|tsv|missing|quality control|\bqc\b|normalize|batch effect)\b/i
const DESIGN_RE =
  /\b(experiment design|study design|control group|treatment group|randomization|blocking|replicate|confounding|sample size|power analysis|comparison group|分组|对照|重复|样本量)\b/i
const LIT_RE =
  /\b(literature|literature review|paper|publication|citation|pubmed|research-lookup|related work|prior art|review)\b/i
const CAUSAL_RE = /\b(cause|causal|effect of|leads to|due to|because|increases|decreases|mediat|confound)\b/i
const META_RE = /\b(meta.?analysis|pooled effect|heterogeneity|i\^2|tau\^2|forest plot|systematic review)\b/i
const ACTIVE_RE =
  /\b(active learning|uncertainty sampling|entropy sampling|unlabeled|prediction confidence|low.confidence|labels? to select|采样|主动学习)\b/i
const CORRECTION_RE =
  /(纠正|更正|不是|改为|改成|换成|应该是|其实|实际上|wait|correction|actually|\bi mean\b|not\s+.*\s+but)/i
const SESSION_PARAMS: Array<[string, RegExp]> = [
  ["species", /\b(human|mouse|rat|zebrafish|pig|monkey|macaque)\b|小鼠|大鼠|人|斑马鱼|猪|猴/i],
  [
    "modality",
    /\b(single-cell|scRNA|snRNA|spatial|proteom|DIA|TMT|metabolom|TCR|multi-omics)\b|单细胞|空间|蛋白组|代谢组|免疫组|多组学/i,
  ],
  [
    "platform",
    /\b(10X|10x|Chromium|Visium|Smart-seq|SmartSeq|DIA|TMT|label-free|NovaSeq|NextSeq|Illumina|BD Rhapsody)\b/i,
  ],
  ["groups", /\b(control|treatment|treated|model|disease|normal|vehicle)\b|对照组?|造模组?|病例|健康组?/i],
]

export function injectBiologyServiceContract(userMessage: MessageV2.WithParts) {
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text === BIOLOGY_SERVICE_CONTRACT))
    return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: BIOLOGY_SERVICE_CONTRACT,
    hybio: true,
  })
}

export function injectResultDelivery(userMessage: MessageV2.WithParts) {
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text === RESULT_DELIVERY)) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: RESULT_DELIVERY,
    hybio: true,
  })
}

export function injectAgentRouter(userMessage: MessageV2.WithParts, agent: Agent.Info) {
  const key = "agent-router"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p))
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 10) return
  const fileParts = userMessage.parts.filter((p) => p.type === "file")
  const filenames = fileParts.map((p) => p.filename ?? "").filter(Boolean)
  const rec = AgentRouter.recommend({ current: agent.name, text, filenames })
  if (!AgentRouter.shouldSwitch(agent.name, rec)) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: AgentRouter.advice(rec),
    hybio: true,
  })
}

export function injectExperimentDesign(userMessage: MessageV2.WithParts) {
  const key = "experiment-design"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  const advice = ExperimentDesign.analyze(text)
  if (!advice) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: advice.hybio,
    hybio: true,
  })
}

export function injectStatsCheck(userMessage: MessageV2.WithParts) {
  const key = "stats-check"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 20) return
  const issues = StatsCheck.analyze(text)
  if (issues.length === 0) return
  const hybio = StatsCheck.formatHybio(issues)
  if (!hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export function injectDataQuality(userMessage: MessageV2.WithParts) {
  const key = "data-quality"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 20) return
  const issues = DataQuality.analyze(text)
  if (issues.length === 0) return
  const hybio = DataQuality.formatHybio(issues)
  if (!hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export function injectHypothesisContext(userMessage: MessageV2.WithParts) {
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 30) return
  const HYPI = [
    "<system-reminder>",
    "## Hypothesis-Driven Analysis",
    "Structure your analysis around testable hypotheses. For every claim, formulate:",
    "",
    "1. **H0 (Null)**: The default/no-effect statement",
    "2. **H1 (Alternative)**: The effect/difference you expect to find",
    "",
    "Report hypotheses using this format:",
    "```",
    '<hypothesis id="H1">',
    "  <h0>There is no difference in expression between groups</h0>",
    "  <h1>Gene X is differentially expressed between condition A and B</h1>",
    "  <method>t-test (two-sided, unpaired)</method>",
    "  <metrics>log2FC, p-value, FDR</metrics>",
    "  <threshold>0.05</threshold>",
    "</hypothesis>",
    "```",
    "",
    "After testing, report results:",
    "```",
    '<hypothesis_result id="H1">',
    "  <observed>0.003</observed>",
    "  <threshold>0.05</threshold>",
    "  <sample_size>48</sample_size>",
    "  <effect_size>1.2</effect_size>",
    "  <conclusion>reject_h0</conclusion>",
    "  <notes>Significant upregulation in condition A (log2FC=2.1)</notes>",
    "</hypothesis_result>",
    "```",
    "Track ALL hypotheses through your analysis. Report which are supported, rejected, or inconclusive.",
    "</system-reminder>",
  ].join("\n")
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: HYPI,
    hybio: true,
  })
}

export async function injectLiteratureCheck(userMessage: MessageV2.WithParts) {
  const key = "literature-contradiction-check"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 100) return
  const report = await LiteratureCheck.detect(text).catch(() => undefined)
  if (!report?.hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: report.hybio,
    hybio: true,
  })
}
export function injectCausalCheck(userMessage: MessageV2.WithParts) {
  const key = "causal-inference"
  if (userMessage.parts.some((p) => p.type === "text" && p.hybio && p.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 100) return
  const claims = CausalInference.detectCausalClaims(text)
  if (claims.length === 0) return
  const vars = CausalInference.extractVariables(text)
  const graph = CausalInference.buildDAG(vars, claims)
  const hybio = CausalInference.formatHybio(claims, graph)
  if (!hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export function injectActiveLearning(userMessage: MessageV2.WithParts) {
  const key = "active-learning"
  if (userMessage.parts.some((p) => p.type === "text" && p.hybio && p.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 100) return
  const samples = ActiveLearn.parsePredictions(text)
  if (samples.length < 5) return
  const unl = samples.filter((s) => s.unlabeled).length
  if (unl === 0) return
  const rec =
    unl > 10 ? ActiveLearn.hybridSampling(samples, 5) : ActiveLearn.uncertaintySampling(samples, Math.min(unl, 5))
  const hybio = ActiveLearn.formatHybio(rec, samples.length, unl)
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export async function injectMetaAnalysis(userMessage: MessageV2.WithParts, sessionId: string) {
  const key = "meta-analysis"
  if (userMessage.parts.some((p) => p.type === "text" && p.hybio && p.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 200) return
  const hybio = await MetaAnalysis.scanSession(sessionId, text)
  if (!hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export function injectCrossValidate(userMessage: MessageV2.WithParts) {
  const key = "cross-database-validation"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 100) return
  const claims = CrossValidate.extractClaims(text)
  if (claims.length === 0) return
  const report = CrossValidate.validate(claims)
  if (!report.hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: report.hybio,
    hybio: true,
  })
}
export function injectRefineLoop(userMessage: MessageV2.WithParts) {
  const key = "refine-loop"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const RF = [
    '<system-reminder id="refine-loop">',
    "## Self-Refinement Loop",
    "After completing your analysis, perform a self-critique before delivering the final answer:",
    "",
    "1. **Re-read your analysis**. Check for:",
    "   - Data errors (wrong column names, missing values, incorrect types)",
    "   - Statistical errors (p-hacking, uncorrected multiple comparisons, missing effect sizes)",
    "   - Logical gaps (conclusions not supported by the data)",
    "   - Biological sense (do results contradict known biology? Check databases)",
    "2. **Run one correction pass** if you find issues. Do NOT restart from scratch.",
    "3. **Mark your self-check** with: `[SELF-CHECK PASSED]` or `[SELF-CHECK: fixed N issues]`",
    "",
    "This is NOT optional. Every answer must include a self-check notation.",
    "</system-reminder>",
  ].join("\n")
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: RF,
    hybio: true,
  })
}

export function injectErrorRecovery(messages: MessageV2.WithParts[], userMessage: MessageV2.WithParts) {
  const key = "error-recovery"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const lastAssistant = messages.findLast((m) => m.info.role === "assistant")
  if (!lastAssistant) return
  const errored = lastAssistant.parts.filter(
    (p): p is MessageV2.ToolPart => p.type === "tool" && (p as MessageV2.ToolPart).state?.status === "error",
  )
  if (errored.length === 0) return
  const errorMsgs = errored
    .map((p) => {
      const toolName = p.tool ?? "unknown"
      const st = p.state
      const error = st.status === "error" ? st.error : "unknown error"
      return `  ${toolName}: ${error}`
    })
    .join("\n")
  const advice = [
    "<error-recovery>",
    "The following tool calls failed in the last turn. Do NOT retry the same command unchanged.",
    errorMsgs,
    "",
    "Recovery strategy:",
    "1. Analyze the error message and identify the root cause.",
    "2. Fix the issue (correct path, install dependency, fix syntax).",
    "3. Re-run ONLY the failed operation — not the entire workflow.",
    "4. If the same error occurs twice, try a different approach.",
    "</error-recovery>",
  ].join("\n")
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: advice,
    hybio: true,
  })
}

export function injectProjectResearch(userMessage: MessageV2.WithParts) {
  const context = TaskProfile.context(Instance.project.research)
  if (!context) return
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text === context)) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: context,
    hybio: true,
  })
}

export async function injectLocale(userMessage: MessageV2.WithParts, locale: string) {
  const code = locale.toLowerCase()
  const lang =
    code === "zht" || code === "zh-tw" || code.startsWith("zht")
      ? "Chinese (Traditional)"
      : code.startsWith("zh")
        ? "Chinese (Simplified)"
        : code === "ja"
          ? "Japanese"
          : code === "ko"
            ? "Korean"
            : code === "de"
              ? "German"
              : code === "fr"
                ? "French"
                : code === "es"
                  ? "Spanish"
                  : code === "ru"
                    ? "Russian"
                    : "English"
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: `<system-reminder>UI locale=${locale}. Write user-facing replies in ${lang}. Keep gene symbols, cluster ids (C0), file names, code, CLI commands, and scientific nomenclature in English / Latin script. When writing annotation xlsx via annotation_report.py, pass --locale ${locale}.</system-reminder>`,
    hybio: true,
  })
}

export async function injectLiteratureGate(userMessage: MessageV2.WithParts) {
  const candidates = ["literature-review.md", path.join(".context", "literature-review.md")]
  const present = await Promise.all(
    candidates.map(async (rel) => {
      const full = path.join(Instance.directory, rel)
      try {
        await fs.access(full)
        return rel
      } catch {
        return undefined
      }
    }),
  )
  const hit = present.find(Boolean)
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hit
      ? `<system-reminder>Stage gate: literature-review.md found at \`${hit}\`. You may proceed past LITERATURE. Still call provenance_record for new figures/tables/datasets.</system-reminder>`
      : `<system-reminder>BLOCKING stage gate: \`literature-review.md\` is missing in the working directory. Before REASON / METHODOLOGY / COMPUTE: spawn parallel literature-review sub-agents, synthesize, and write \`literature-review.md\`. Only skip if the user explicitly waived literature.</system-reminder>`,
    hybio: true,
  })
}

export async function injectComputeTier(userMessage: MessageV2.WithParts) {
  const tier = await ComputeSettings.getExecution().catch(() => "local" as const)
  const hosts = await ComputeSettings.listSshHosts().catch(() => [])
  const text =
    tier === "ssh"
      ? `<system-reminder>Compute execution tier: SSH / Slurm. Prefer the \`remote\` tool on configured hosts (${hosts.length ? hosts.map((h) => h.label).join(", ") : "none configured — ask user to add one in Settings → Compute"}). For batch GPU/CPU jobs use skill \`slurm-hpc\` (sbatch/squeue). Local bash/notebook only for light prep. Cloud BYOK skills only if the user asks.</system-reminder>`
      : tier === "cloud"
        ? `<system-reminder>Compute execution tier: Cloud. Prefer Modal / TensorPool / Lambda / Tinker skills for GPU work. Get cost approval before spend. Local bash/notebook for light prep only. Use \`remote\`/Slurm only if the user points at a cluster.</system-reminder>`
        : `<system-reminder>Compute execution tier: Local. Prefer bash, notebook, and rkernel on this machine for analysis. For heavy GPU or institutional HPC, ask the user to switch Settings → Compute execution to Cloud or SSH/Slurm (or use those tools if they explicitly request).</system-reminder>`
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text,
    hybio: true,
  })
}

export async function injectTaskProfile(userMessage: MessageV2.WithParts) {
  const texts = userMessage.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
  const filenames = userMessage.parts
    .filter((p): p is MessageV2.FilePart => p.type === "file")
    .map((p) => p.filename || "")
    .filter(Boolean)
  const fragment = TaskProfile.fragment(Instance.project.research, { text: texts, filenames })
  if (!fragment) return
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text === fragment)) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: fragment,
    hybio: true,
  })
}

export function injectCoordinatorPlan(userMessage: MessageV2.WithParts) {
  const key = "coordinator-plan"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 60) return
  const plan = Coordinator.decompose(text)
  if (plan.subtasks.length <= 1) return
  const formatted = Coordinator.formatPlan(plan)
  if (!formatted) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: formatted,
    hybio: true,
  })
}

export async function injectProjectMemory(userMessage: MessageV2.WithParts) {
  const key = "project-memory"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 30) return
  const entries = await ProjectMemory.recall(text, 3)
  if (entries.length === 0) return
  const formatted = ProjectMemory.formatRecall(entries)
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: formatted,
    hybio: true,
  })
}

function pushHybioText(userMessage: MessageV2.WithParts, text: string) {
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text === text)) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text,
    hybio: true,
  })
}

function userText(messages: MessageV2.WithParts[]): string[] {
  return messages
    .filter((msg) => msg.info.role === "user")
    .map((msg) =>
      msg.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map((p) => p.text)
        .join(" "),
    )
    .filter(Boolean)
}

export function injectCorrectionContext(messages: MessageV2.WithParts[], userMessage: MessageV2.WithParts) {
  const texts = userText(messages)
  const current = texts.at(-1) ?? ""
  const previous = texts.at(-2)
  if (!previous || !CORRECTION_RE.test(current)) return
  pushHybioText(
    userMessage,
    [
      "<interaction-correction>",
      "The latest user message corrects or replaces an earlier assumption. Treat it as authoritative.",
      "Re-read the current task and update species, platform, modality, groups, thresholds, and other parameters.",
      "Do not repeat the old value or design the workflow around it.",
      "</interaction-correction>",
    ].join("\n"),
  )
}

export function injectSessionContext(messages: MessageV2.WithParts[], userMessage: MessageV2.WithParts) {
  const found = new Map<string, string>()
  for (const text of userText(messages)) {
    for (const [key, re] of SESSION_PARAMS) {
      const match = text.match(re)
      if (match) found.set(key, match[0])
    }
  }
  if (found.size === 0) return
  const lines = [
    "<session-context>",
    "Known conversation parameters (latest user message wins):",
    ...[...found.entries()].map(([key, value]) => `- ${key}: ${value}`),
    "Use these as active working assumptions. If the user later corrects a value, replace it and update downstream analysis.",
    "</session-context>",
  ]
  pushHybioText(userMessage, lines.join("\n"))
}

export function injectMultiQuestion(userMessage: MessageV2.WithParts) {
  const text = userMessage.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .join(" ")
  const questionMarks = (text.match(/[?？]/g) ?? []).length
  const numbered = (text.match(/(?:^|\n)\s*\d+[.、）)]/g) ?? []).length
  if (questionMarks + numbered < 2) return
  pushHybioText(
    userMessage,
    [
      "<multi-question>",
      "The user asked multiple questions. Answer each one separately with a clear label (Q1/Q2/...).",
      "Do not merge them or omit any. If a question needs clarification, say so per question.",
      "</multi-question>",
    ].join("\n"),
  )
}

export function injectResearchContract(messages: MessageV2.WithParts[], userMessage: MessageV2.WithParts) {
  const text = userMessage.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.hybio)
    .map((part) => part.text)
    .join(" ")
  const history = userText(messages).slice(0, -1)
  const filenames = userMessage.parts
    .filter((part): part is MessageV2.FilePart => part.type === "file")
    .map((part) => part.filename ?? "")
    .filter(Boolean)
  const contract = AgentRouter.interpret({ text, history, filenames })
  const lines = [
    `<research-intent intent="${contract.intent}" confidence="${contract.confidence}">`,
    "Answer the user's substantive request before asking questions. Preserve explicit constraints and let the latest correction replace prior assumptions.",
    "Separate facts, inferences, hypotheses, recommendations, and unknowns. Correct unsupported premises with evidence or a plausible alternative; do not simply accept them.",
    "Keep the final answer separate from internal execution: present conclusion-relevant evidence, limitations, and next steps, not prompts, orchestration, sub-agents, tools, retries, timeouts, or internal files. If the user explicitly asks about progress, failure, or reproduction, describe completed scope, observable limits, and reproducible steps in user-understandable terms.",
  ]

  if (contract.knownContext.length > 0) {
    lines.push(
      `Known context: ${contract.knownContext.join(", ")}. Do not ask for it again unless it conflicts with the current request.`,
    )
  }
  if (contract.mustClarify) {
    lines.push(
      `Execution is blocked only by: ${contract.missingPremises.join("; ")}. State what can be answered generally, then use the question tool (max 1-2 focused questions) to collect only this missing information — do not proceed with fabricated inputs.`,
    )
  }
  if (contract.gates.includes("literature")) {
    lines.push(
      "Literature conclusions require traceable sources. Without one, label the statement as unverified rather than established.",
    )
  }
  if (contract.gates.includes("inference")) {
    lines.push(
      "For statistical or causal claims, state applicable limits from the research question, data source, unit, sample size, controls/confounding, and uncertainty. Ask only for omissions that change the conclusion.",
    )
  }
  if (contract.gates.includes("experiment")) {
    lines.push(
      "For experiment design, distinguish exploratory from confirmatory work and include a falsifiable hypothesis, controls, endpoint, and failure condition.",
    )
  }
  if (contract.gates.includes("data") && !contract.mustClarify) {
    lines.push(
      "For data analysis, verify the available data, variable definitions, and analysis target before executing; a general methods question remains answerable without files.",
    )
  }
  if (contract.coordinate) {
    lines.push(
      "The user explicitly requested parallel or dependent deliverables. Create a plan only for those dependencies; otherwise answer directly without orchestration.",
    )
  }
  if (contract.review) {
    lines.push(
      "Before presenting critical numbers, figures, citations, statistical conclusions, or high-impact decisions, perform a focused consistency review.",
    )
  }
  lines.push("</research-intent>")
  pushHybioText(userMessage, lines.join("\n"))
}

async function applyDynamicInjections(
  input: { messages: MessageV2.WithParts[]; agent: Agent.Info; session: Session.Info },
  userMessage: MessageV2.WithParts,
) {
  const agentText = input.agent.promptText ?? ""
  const messages = TaskScope.messages(input.messages, input.session.taskScope)

  const note = (name: string) => log.info("prompt-inject", { sessionID: input.session.id, name })

  if (input.agent.promptText) {
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: agentText,
      hybio: true,
    })
    note("agent-prompt")
  }

  const locale = (() => {
    for (const part of userMessage.parts) {
      if (part.type !== "text") continue
      const m = part.text.match(/<ui-locale\s+code="([^"]+)"/i)
      if (m) return m[1]
    }
    return undefined
  })()
  const task = TaskScope.current(input.session.taskScope)
  const decisions = task
    ? locale
      ? await TaskDecisionState.setLocale(input.session.id, task.id, locale)
      : await TaskDecisionState.load(input.session.id, task.id)
    : undefined
  const language = locale ?? decisions?.locale
  if (language) {
    await injectLocale(userMessage, language)
    note("locale")
  }

  if (input.agent.gates?.includes("compute")) {
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: "<system-reminder>Run GPU/training work on the user's connected providers (Modal, Tinker, TensorPool, …) via the cloud-compute skills. Get cost approval before launching paid jobs.</system-reminder>",
      hybio: true,
    })
    note("billing-mode")
  }

  if (input.agent.gates?.includes("compute")) {
    await injectComputeTier(userMessage)
    note("compute-tier")
  }
  if (input.agent.gates?.includes("task_profile")) {
    await injectTaskProfile(userMessage)
    note("task-profile")
  }

  const scope = TaskScope.context(input.session.taskScope)
  if (scope) pushHybioText(userMessage, scope)
  if (task && decisions) {
    await injectTaskDecisions(userMessage, input.session.id, task.id, decisions, input.session.taskScope)
    note("task-decisions")
  }
  injectCorrectionContext(messages, userMessage)
  note("correction-context")
  injectSessionContext(messages, userMessage)
  note("session-context")
  injectMultiQuestion(userMessage)
  note("multi-question")
  injectErrorRecovery(messages, userMessage)
  note("error-recovery")
  const researchAgents = ["research", "biology", "physics", "ml"]
  if (researchAgents.includes(input.agent.name)) {
    injectInteractionContract(userMessage)
    note("interaction-contract")
    injectResultDelivery(userMessage)
    injectResearchContract(messages, userMessage)
    if (input.agent.name === "biology") {
      injectDataGate(userMessage)
      note("data-gate")
    }
    if (task) await injectResearchContext(userMessage, input.session.id, task.id)
    note("research-intent")
  }
}

export async function injectTaskDecisions(
  userMessage: MessageV2.WithParts,
  sessionID: string,
  taskID: string,
  state?: TaskDecisionState.State,
  scope?: TaskScope.State,
) {
  const key = "<task-decisions"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const decisions = state ?? (await TaskDecisionState.load(sessionID, taskID))
  const merged =
    scope?.items.filter(
      (item) =>
        scope.currentID === taskID &&
        item.id !== taskID &&
        scope.items.find((current) => current.id === taskID)?.mergedScopeIDs?.includes(item.id),
    ) ?? []
  const references = await Promise.all(
    merged.map(async (item) =>
      TaskDecisionState.format(item.id, await TaskDecisionState.load(sessionID, item.id), true),
    ),
  )
  pushHybioText(userMessage, [TaskDecisionState.format(taskID, decisions), ...references].join("\n"))
}

export async function injectResearchContext(userMessage: MessageV2.WithParts, sessionID: string, taskID: string) {
  const key = "research-context"
  if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(key))) return
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text" && !MessageV2.isHybio(p))
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 10) return
  const entities = await ResearchContext.update(sessionID, taskID, text)
  const report = ResearchContext.evaluate(entities)
  const hybio = ResearchContext.formatContext(entities, report)
  if (!hybio) return
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hybio,
    hybio: true,
  })
}

export function injectInteractionContract(userMessage: MessageV2.WithParts) {
  pushHybioText(
    userMessage,
    [
      '<system-reminder id="interaction-contract">',
      "## User-visible progress and interaction",
      "When extended thinking/reasoning is available, start each major segment with a bold one-line label (e.g. **检查数据文件**) so the UI can show live status.",
      "When execution needs missing files/parameters, an irreversible method choice, or high-impact confirmation, use the question tool (max 1-2 questions per turn) — not only prose asking the user to reply in chat.",
      "Answer what you can first, then ask. Do not block on a checklist when a partial answer is possible.",
      "</system-reminder>",
    ].join("\n"),
  )
}

export function injectDataGate(userMessage: MessageV2.WithParts) {
  const textParts = userMessage.parts.filter((p): p is MessageV2.TextPart => p.type === "text")
  const text = textParts.map((p) => p.text).join(" ")
  if (!text || text.length < 10) return
  const fileParts = userMessage.parts.filter((p): p is MessageV2.FilePart => p.type === "file")
  const hasFiles = fileParts.length > 0

  // Planning intent — user is asking for advice, not requesting analysis on data
  const planningRe =
    /(?:打算|计划|准备|想要|考虑|可能|也许|还没有|还没做|先了解|设计|方案|思路|怎么(?:做|分析)|如何(?:做|分析)|推荐|建议|protocol|experimental.design)/i
  if (planningRe.test(text)) {
    const lines = [
      '<system-reminder id="planning-mode">',
      "## PLANNING MODE",
      "User is in planning/discussion mode. Follow the 4 core principles in your base prompt:",
      "准则1: Respond to their core question FIRST. 准则2: Max 1-2 natural follow-ups, never a checklist.",
      "准则3: Use flexible output structure (clarification → solution → caveats → optional Qs).",
      "准则4: Remember all entities mentioned — never re-ask. Allow topic jumps.",
      "Follow 范式 A/B/C/D matching the scenario. Use soft language (通常/一般推荐/建议验证).",
      "</system-reminder>",
    ]
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: lines.join("\n"),
      hybio: true,
    })
    return
  }

  const analysisRe =
    /(?:分析|注释|聚类|降维|差异|QC|预处理|解读|判断|识别|鉴定|predict|classify|cluster|annotat|DEG|differential|normaliz)/i
  const dataRe = /(?:数据|表达矩阵|矩阵|文件|count|matrix|expression|\.(?:csv|h5ad|fastq|fq|bam|vcf|tsv|txt))/i

  if (!analysisRe.test(text)) return
  if (!dataRe.test(text)) return
  if (hasFiles) return

  const lines = [
    '<system-reminder id="data-gate">',
    "## DATA GATE",
    "No data files attached. Use the question tool to ask for file path, format, and key column names (max 1-2 questions).",
    "Do not output analysis results, code, tables, or suggestions until data is available.",
    "</system-reminder>",
  ]
  userMessage.parts.push({
    id: Identifier.ascending("part"),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: lines.join("\n"),
    hybio: true,
  })
}

export async function insertReminders(input: {
  messages: MessageV2.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  await applyDynamicInjections(input, userMessage)

  if (input.agent.gates?.includes("literature")) {
    await injectLiteratureGate(userMessage)
  }

  if (!Flag.HYSCIENCE_EXPERIMENTAL_PLAN_MODE) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        hybio: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name !== "plan") {
      userMessage.parts.push({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        hybio: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const plan = Session.plan(input.session)
    const exists = await Bun.file(plan).exists()
    if (exists) {
      const part = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH + "\n\n" + `A plan file exists at ${plan}. You should execute on the plan defined within it`,
        hybio: true,
      })
      userMessage.parts.push(part)
    }
    return input.messages
  }

  if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
    const plan = Session.plan(input.session)
    const exists = await Bun.file(plan).exists()
    if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
    const fileInfo = exists
      ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
      : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`
    const text = PROMPT_PLAN_ENTER.replace("$PLAN_FILE_INFO", fileInfo)
    const part = await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text,
      hybio: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }
  return input.messages
}
