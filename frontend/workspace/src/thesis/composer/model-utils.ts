import { URLS } from "@/config/urls"
import type { ModelSource } from "@/utils/model-cost"

export const BYOK_URL = URLS.dashboard

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "ChatGPT subscription",
  google: "Google",
  "google-vertex": "Google Vertex",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  vercel: "Vercel",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  cohere: "Cohere",
  gitlab: "GitLab Duo",
  hysci: "HYcloud",
}

// Credential source shown as a single low-weight dot — the one bit that matters
// is "does this spend money?". Text badges (BYOK/metered) were removed from the
// bar and rows; the dot carries the signal at near-zero visual weight. Inferred
// from provider connection state; authoritative resolver is server-side.
export const SOURCE_DOT: Record<ModelSource, { color: string; opacity: number; meters: boolean; title: string }> = {
  byok: { color: "var(--color-text-faint)", opacity: 0.5, meters: false, title: "your key — free" },
  "signed-in": { color: "var(--color-text-faint)", opacity: 0.5, meters: false, title: "signed-in account — free" },
  managed: { color: "var(--color-accent)", opacity: 0.8, meters: true, title: "metered — debits your wallet" },
}

// The effort control renders a model's OWN reasoning-effort variant keys
// (low/medium/high/xhigh/none/minimal, exactly as the backend emits them) and
// persists the choice via models.variant. No relabeling.
//
// A model exposes a REAL per-request "fast" API param only for gpt-5.5, where it
// maps to OpenAI service_tier: priority (plumbed as providerOptions.openai.serviceTier
// in src/session/llm.ts). Opus-4.8 speed:"fast" is real but not plumbable through the
// installed @ai-sdk/anthropic, so no fast toggle is shown for it.
export const isGpt55 = (modelID: string) => /gpt-5\.5/.test(modelID.toLowerCase())

// Collapse a model id to its FAMILY so the picker shows one current entry per
// family and folds dated snapshots / superseded majors behind a "show older"
// toggle. Best-effort + provider-agnostic: drop a trailing dated snapshot, then
// trailing variant/tier-neutral suffixes, then the trailing version number.
//   claude-opus-4-8 · claude-opus-4-1-20250805      → "claude-opus"
//   gpt-5.5 · gpt-5.4                                → "gpt"
//   gemini-3.1-pro-preview · …-preview-customtools   → "gemini-3.1-pro"
export const DATE_SUFFIX = /[-_](\d{8}|\d{4}-\d{2}-\d{2})$/
export const VARIANT_SUFFIX =
  /[-_](preview|latest|stable|customtools|thinking|reasoning|non-reasoning|multi-agent|image-preview|image|hd|online)$/
export function familyKey(id: string): string {
  let k = id.toLowerCase().replace(DATE_SUFFIX, "")
  let prev = ""
  while (prev !== k) {
    prev = k
    k = k.replace(VARIANT_SUFFIX, "")
  }
  // Drop every pure-version token (5.5 → 5,5 · 4 · 8 · 0309) so the surviving
  // tier words — opus / sonnet / pro / flash / nano / codex — form the family.
  // That folds gpt-5.4-nano under gpt-nano, claude-3-7-sonnet under claude-sonnet.
  const parts = k.split(/[-_.]/).filter((t) => t && !/^v?\d+$/.test(t))
  return parts.join("-") || id.toLowerCase()
}

// Models that can't serve as the agent/chat model — embeddings, TTS, image
// generation, transcription, moderation, rerankers. Kept out of the picker so it
// only offers things you can actually select. Deep-research + realtime chat
// models stay (they take text in).
export const NON_CHAT_MODEL =
  /(^|[-_/])(embedding|embeddings|tts|whisper|transcribe|moderation|image|imagine|dall-?e|sora|veo|imagen|guard|rerank)([-_]|$)/
export const isSelectableModel = (id: string) => !NON_CHAT_MODEL.test(id.toLowerCase())

// Compact $/1M rate from the transformed Provider.Model cost shape
// (cost.input/output, cost.experimentalOver200K.*). `over` swaps to the >200k tier.
export interface ModelCostShape {
  input?: number
  output?: number
  experimentalOver200K?: { input?: number; output?: number }
}
export function rateFor(cost: ModelCostShape | undefined, over: boolean) {
  const tier = over && cost?.experimentalOver200K ? cost.experimentalOver200K : cost
  const input = tier?.input ?? 0
  const output = tier?.output ?? 0
  const free = input === 0 && output === 0
  const fmt = (v: number) => (v >= 1 ? `$${v.toFixed(2).replace(/\.?0+$/, "")}` : `$${v.toPrecision(2)}`)
  return { free, input: fmt(input), output: fmt(output) }
}

// Skip the open/close animation when the OS asks for reduced motion.
export const REDUCE_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

// A model routes through ChatGPT subscription OAuth when served by the
// openai-codex provider or when its id carries OpenAI's codex tag.
export const isSubscriptionModel = (providerID: string, modelID: string) =>
  providerID === "openai-codex" || modelID.toLowerCase().includes("codex")

export const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id

export function formatTokens(value: number | undefined): string {
  if (!value) return "?"
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1))}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

export type AgentName = "research"

export interface Attachment {
  id: string
  filename: string
  mime: string
  size: number
  dataUrl: string
  /** Relative project path once persisted under `.hyscience/context/`. */
  path?: string
  status?: "saving" | "saved" | "failed"
}

export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024 // 12MB
export const CONTEXT_DIR = ".hyscience/context"

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

export function safeFilename(name: string): string {
  // Keep the extension, slugify the stem so the path is shell-safe.
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extPart = dot > 0 ? name.slice(dot) : ""
  const slug = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return (slug || "file") + extPart
}

export function isTextLike(name: string, mime: string): boolean {
  const kind = (mime || "").toLowerCase()
  if (kind.startsWith("text/")) return true
  if (
    kind === "application/json" ||
    kind === "application/csv" ||
    kind === "application/x-csv" ||
    kind === "application/xml" ||
    kind === "application/x-yaml" ||
    kind === "application/yaml"
  )
    return true
  return /\.(csv|tsv|txt|md|markdown|json|jsonl|yaml|yml|xml|html|htm|py|r|R|ipynb|log|bed|gtf|gff|fasta|fa|fastq|sam|vcf)$/i.test(
    name,
  )
}

export function looksLikeMarkers(name: string): boolean {
  return /marker|cluster|cell.?type|annot|deg|diff.?exp|findallmarkers|rank.?genes/i.test(name)
}

export function decodeDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",")
  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function attachmentGuidance(atts: Attachment[]): string {
  if (atts.length === 0) return ""
  const lines = atts.map((a) => {
    const dest = a.path ?? `${CONTEXT_DIR}/${safeFilename(a.filename)}`
    const state =
      a.status === "saved"
        ? "on disk — read this path with the read tool"
        : a.status === "failed"
          ? "persist failed — ask the user to re-attach"
          : "saving"
    return `- ${dest} (${state}, ${a.mime || "unknown"})`
  })
  const markers = atts.some((a) => looksLikeMarkers(a.filename) || /\.(csv|tsv)$/i.test(a.filename))
  const markerHint = markers
    ? `\nThese look like cluster/marker tables. Read them from disk with the read tool (do not ask the user to re-upload). Infer columns (cluster id, gene symbol, score/logFC/p-value/pct). Annotate EVERY cluster id present — do not stop early. Follow the single-cell annotation deliverable: grouped summary table, key findings, and write a locale-aware \`*_annotation.xlsx\` via \`annotation_report.py\` into the Result folder (visible, not only .context).`
    : ""
  return `HYscience attachments (durable scratchpad):\n${lines.join("\n")}\nPaths are under \`${CONTEXT_DIR}/\` at the project working directory. Prefer \`read\` / bash on these paths — do not rely on inline data URLs.${markerHint}`
}
