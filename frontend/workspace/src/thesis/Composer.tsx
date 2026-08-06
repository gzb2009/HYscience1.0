import { createSignal, createMemo, createEffect, on, onCleanup, onMount, untrack, type JSX, Show, For } from "solid-js"
import { Portal } from "solid-js/web"
import { useNavigate, useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useModels, type ModelKey } from "@/context/models"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import {
  IconArrowUp,
  IconChevronDown,
  IconPaperclip,
  IconSearch,
  IconSparkles,
  IconStop,
  IconX,
} from "@/thesis/shared/Icon"
import { AgentIcon } from "@/thesis/shared/AgentIcon"
import { toast } from "@/thesis/Toast"
import { SkillsBrowser } from "@/thesis/SkillsBrowser"
import { EffortSlider } from "@/thesis/EffortSlider"
import { uiStore } from "@/thesis/store/ui"
import { URLS } from "@/config/urls"
import { Identifier } from "@/utils/id"
import { useProviders, popularProviders } from "@/hooks/use-providers"
import { useGlobalSync } from "@/context/global-sync"
import { useDialog } from "@hysci/ui/context/dialog"
import { openSetupDialog } from "@/thesis/SetupDialog"
import { resolveModelSource, type ModelSource } from "@/utils/model-cost"
import { deriveSessionTitleFromMessage, isDefaultSessionTitle, makeUniqueSessionTitle } from "@/utils/sessionNaming"
import { sessionTitleLocal } from "@/thesis/store/sessionTitleLocal"
import { ensureDirectory } from "@/utils/projectResult"
import { Binary } from "@hysci/util/binary"
import { produce } from "solid-js/store"
import { mergesContext, startsTask, taskControls, type TaskControl } from "@/thesis/task-control"

const BYOK_URL = URLS.dashboard

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  google: "Google",
  "google-vertex": "Google Vertex",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  vercel: "Vercel",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  cohere: "Cohere",
  hysci: "HYscience Cloud",
}

// Credential source shown as a single low-weight dot — the one bit that matters
// is "does this spend money?". Text badges (BYOK/metered) were removed from the
// bar and rows; the dot carries the signal at near-zero visual weight. Inferred
// from provider connection state; authoritative resolver is server-side.
const SOURCE_DOT: Record<ModelSource, { color: string; opacity: number; meters: boolean; title: string }> = {
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
const isGpt55 = (modelID: string) => /gpt-5\.5/.test(modelID.toLowerCase())

// Collapse a model id to its FAMILY so the picker shows one current entry per
// family and folds dated snapshots / superseded majors behind a "show older"
// toggle. Best-effort + provider-agnostic: drop a trailing dated snapshot, then
// trailing variant/tier-neutral suffixes, then the trailing version number.
//   claude-opus-4-8 · claude-opus-4-1-20250805      → "claude-opus"
//   gpt-5.5 · gpt-5.4                                → "gpt"
//   gemini-3.1-pro-preview · …-preview-customtools   → "gemini-3.1-pro"
const DATE_SUFFIX = /[-_](\d{8}|\d{4}-\d{2}-\d{2})$/
const VARIANT_SUFFIX =
  /[-_](preview|latest|stable|customtools|thinking|reasoning|non-reasoning|multi-agent|image-preview|image|hd|online)$/
function familyKey(id: string): string {
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
const NON_CHAT_MODEL =
  /(^|[-_/])(embedding|embeddings|tts|whisper|transcribe|moderation|image|imagine|dall-?e|sora|veo|imagen|guard|rerank)([-_]|$)/
const isSelectableModel = (id: string) => !NON_CHAT_MODEL.test(id.toLowerCase())

// Compact $/1M rate from the transformed Provider.Model cost shape
// (cost.input/output, cost.experimentalOver200K.*). `over` swaps to the >200k tier.
interface ModelCostShape {
  input?: number
  output?: number
  experimentalOver200K?: { input?: number; output?: number }
}
function rateFor(cost: ModelCostShape | undefined, over: boolean) {
  const tier = over && cost?.experimentalOver200K ? cost.experimentalOver200K : cost
  const input = tier?.input ?? 0
  const output = tier?.output ?? 0
  const free = input === 0 && output === 0
  const fmt = (v: number) => (v >= 1 ? `$${v.toFixed(2).replace(/\.?0+$/, "")}` : `$${v.toPrecision(2)}`)
  return { free, input: fmt(input), output: fmt(output) }
}

// Skip the open/close animation when the OS asks for reduced motion.
const REDUCE_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

// A model is a "codex" model when it's served by the Codex OAuth provider or
// its id carries the codex tag (gpt-5.x-codex). Surfaced as a badge so users
// can tell which models route through Codex.
const isCodexModel = (providerID: string, modelID: string) =>
  providerID === "openai-codex" || modelID.toLowerCase().includes("codex")

const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id

function formatTokens(value: number | undefined): string {
  if (!value) return "?"
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1))}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

type AgentName = "research" | "biology" | "physics" | "ml"

interface Attachment {
  id: string
  filename: string
  mime: string
  size: number
  dataUrl: string
  /** Relative project path once persisted under `.hyscience/context/`. */
  path?: string
  status?: "saving" | "saved" | "failed"
}

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024 // 12MB
const CONTEXT_DIR = ".hyscience/context"

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

function safeFilename(name: string): string {
  // Keep the extension, slugify the stem so the path is shell-safe.
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extPart = dot > 0 ? name.slice(dot) : ""
  const slug = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return (slug || "file") + extPart
}

function isTextLike(name: string, mime: string): boolean {
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

function looksLikeMarkers(name: string): boolean {
  return /marker|cluster|cell.?type|annot|deg|diff.?exp|findallmarkers|rank.?genes/i.test(name)
}

function decodeDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",")
  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function attachmentGuidance(atts: Attachment[]): string {
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

export function Composer(): JSX.Element {
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const platform = usePlatform()
  const models = useModels()
  const providers = useProviders()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const language = useLanguage()

  const [text, setText] = createSignal("")
  const [model, setModel] = createSignal<ModelKey | undefined>(undefined)
  const agent = (): AgentName => {
    const domain = sync.project?.research?.domain
    return domain === "biology" || domain === "physics" || domain === "ml" ? domain : "research"
  }
  const [modelOpen, setModelOpen] = createSignal(false)
  const [modelQuery, setModelQuery] = createSignal("")
  // Provider groups the user has expanded to reveal folded (older) models.
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const toggleGroup = (id: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  // Highlighted row index for keyboard nav inside the model search.
  const [modelIndex, setModelIndex] = createSignal(0)
  const [submitting, setSubmitting] = createSignal(false)

  // ── Effort popover state ─────────────────────────────────────────────────
  const [effortOpen, setEffortOpen] = createSignal(false)
  let effortBtnRef: HTMLButtonElement | undefined
  const [effortAnchor, setEffortAnchor] = createSignal<{
    left: number
    bottom: number
    width: number
    up: boolean
  }>()
  const measureEffort = () => {
    const el = effortBtnRef
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 12
    const width = 320
    const vw = window.innerWidth
    const left = Math.max(margin, Math.min(r.right - width, vw - width - margin))
    setEffortAnchor({
      left,
      bottom: window.innerHeight - r.top + 8,
      width,
      up: true,
    })
  }

  // ── Composer wrap ref for floating-controls alignment ──────────────────
  let composeWrapRef: HTMLDivElement | undefined

  // ── Prompt queue ─────────────────────────────────────────────────────────
  // The composer never locks while the agent is streaming. Sends that arrive
  // mid-turn are queued (with the agent/model/effort chosen at enqueue time)
  // and dispatched in order the moment the session goes idle. `inflight`
  // covers the whole server turn (session.prompt resolves when the turn
  // completes), which also bridges the SSE gap before session_status flips
  // to non-idle — without it two queued prompts could race out together.
  type QueuedPrompt = {
    id: string
    text: string
    attachments: Attachment[]
    agent: string
    model: ModelKey
    variant: string | undefined
    fast: boolean | undefined
    taskControl: TaskControl | undefined
  }
  const [queue, setQueue] = createSignal<QueuedPrompt[]>([])
  const [inflight, setInflight] = createSignal(false)
  const [taskControl, setTaskControl] = createSignal<TaskControl>()
  const [taskControlOpen, setTaskControlOpen] = createSignal(false)
  const selectedTaskControl = createMemo(() => taskControls.find((item) => item.id === taskControl()))
  createEffect(
    on(
      () => params.id,
      () => setQueue([]),
      { defer: true },
    ),
  )
  const [focused, setFocused] = createSignal(false)
  const [dragOver, setDragOver] = createSignal(false)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  // Slash-command autocomplete (skills surfaced via `sync.data.skill`).
  // Popover opens whenever the input is exactly `/<query>` (single token,
  // no spaces). Arrow keys move selection; Enter inserts `/<name> `.
  const [slashIndex, setSlashIndex] = createSignal(0)
  const [skillsOpen, setSkillsOpen] = createSignal(false)
  const [caret, setCaret] = createSignal(0)
  let textareaRef: HTMLTextAreaElement | undefined
  let fileInputRef: HTMLInputElement | undefined
  let modelSearchRef: HTMLInputElement | undefined
  let modelBtnRef: HTMLButtonElement | undefined
  let modelRowRefs: HTMLElement[] = []

  // Pick a sensible default model the moment one becomes available:
  // last-used > visible Anthropic Sonnet > first visible model. Re-runs
  // until a real model lands so the picker isn't stuck on "no model".
  createEffect(() => {
    if (model()) return
    const recents = models.recent.list()
    if (recents.length > 0) {
      setModel({ providerID: recents[0].providerID, modelID: recents[0].modelID })
      return
    }
    const all = models.list().filter((m) => models.visible({ providerID: m.provider.id, modelID: m.id }))
    // Prefer the latest flagship: newest Anthropic Sonnet, then newest Opus,
    // then any "(latest)"-tagged model, then the first available.
    const byIdDesc = (a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id)
    const anthropic = all.filter((m) => m.provider.id === "anthropic")
    const fallback =
      anthropic.filter((m) => m.id.startsWith("claude-sonnet")).sort(byIdDesc)[0] ??
      anthropic.filter((m) => m.id.startsWith("claude-opus")).sort(byIdDesc)[0] ??
      all.find((m) => m.latest) ??
      all[0]
    if (fallback) setModel({ providerID: fallback.provider.id, modelID: fallback.id })
  })

  // Welcome-launchpad chips + one-click actions push a starter prompt through
  // uiStore.prefill; adopt it into the composer, focus, and clear the channel. When
  // prefillSend is set (e.g. "initialize graph"), submit immediately instead of
  // waiting for the user to press enter.
  createEffect(() => {
    const pending = uiStore.prefill()
    if (!pending) return
    const send = uiStore.prefillSend()
    setText(pending)
    uiStore.setPrefill(undefined)
    uiStore.setPrefillSend(false)
    if (textareaRef) {
      textareaRef.focus()
      textareaRef.style.height = "auto"
      textareaRef.style.height = Math.min(280, textareaRef.scrollHeight) + "px"
    }
    if (send) void submit()
  })

  const selectedInfo = createMemo(() => {
    const m = model()
    if (!m) return undefined
    return models.find(m)
  })

  const selectedLabel = createMemo(() => {
    const m = model()
    const found = selectedInfo()
    return found && m ? { name: found.name, providerID: m.providerID } : undefined
  })

  const selectedSource = createMemo(() => {
    const m = model()
    if (!m) return undefined
    const connected = providers.connected().some((p) => p.id === m.providerID)
    const source = resolveModelSource({
      providerID: m.providerID,
      connected,
      authMethods: globalSync.data.provider_auth?.[m.providerID],
    })
    return SOURCE_DOT[source]
  })

  // Reasoning-effort variants for the selected model (low / medium / high /
  // max, or none / minimal / … for OpenAI). The backend maps the chosen
  // variant to provider options — see ProviderTransform.variants.
  const variantKeys = createMemo<string[]>(() => {
    const m = model()
    if (!m) return []
    const found = models.find(m) as { variants?: Record<string, { disabled?: boolean }> } | undefined
    const v = found?.variants
    if (!v) return []
    return Object.entries(v)
      .filter(([, val]) => !val?.disabled)
      .map(([k]) => k)
  })
  const effort = () => {
    const m = model()
    return m ? models.variant.get(m) : undefined
  }
  const setEffort = (value: string | undefined) => {
    const m = model()
    if (m) models.variant.set(m, value)
  }

  // Fast toggle — only gpt-5.5 has a real plumbable per-request "fast" param
  // (OpenAI service_tier: priority). Sent as `fast` on the prompt; the backend
  // guards it to gpt-5.5. Reset when the model changes (state is per-model).
  const supportsFast = createMemo(() => {
    const m = model()
    return !!m && isGpt55(m.modelID)
  })
  const [fast, setFast] = createSignal(false)
  createEffect(
    on(
      () => model()?.providerID + "/" + model()?.modelID,
      () => setFast(false),
      { defer: true },
    ),
  )

  // Context tier (Cursor "MAX mode" analogue). Only meaningful when the model
  // prices the >200k window differently. This is a price-preview + intent signal;
  // the long-context request flag is threaded through submit in a later pass.
  const [longCtx, setLongCtx] = createSignal(false)
  const selectedCost = createMemo(() => selectedInfo()?.cost as ModelCostShape | undefined)
  const hasLongTier = createMemo(() => !!selectedCost()?.experimentalOver200K)
  // Reset the tier toggle whenever the model changes — pricing is per-model.
  createEffect(
    on(
      () => model()?.providerID + "/" + model()?.modelID,
      () => setLongCtx(false),
      { defer: true },
    ),
  )

  // Per-row credential source, inferred from provider connection + auth methods
  // the web app already has (authoritative resolver is server-side).
  const rowSource = (providerID: string): ModelSource => {
    const connected = providers.connected().some((p) => p.id === providerID)
    return resolveModelSource({
      providerID,
      connected,
      authMethods: globalSync.data.provider_auth?.[providerID],
    })
  }

  // Visible models narrowed by the search query. Grouping + ordering happen in
  // modelGroups; this stays flat for the query pass.
  const filteredModels = createMemo(() => {
    const q = modelQuery().trim().toLowerCase()
    return models
      .list()
      .filter((m) => models.visible({ providerID: m.provider.id, modelID: m.id }))
      .filter((m) => isSelectableModel(m.id))
      .filter((m) => {
        if (!q) return true
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          providerLabel(m.provider.id).toLowerCase().includes(q)
        )
      })
  })

  // Group by provider. Mainstream + OpenRouter/Vercel lead (popularProviders);
  // every other host — Groq, Together, Mistral, DeepSeek, xAI, … — follows
  // alphabetically. No provider is force-promoted, so open-weight models sit
  // beside proprietary ones under their host.
  type ModelRow = ReturnType<typeof filteredModels>[number]
  const modelGroups = createMemo(() => {
    const byProvider = new Map<string, ModelRow[]>()
    for (const m of filteredModels()) {
      const arr = byProvider.get(m.provider.id)
      if (arr) arr.push(m)
      else byProvider.set(m.provider.id, [m])
    }
    const rank = (id: string) => {
      const i = popularProviders.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const searching = !!modelQuery().trim()
    const recentKeys = new Set(models.recent.list().map((r) => r.providerID + "/" + r.modelID))
    const sel = model()
    // Pinned models are never folded away: the newest-per-family head, plus the
    // selected model, recents, and anything the catalog tags "(latest)".
    const pinned = (m: ModelRow) =>
      m.latest ||
      recentKeys.has(m.provider.id + "/" + m.id) ||
      (!!sel && sel.providerID === m.provider.id && sel.modelID === m.id)
    const groups = [...byProvider.entries()]
      .map(([id, all]) => {
        const sorted = all.slice().sort((a, b) => {
          if (a.latest !== b.latest) return a.latest ? -1 : 1
          const date = (b.release_date ?? "").localeCompare(a.release_date ?? "")
          if (date !== 0) return date
          return a.name.localeCompare(b.name)
        })
        // While searching, show every match — never hide a result behind a fold.
        if (searching) return { id, name: providerLabel(id), items: sorted, folded: 0, open: false }
        const seen = new Set<string>()
        const primary: ModelRow[] = []
        const secondary: ModelRow[] = []
        for (const m of sorted) {
          const fam = familyKey(m.id)
          if (!seen.has(fam)) {
            seen.add(fam) // first (newest) model of this family always shows
            primary.push(m)
          } else if (pinned(m)) {
            primary.push(m)
          } else {
            secondary.push(m)
          }
        }
        const open = expandedGroups().has(id)
        return {
          id,
          name: providerLabel(id),
          items: open ? [...primary, ...secondary] : primary,
          folded: secondary.length,
          open,
        }
      })
      .sort((a, b) => {
        const r = rank(a.id) - rank(b.id)
        return r !== 0 ? r : a.name.localeCompare(b.name)
      })
    let offset = 0
    return groups.map((g) => {
      const start = offset
      offset += g.items.length
      return { ...g, offset: start }
    })
  })
  const flatRows = createMemo(() => modelGroups().flatMap((g) => g.items))

  // ── model-search keyboard nav ────────────────────────────────────────
  const selectRowAt = (i: number, close = false) => {
    const row = flatRows()[i]
    if (!row) return
    setModel({ providerID: row.provider.id, modelID: row.id })
    setModelIndex(i)
    if (close) setModelOpen(false)
  }
  const onModelSearchKey = (e: KeyboardEvent) => {
    const len = flatRows().length
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setModelIndex((i) => (len ? (i + 1) % len : 0))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setModelIndex((i) => (len ? (i - 1 + len) % len : 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      selectRowAt(modelIndex(), true)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setModelOpen(false)
    }
  }

  // On open: focus the search box and start the highlight on the current model
  // so keyboard nav (and the auto-scroll below) resume where the user left off.
  createEffect(
    on(modelOpen, (open) => {
      if (!open) return
      const flat = untrack(flatRows)
      const sel = untrack(model)
      const idx = sel ? flat.findIndex((r) => r.provider.id === sel.providerID && r.id === sel.modelID) : -1
      const start = idx >= 0 ? idx : 0
      setModelIndex(start)
      queueMicrotask(() => {
        modelSearchRef?.focus()
        modelRowRefs[start]?.scrollIntoView({ block: "nearest" })
      })
    }),
  )
  // Keep the highlight in range and scrolled into view as the list narrows.
  createEffect(() => {
    const len = flatRows().length
    if (modelIndex() >= len) {
      setModelIndex(0)
      return
    }
    modelRowRefs[modelIndex()]?.scrollIntoView({ block: "nearest" })
  })

  // ── picker anchoring ─────────────────────────────────────────────────
  // Measure the trigger and place a fixed panel that left-aligns to the button,
  // clamps to the viewport, and flips below only when there's no room above.
  // Portalled to <body>, so no ancestor transform/overflow can clip it.
  const [anchor, setAnchor] = createSignal<{
    left: number
    top?: number
    bottom?: number
    width: number
    maxH: number
    up: boolean
  }>()
  const measurePicker = () => {
    const el = modelBtnRef
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8
    const margin = 12
    const width = Math.min(384, vw - margin * 2)
    // Right-align to the top-right trigger (beside Notebook).
    const left = Math.max(margin, Math.min(r.right - width, vw - width - margin))
    const above = r.top - margin
    const below = vh - r.bottom - margin
    const up = r.bottom > vh * 0.55 || above >= below
    setAnchor(
      up
        ? { left, bottom: vh - r.top + gap, width, maxH: Math.min(440, above), up: true }
        : { left, top: r.bottom + gap, width, maxH: Math.min(440, below), up: false },
    )
  }
  createEffect(
    on(modelOpen, (open) => {
      if (!open) return
      measurePicker()
      const remeasure = () => measurePicker()
      window.addEventListener("resize", remeasure)
      window.addEventListener("scroll", remeasure, true)
      onCleanup(() => {
        window.removeEventListener("resize", remeasure)
        window.removeEventListener("scroll", remeasure, true)
      })
    }),
  )
  createEffect(
    on(effortOpen, (open) => {
      if (!open) return
      measureEffort()
      const remeasure = () => measureEffort()
      window.addEventListener("resize", remeasure)
      window.addEventListener("scroll", remeasure, true)
      onCleanup(() => {
        window.removeEventListener("resize", remeasure)
        window.removeEventListener("scroll", remeasure, true)
      })
    }),
  )

  const sessionPending = () => {
    const id = params.id
    if (!id || id === "new") return null
    return id
  }

  // The session is "working" (streaming) when hyscience reports a non-idle
  // status for it. We use this to flip the send button into a stop
  // button.
  const sessionStatus = createMemo(() => {
    const id = sessionPending()
    if (!id) return undefined
    return (sync.data.session_status?.[id] as { type?: string } | undefined)?.type
  })
  const isWorking = () => {
    const s = sessionStatus()
    return s !== undefined && s !== "idle"
  }

  const stop = async () => {
    const sid = sessionPending()
    if (!sid) return
    try {
      const pending = sync.data.question?.[sid] ?? []
      await Promise.all(
        pending.map((q) => sdk.client.question.reject({ requestID: q.id }).catch(() => undefined)),
      )
      await sdk.client.session.abort({ sessionID: sid } as any)
    } catch (e: any) {
      console.error("session.abort failed", e)
      toast.error("could not stop", e?.message ?? String(e))
    }
  }

  // Serialize persists so submit can await the latest write before sending.
  let persistTail: Promise<void> = Promise.resolve()

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    const next: Attachment[] = []
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} too large`, "max 12MB per attachment")
        continue
      }
      try {
        const dataUrl = await readAsDataURL(file)
        next.push({
          id: crypto.randomUUID(),
          filename: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
          status: "saving",
        })
      } catch (err: any) {
        toast.error(`could not read ${file.name}`, err?.message ?? String(err))
      }
    }
    if (next.length === 0) return
    setAttachments((prev) => [...prev, ...next])
    const run = () => persistAttachments(next)
    persistTail = persistTail.then(run, run)
    await persistTail
  }

  const persistAttachments = async (atts: Attachment[]) => {
    const doFetch = platform.fetch ?? fetch
    const base = sdk.url.replace(/\/$/, "")
    const dir = sdk.directory
    try {
      await ensureDirectory(sdk.url, doFetch, dir, CONTEXT_DIR)
    } catch (err: any) {
      for (const a of atts) {
        setAttachments((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "failed" as const } : x)))
      }
      toast.error(`could not create ${CONTEXT_DIR}/`, err?.message ?? String(err))
      return
    }
    for (const a of atts) {
      const name = safeFilename(a.filename)
      const rel = `${CONTEXT_DIR}/${name}`
      const comma = a.dataUrl.indexOf(",")
      const raw = comma >= 0 ? a.dataUrl.slice(comma + 1) : a.dataUrl
      const text = isTextLike(a.filename, a.mime)
      const body = (() => {
        if (!text) return raw
        try {
          return decodeDataUrl(a.dataUrl)
        } catch {
          try {
            return atob(raw)
          } catch {
            return raw
          }
        }
      })()
      try {
        const res = await doFetch(`${base}/file/content?directory=${encodeURIComponent(dir)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: rel,
            content: body,
            ...(text ? {} : { encoding: "base64" }),
          }),
        })
        if (!res.ok) throw new Error(`save failed (${res.status})`)
        setAttachments((prev) => prev.map((x) => (x.id === a.id ? { ...x, path: rel, status: "saved" as const } : x)))
      } catch (err: any) {
        setAttachments((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "failed" as const } : x)))
        toast.error(`could not save ${name}`, err?.message ?? String(err))
      }
    }
  }

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id))

  const hasFileDrag = (e: DragEvent) => {
    const t = e.dataTransfer?.types
    if (!t) return false
    // DOMStringList (Safari) vs frozen string[] (Chromium).
    if (typeof (t as unknown as DOMStringList).contains === "function") {
      return (t as unknown as DOMStringList).contains("Files") || (t as unknown as DOMStringList).contains("files")
    }
    const list = Array.from(t as ArrayLike<string>)
    return list.some((x) => x.toLowerCase() === "files")
  }

  const openFilePicker = () => fileInputRef?.click()

  const onPaste = (e: ClipboardEvent) => {
    const data = e.clipboardData
    if (!data) return
    const files = Array.from(data.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length === 0) return
    e.preventDefault()
    void addFiles(files)
  }

  const acceptDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    if (!dragOver()) setDragOver(true)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) void addFiles(files)
  }

  // Capture-phase document listeners: some hosts (embedded previews) only
  // deliver file drags reliably if preventDefault runs early. Still skip when
  // a modal is open so dialogs keep their own DnD.
  const onDocDragOver = (e: DragEvent) => {
    if (dialog.active) return
    if (!hasFileDrag(e) && !(e.dataTransfer?.files && e.dataTransfer.files.length > 0)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    if (!dragOver()) setDragOver(true)
  }
  const onDocDragLeave = (e: DragEvent) => {
    if (dialog.active) return
    if (e.relatedTarget) return
    setDragOver(false)
  }
  const onDocDrop = (e: DragEvent) => {
    if (dialog.active) return
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    void addFiles(files)
  }
  onMount(() => {
    document.addEventListener("dragover", onDocDragOver, true)
    document.addEventListener("dragleave", onDocDragLeave, true)
    document.addEventListener("drop", onDocDrop, true)
  })
  onCleanup(() => {
    document.removeEventListener("dragover", onDocDragOver, true)
    document.removeEventListener("dragleave", onDocDragLeave, true)
    document.removeEventListener("drop", onDocDrop, true)
  })

  const grow = (v: string) => {
    setText(v)
    setSlashIndex(0)
    if (textareaRef) {
      textareaRef.style.height = "auto"
      textareaRef.style.height = Math.min(280, textareaRef.scrollHeight) + "px"
    }
  }

  // A `/token` at the caret (line start or after whitespace) opens the skill
  // popover with that query — works mid-prompt, not just at the start.
  const slashQuery = createMemo(() => {
    const t = text()
    const c = Math.min(caret(), t.length)
    const before = t.slice(0, c)
    const m = before.match(/(?:^|\s)\/([A-Za-z0-9._-]*)$/)
    return m ? m[1] : null
  })
  const slashOpen = () => slashQuery() !== null && focused()

  type SkillRow = { name: string; description: string; location: string; entry?: boolean; tags?: string[] }
  const slashItems = createMemo<SkillRow[]>(() => {
    const q = (slashQuery() ?? "").toLowerCase()
    const all = ((sync.data.skill ?? []) as SkillRow[]).filter((s) => s.entry !== false)
    if (!q) {
      return all
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 12)
    }
    // Single-char queries match the name only (descriptions contain every
    // common letter); 2+ chars also search description + tags.
    const deep = q.length >= 2
    const matches = all
      .filter((s) => {
        if (s.name.toLowerCase().includes(q)) return true
        if (!deep) return false
        if ((s.description ?? "").toLowerCase().includes(q)) return true
        return (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      })
      .sort((a, b) => {
        const an = a.name.toLowerCase()
        const bn = b.name.toLowerCase()
        // Name matches rank above description/tag-only matches; within each,
        // prefix matches first.
        const aName = an.includes(q) ? 0 : 1
        const bName = bn.includes(q) ? 0 : 1
        if (aName !== bName) return aName - bName
        const ap = an.startsWith(q) ? 0 : 1
        const bp = bn.startsWith(q) ? 0 : 1
        if (ap !== bp) return ap - bp
        return an.localeCompare(bn)
      })
    return matches.slice(0, 12)
  })

  const pickSlash = (s: SkillRow | undefined) => {
    if (!s) return
    const t = text()
    const c = Math.min(caret(), t.length)
    const q = slashQuery() ?? ""
    // The token is `/` + q ending exactly at the caret; replace just that span
    // and keep everything after it intact (insert-at-cursor, no clobber).
    const tokenStart = c - (q.length + 1)
    const start = tokenStart >= 0 ? tokenStart : 0
    const insert = `/${s.name} `
    const next = t.slice(0, start) + insert + t.slice(c)
    const nextCaret = start + insert.length
    setText(next)
    setCaret(nextCaret)
    setSlashIndex(0)
    if (textareaRef) {
      textareaRef.focus()
      textareaRef.setSelectionRange(nextCaret, nextCaret)
      textareaRef.style.height = "auto"
      textareaRef.style.height = Math.min(280, textareaRef.scrollHeight) + "px"
    }
  }

  const submit = async () => {
    const trimmed = text().trim()
    if (submitting()) return
    // Finish any in-flight `.hyscience/context/` writes so guidance paths are real.
    await persistTail
    const atts = attachments()
    if (!trimmed && atts.length === 0) return
    const chosen = model()
    if (!chosen) {
      // No usable model yet — open the in-app setup flow instead of a transient
      // toast pointing at an external URL.
      openSetupDialog(dialog)
      return
    }
    const payload: QueuedPrompt = {
      id: Identifier.ascending("message"),
      text: trimmed,
      attachments: atts,
      agent: agent(),
      model: chosen,
      variant: models.variant.get(chosen),
      fast: isGpt55(chosen.modelID) ? fast() : undefined,
      taskControl: taskControl(),
    }
    // Clear the input immediately in both paths so typing can continue.
    setText("")
    setAttachments([])
    setTaskControl(undefined)
    if (textareaRef) textareaRef.style.height = "auto"

    // Mid-turn sends queue; the drain effect below fires them when idle.
    if (isWorking() || inflight()) {
      setQueue((q) => [...q, payload])
      return
    }
    await dispatch(payload)
  }

  function maybeUpdateSessionTitle(sessionID: string, rawText: string) {
    if (sessionTitleLocal.get(sessionID)?.title) return
    const trimmed = rawText.trim()
    if (!trimmed) return
    const sess = sync.session.get(sessionID)
    if (!sess?.title || !isDefaultSessionTitle(sess.title)) return
    const derived = deriveSessionTitleFromMessage(trimmed)
    if (!derived || derived === "新子任务") return
    const title = makeUniqueSessionTitle(
      derived,
      sync.data.session
        .filter((item) => item.id !== sessionID)
        .map((item) => sessionTitleLocal.get(item.id)?.title ?? item.title),
    )
    const [, setStore] = globalSync.child(sdk.directory)
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, sessionID, (s) => s.id)
        if (match.found) draft.session[match.index].title = title
      }),
    )
    void sdk.client.session.update({ sessionID, title }).catch(() => undefined)
  }

  const dispatch = async (p: QueuedPrompt) => {
    if (submitting()) {
      setQueue((q) => [p, ...q])
      return
    }
    setSubmitting(true)
    try {
      await ensureDirectory(sdk.url, platform.fetch ?? fetch, sdk.directory)
      let sessionID = sessionPending()
      if (!sessionID) {
        const res: any = await sdk.client.session.create({
          directory: sdk.directory,
        } as any)
        const data = res?.data ?? res
        sessionID = data?.id ?? data?.sessionID
        if (!sessionID) {
          toast.error("could not start session", "session.create returned no id")
          return
        }
        navigate(`/${params.dir}/session/${sessionID}`, { replace: true })
      }

      const messageID = Identifier.ascending("message")

      // Prefer on-disk paths over data URLs so the agent reads the scratchpad
      // and messages stay small. Images keep a data URL fallback for vision
      // models that cannot follow file:// without an extra read hop.
      const filePartsBase = p.attachments.flatMap((a) => {
        const name = safeFilename(a.filename)
        if (a.status === "saved" && a.path) {
          const abs = `${sdk.directory.replace(/\/$/, "")}/${a.path}`
          const image = (a.mime || "").startsWith("image/")
          if (!image) {
            return [
              {
                id: Identifier.ascending("part"),
                type: "file" as const,
                mime: "text/plain",
                url: `file://${abs}`,
                filename: name,
              },
            ]
          }
          return [
            {
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: a.mime,
              url: a.dataUrl,
              filename: name,
            },
          ]
        }
        if (a.status === "failed") {
          return [
            {
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: a.mime,
              url: a.dataUrl,
              filename: name,
            },
          ]
        }
        return []
      })

      // Keep user-visible text separate from agent-only guidance. The UI
      // hides `hybio` text parts; without that flag the scratchpad
      // instruction leaked into the chat bubble.
      const userText = p.text || (p.attachments.length > 0 ? "(see attachments)" : "")
      const textParts: Array<{
        id: string
        type: "text"
        text: string
        hybio?: boolean
      }> = [{ id: Identifier.ascending("part"), type: "text", text: userText }]
      if (p.attachments.length > 0) {
        textParts.push({
          id: Identifier.ascending("part"),
          type: "text",
          hybio: true,
          text: attachmentGuidance(p.attachments),
        })
      }
      textParts.push({
        id: Identifier.ascending("part"),
        type: "text",
        hybio: true,
        text: `<ui-locale code="${language.locale()}" />`,
      })

      const promptParts = [...textParts, ...filePartsBase]

      // Optimistically render the user message — text + attachment chips
      // live in the chat the moment Enter is pressed.
      sync.session.addOptimisticMessage({
        sessionID,
        messageID,
        agent: p.agent,
        model: p.model,
        parts: promptParts.map((part) => ({ ...part, sessionID, messageID }) as any),
      })

      maybeUpdateSessionTitle(sessionID, p.text)

      // Fire-and-forget: session.prompt resolves only when the whole turn
      // completes, so awaiting it here is what used to freeze the composer
      // for the entire generation. `inflight` tracks the turn instead.
      setInflight(true)
      sdk.client.session
        .prompt({
          sessionID,
          messageID,
          directory: sdk.directory,
          model: p.model,
          agent: p.agent,
          variant: p.variant,
          fast: p.fast,
          parts: promptParts,
          newTask: startsTask(p.taskControl),
          mergeTaskContext: mergesContext(p.taskControl),
        } as any)
        .catch((e: any) => {
          console.error("session.prompt failed", e)
          toast.error("send failed", e?.message ?? String(e))
        })
        .finally(() => {
          setInflight(false)
          void sync.session.refresh(sessionID).catch(() => undefined)
        })

      models.recent.push(p.model)
    } catch (e: any) {
      console.error("session.prompt failed", e)
      toast.error("send failed", e?.message ?? String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Drain the queue: whenever the session is idle and nothing is in flight,
  // send the next queued prompt.
  createEffect(() => {
    if (isWorking() || inflight() || submitting()) return
    const next = queue()[0]
    if (!next) return
    setQueue((q) => q.slice(1))
    void dispatch(next)
  })

  const onKey = (e: KeyboardEvent) => {
    if (slashOpen() && slashItems().length > 0) {
      const len = slashItems().length
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % len)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + len) % len)
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        pickSlash(slashItems()[slashIndex()])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setText("")
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        pickSlash(slashItems()[slashIndex()])
        return
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div
      ref={composeWrapRef}
      class="cs-composer-wrap"
      onDragEnter={acceptDrop}
      onDragOver={acceptDrop}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div class="cs-composer-inner">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.json,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp,.h5ad,.rds,.xlsx,.xls,text/csv,text/plain,application/json,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const fl = e.currentTarget.files
            if (fl && fl.length > 0) void addFiles(fl)
            if (fileInputRef) fileInputRef.value = ""
          }}
        />
        <div
          class="g-composer"
          onDragEnter={acceptDrop}
          onDragOver={acceptDrop}
          onDragLeave={(e) => {
            // Only clear when leaving the composer itself, not its children.
            if (e.currentTarget === e.target) setDragOver(false)
          }}
          onDrop={onDrop}
          style={{
            display: "flex",
            "flex-direction": "column",
            padding: "12px 14px",
            gap: "8px",
            position: "relative",
            "border-color": dragOver()
              ? "var(--color-accent)"
              : focused()
                ? "var(--color-border-strong)"
                : "var(--color-border)",
            "box-shadow":
              dragOver() || focused()
                ? "0 0 0 4px color-mix(in srgb, var(--color-focus) 10%, transparent), var(--shadow-xs)"
                : "var(--shadow-xs)",
            background: dragOver() ? "var(--color-accent-subtle)" : "var(--color-surface-solid)",
            "border-radius": "14px",
            transition: "background 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
          }}
        >
          <Show when={dragOver()}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                "border-radius": "14px",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "pointer-events": "none",
                "z-index": 2,
                background: "color-mix(in srgb, var(--color-accent-subtle) 85%, transparent)",
                "font-family": FONT_SANS,
                "font-size": "13px",
                color: "var(--color-text)",
              }}
            >
              drop files to attach
            </div>
          </Show>
          <Show when={queue().length > 0}>
            <div
              style={{
                display: "flex",
                "flex-wrap": "wrap",
                "align-items": "center",
                gap: "6px",
                "margin-bottom": "2px",
              }}
            >
              <span
                style={{
                  "font-family": FONT_MONO,
                  "font-size": "10px",
                  color: "var(--color-text-faint)",
                  "letter-spacing": "0.08em",
                  "text-transform": "lowercase",
                }}
              >
                queued · {queue().length}
              </span>
              <For each={queue()}>
                {(q) => (
                  <span
                    style={{
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "6px",
                      border: "1px solid var(--color-border)",
                      "border-radius": "4px",
                      padding: "3px 8px",
                      "font-family": FONT_SANS,
                      "font-size": "12px",
                      color: "var(--color-text-muted)",
                      background: "var(--color-bg-elevated)",
                      "max-width": "340px",
                    }}
                  >
                    <span
                      title="click to edit — moves back into the input"
                      style={{
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        if (text().trim().length > 0) {
                          toast.info("input not empty", "clear the input to pull a queued message back")
                          return
                        }
                        setQueue((qs) => qs.filter((x) => x.id !== q.id))
                        setAttachments(q.attachments)
                        grow(q.text)
                      }}
                    >
                      {q.text || "(attachments)"}
                    </span>
                    <button
                      type="button"
                      aria-label="remove from queue"
                      onClick={() => setQueue((qs) => qs.filter((x) => x.id !== q.id))}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        display: "inline-flex",
                        color: "var(--color-text-faint)",
                      }}
                    >
                      <IconX size={11} strokeWidth={1.5} />
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <Show when={attachments().length > 0}>
            <div
              style={{
                display: "flex",
                "flex-wrap": "wrap",
                gap: "6px",
              }}
            >
              <For each={attachments()}>
                {(a) => <AttachmentChip att={a} onRemove={() => removeAttachment(a.id)} />}
              </For>
            </div>
          </Show>
          <Show when={selectedTaskControl()}>
            {(control) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  width: "fit-content",
                  padding: "3px 6px 3px 8px",
                  border: "1px solid var(--color-border)",
                  "border-radius": "4px",
                  background: "var(--color-accent-subtle)",
                  "font-family": FONT_MONO,
                  "font-size": "10px",
                  color: "var(--color-text-muted)",
                }}
              >
                <span>{control().label}</span>
                <button
                  type="button"
                  title="继续当前任务"
                  aria-label="继续当前任务"
                  onClick={() => setTaskControl(undefined)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "inline-flex",
                    color: "var(--color-text-faint)",
                  }}
                >
                  <IconX size={11} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </Show>
          <div style={{ position: "relative", width: "100%" }}>
            <textarea
              ref={textareaRef}
              value={text()}
              onInput={(e) => {
                grow(e.currentTarget.value)
                setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length)
              }}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              // Delay blur so popover clicks register before the popover unmounts.
              onBlur={() => setTimeout(() => setFocused(false), 120)}
              onPaste={onPaste}
              placeholder={
                agent() === "research"
                  ? "ask a research question · / for skills"
                  : "Ask anything — @ for artifacts, # for sessions, / for skills, ⌘K to search…"
              }
              style={{
                all: "unset",
                "font-family": FONT_SANS,
                "font-size": "13px",
                "line-height": 1.55,
                color: "var(--color-text)",
                "min-height": "20px",
                "max-height": "280px",
                "overflow-y": "auto",
                resize: "none",
                width: "100%",
                display: "block",
              }}
            />
            <Show when={skillsOpen()}>
              <SkillsBrowser
                onPick={(name) => {
                  pickSlash({ name, description: "", location: "" })
                  setSkillsOpen(false)
                }}
                onClose={() => setSkillsOpen(false)}
              />
            </Show>
            <Show when={slashOpen()}>
              <div
                class="thesis-fade-in thesis-scroll"
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  right: 0,
                  "margin-bottom": "6px",
                  "max-height": "280px",
                  "overflow-y": "auto",
                  background: "var(--color-surface-solid)",
                  border: "1px solid var(--color-border)",
                  "border-radius": "4px",
                  "box-shadow": "var(--shadow-md)",
                  padding: "4px",
                  "z-index": 30,
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div
                  style={{
                    padding: "6px 8px 4px",
                    "font-family": FONT_MONO,
                    "font-size": "10px",
                    color: "var(--color-text-faint)",
                    "letter-spacing": "0.08em",
                    "text-transform": "uppercase",
                  }}
                >
                  skills
                </div>
                <Show
                  when={slashItems().length > 0}
                  fallback={
                    <div
                      style={{
                        padding: "8px 10px",
                        "font-family": FONT_MONO,
                        "font-size": "11px",
                        color: "var(--color-text-faint)",
                      }}
                    >
                      no matching skills
                    </div>
                  }
                >
                  <For each={slashItems()}>
                    {(s, i) => (
                      <div
                        onMouseEnter={() => setSlashIndex(i())}
                        onClick={() => pickSlash(s)}
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "8px",
                          padding: "6px 8px",
                          "border-radius": "4px",
                          cursor: "pointer",
                          background: slashIndex() === i() ? "var(--color-accent-subtle)" : "transparent",
                          "font-family": FONT_MONO,
                          "font-size": "11px",
                          color: "var(--color-text)",
                        }}
                      >
                        <span style={{ "flex-shrink": 0 }}>/{s.name}</span>
                        <Show when={s.description}>
                          <span
                            style={{
                              flex: 1,
                              "min-width": 0,
                              "font-size": "11px",
                              color: "var(--color-text-faint)",
                              "white-space": "nowrap",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                            }}
                          >
                            {s.description}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            {/* Model picker portal — trigger lives top-right beside Notebook. */}
            <Show when={modelOpen()}>
              <Portal>
                <div onClick={() => setModelOpen(false)} style={{ position: "fixed", inset: 0, "z-index": 190 }} />
                <Show when={anchor()}>
                  {(a) => (
                    <div
                      class={REDUCE_MOTION ? undefined : a().up ? "thesis-pop-up" : "thesis-fade-in"}
                      role="dialog"
                      aria-label="Select model"
                      style={{
                        position: "fixed",
                        left: `${a().left}px`,
                        ...(a().up ? { bottom: `${a().bottom}px` } : { top: `${a().top}px` }),
                        width: `${a().width}px`,
                        "max-height": `${a().maxH}px`,
                        display: "flex",
                        "flex-direction": "column",
                        background: "var(--color-surface-solid)",
                        border: "1px solid var(--color-border-strong)",
                        "border-radius": "4px",
                        "box-shadow": "0 16px 44px rgba(0, 0, 0, 0.18), 0 3px 10px rgba(0, 0, 0, 0.10)",
                        overflow: "hidden",
                        "z-index": 200,
                        "transform-origin": a().up ? "bottom right" : "top right",
                      }}
                    >
                      {/* search */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "9px",
                          padding: "10px 12px",
                          "border-bottom": "1px solid var(--color-border)",
                          "flex-shrink": 0,
                        }}
                      >
                        <span style={{ display: "inline-flex", color: "var(--color-text-faint)", "flex-shrink": 0 }}>
                          <IconSearch size={13} strokeWidth={1.5} />
                        </span>
                        <input
                          ref={modelSearchRef}
                          value={modelQuery()}
                          onInput={(e) => {
                            setModelQuery(e.currentTarget.value)
                            setModelIndex(0)
                          }}
                          onKeyDown={onModelSearchKey}
                          placeholder="search models"
                          spellcheck={false}
                          autocomplete="off"
                          style={{
                            all: "unset",
                            flex: 1,
                            "min-width": 0,
                            "font-family": FONT_SANS,
                            "font-size": "13px",
                            color: "var(--color-text)",
                          }}
                        />
                        <kbd
                          style={{
                            "font-family": FONT_MONO,
                            "font-size": "10px",
                            color: "var(--color-text-faint)",
                            border: "1px solid var(--color-border)",
                            "border-radius": "4px",
                            padding: "1px 5px",
                            "flex-shrink": 0,
                          }}
                        >
                          esc
                        </kbd>
                      </div>

                      {/* list */}
                      <div
                        class="thesis-scroll"
                        role="listbox"
                        aria-label="Models"
                        style={{ overflow: "auto", padding: "4px", "min-height": 0, flex: 1 }}
                      >
                        <Show
                          when={flatRows().length > 0}
                          fallback={
                            <div
                              style={{
                                padding: "22px 14px",
                                "font-family": FONT_SANS,
                                "font-size": "13px",
                                color: "var(--color-text-faint)",
                                "line-height": 1.5,
                              }}
                            >
                              no models match “{modelQuery()}”.
                              <br />
                              add a provider key in settings, then refresh.
                            </div>
                          }
                        >
                          <For each={modelGroups()}>
                            {(group) => (
                              <div style={{ "margin-bottom": "2px" }}>
                                <div
                                  style={{
                                    position: "sticky",
                                    top: 0,
                                    "z-index": 1,
                                    display: "flex",
                                    "align-items": "baseline",
                                    "justify-content": "space-between",
                                    gap: "8px",
                                    padding: "9px 10px 4px",
                                    background: "var(--color-surface-solid)",
                                    "font-family": FONT_MONO,
                                    "font-size": "10px",
                                    "font-weight": 500,
                                    "letter-spacing": "0.02em",
                                    "text-transform": "lowercase",
                                    color: "var(--color-text-faint)",
                                  }}
                                >
                                  <span
                                    style={{
                                      overflow: "hidden",
                                      "text-overflow": "ellipsis",
                                      "white-space": "nowrap",
                                    }}
                                  >
                                    {group.name}
                                  </span>
                                  <span style={{ opacity: 0.6 }}>{group.items.length}</span>
                                </div>
                                <For each={group.items}>
                                  {(row, i) => {
                                    const flatIndex = () => group.offset + i()
                                    const active = () =>
                                      model()?.providerID === row.provider.id && model()?.modelID === row.id
                                    const highlighted = () => modelIndex() === flatIndex()
                                    const dot = SOURCE_DOT[rowSource(row.provider.id)]
                                    const price = () => rateFor(row.cost as ModelCostShape, active() && longCtx())
                                    return (
                                      <div
                                        ref={(el) => (modelRowRefs[flatIndex()] = el)}
                                        role="option"
                                        aria-selected={active()}
                                        title={`${providerLabel(row.provider.id)} · ${row.id} · ${formatTokens(row.limit?.context)} ctx`}
                                        onClick={() => selectRowAt(flatIndex())}
                                        onMouseEnter={() => setModelIndex(flatIndex())}
                                        style={{
                                          cursor: "pointer",
                                          display: "flex",
                                          "align-items": "center",
                                          gap: "10px",
                                          width: "100%",
                                          "box-sizing": "border-box",
                                          padding: "7px 10px",
                                          "border-radius": "4px",
                                          background: active()
                                            ? "var(--color-accent-subtle)"
                                            : highlighted()
                                              ? "var(--color-bg-elevated)"
                                              : "transparent",
                                          transition: REDUCE_MOTION ? undefined : "background 120ms ease",
                                        }}
                                      >
                                        <span
                                          style={{
                                            flex: 1,
                                            "min-width": 0,
                                            display: "flex",
                                            "flex-direction": "column",
                                            gap: "4px",
                                          }}
                                        >
                                          <span
                                            style={{
                                              display: "flex",
                                              "align-items": "center",
                                              gap: "7px",
                                              "min-width": 0,
                                            }}
                                          >
                                            <Show when={dot.meters}>
                                              <span
                                                title={dot.title}
                                                style={{
                                                  width: "5px",
                                                  height: "5px",
                                                  "border-radius": "50%",
                                                  "flex-shrink": 0,
                                                  background: dot.color,
                                                  opacity: dot.opacity,
                                                }}
                                              />
                                            </Show>
                                            <span
                                              style={{
                                                "font-family": FONT_SANS,
                                                "font-size": "13px",
                                                "font-weight": 400,
                                                color: "var(--color-text)",
                                                overflow: "hidden",
                                                "text-overflow": "ellipsis",
                                                "white-space": "nowrap",
                                              }}
                                            >
                                              {row.name}
                                            </span>
                                            <Show when={row.latest}>
                                              <span
                                                style={{
                                                  "flex-shrink": 0,
                                                  "font-family": FONT_MONO,
                                                  "font-size": "10px",
                                                  color: "var(--color-text-faint)",
                                                }}
                                              >
                                                latest
                                              </span>
                                            </Show>
                                            <Show when={isCodexModel(row.provider.id, row.id)}>
                                              <span
                                                style={{
                                                  "flex-shrink": 0,
                                                  "font-family": FONT_MONO,
                                                  "font-size": "10px",
                                                  color: "var(--color-text-faint)",
                                                  opacity: 0.85,
                                                }}
                                              >
                                                codex
                                              </span>
                                            </Show>
                                          </span>
                                        </span>
                                        <span
                                          style={{
                                            "flex-shrink": 0,
                                            display: "flex",
                                            "align-items": "center",
                                            gap: "10px",
                                          }}
                                        >
                                          <Show
                                            when={!price().free}
                                            fallback={
                                              <span
                                                style={{
                                                  "font-family": FONT_MONO,
                                                  "font-size": "11px",
                                                  color: "var(--color-text-faint)",
                                                }}
                                              >
                                                free
                                              </span>
                                            }
                                          >
                                            <span
                                              title="$ per 1M tokens · input / output"
                                              style={{
                                                "font-family": FONT_MONO,
                                                "font-size": "11px",
                                                "font-variant-numeric": "tabular-nums",
                                                color: "var(--color-text-faint)",
                                                "white-space": "nowrap",
                                              }}
                                            >
                                              {price().input} <span style={{ opacity: 0.4 }}>/</span> {price().output}
                                            </span>
                                          </Show>
                                          <span
                                            style={{
                                              width: "12px",
                                              display: "inline-flex",
                                              "justify-content": "center",
                                              color: "var(--color-accent)",
                                              "flex-shrink": 0,
                                            }}
                                          >
                                            <Show when={active()}>✓</Show>
                                          </span>
                                        </span>
                                      </div>
                                    )
                                  }}
                                </For>
                                <Show when={group.folded > 0}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleGroup(group.id)
                                    }}
                                    style={{
                                      all: "unset",
                                      "box-sizing": "border-box",
                                      cursor: "pointer",
                                      display: "flex",
                                      "align-items": "center",
                                      gap: "6px",
                                      width: "100%",
                                      padding: "5px 10px 7px",
                                      "font-family": FONT_MONO,
                                      "font-size": "10px",
                                      "letter-spacing": "0.02em",
                                      "text-transform": "lowercase",
                                      color: "var(--color-text-faint)",
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-faint)")}
                                  >
                                    {group.open ? "show fewer" : `${group.folded} older`}
                                    <span style={{ opacity: 0.7 }}>{group.open ? "▴" : "▾"}</span>
                                  </button>
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>

                      {/* controls for the selected model — speed / context in the footer */}
                      <Show when={!!model() && (supportsFast() || hasLongTier())}>
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "flex",
                            "flex-wrap": "wrap",
                            "align-items": "center",
                            gap: "16px",
                            padding: "9px 12px",
                            "border-top": "1px solid var(--color-border)",
                            "flex-shrink": 0,
                          }}
                        >
                          <Show when={supportsFast()}>
                            <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                              <span style={CONTROL_LABEL}>speed</span>
                              <Segmented
                                options={[
                                  { id: "normal", label: "normal" },
                                  { id: "fast", label: "fast" },
                                ]}
                                value={fast() ? "fast" : "normal"}
                                onPick={(id) => setFast(id === "fast")}
                              />
                            </span>
                          </Show>
                          <Show when={hasLongTier()}>
                            <span style={{ display: "inline-flex", "align-items": "center", gap: "6px" }}>
                              <span style={CONTROL_LABEL}>context</span>
                              <Segmented
                                options={[
                                  { id: "std", label: "≤200k" },
                                  { id: "long", label: ">200k" },
                                ]}
                                value={longCtx() ? "long" : "std"}
                                onPick={(id) => setLongCtx(id === "long")}
                              />
                            </span>
                          </Show>
                        </div>
                      </Show>

                      {/* footer */}
                      <a
                        href={BYOK_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "space-between",
                          padding: "9px 12px",
                          "border-top": "1px solid var(--color-border)",
                          "font-family": FONT_MONO,
                          "font-size": "11px",
                          color: "var(--color-text-muted)",
                          "text-decoration": "none",
                          "flex-shrink": 0,
                        }}
                      >
                        <span>manage models</span>
                        <span style={{ color: "var(--color-text-faint)" }}>↗</span>
                      </a>
                    </div>
                  )}
                </Show>
              </Portal>
            </Show>

            <div style={{ position: "relative", display: "inline-flex" }}>
              <button
                type="button"
                title="任务控制"
                aria-label="任务控制"
                aria-expanded={taskControlOpen()}
                onClick={() => setTaskControlOpen((open) => !open)}
                style={{
                  all: "unset",
                  "box-sizing": "border-box",
                  cursor: "pointer",
                  height: "28px",
                  padding: "0 7px",
                  color: taskControl() ? "var(--color-text)" : "var(--color-text-faint)",
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "3px",
                  "border-radius": "4px",
                  background: taskControlOpen() ? "var(--color-accent-subtle)" : "transparent",
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                }}
              >
                任务
                <IconChevronDown size={10} strokeWidth={1.5} />
              </button>
              <Show when={taskControlOpen()}>
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    bottom: "34px",
                    left: 0,
                    width: "260px",
                    padding: "4px",
                    background: "var(--color-surface-solid)",
                    border: "1px solid var(--color-border-strong)",
                    "border-radius": "4px",
                    "box-shadow": "var(--shadow-md)",
                    "z-index": 40,
                  }}
                >
                  <For each={taskControls}>
                    {(item) => (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setTaskControl(item.id)
                          setTaskControlOpen(false)
                          textareaRef?.focus()
                        }}
                        style={{
                          all: "unset",
                          "box-sizing": "border-box",
                          cursor: "pointer",
                          display: "flex",
                          "flex-direction": "column",
                          gap: "2px",
                          width: "100%",
                          padding: "7px 8px",
                          "border-radius": "4px",
                          background: taskControl() === item.id ? "var(--color-accent-subtle)" : "transparent",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-elevated)")}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            taskControl() === item.id ? "var(--color-accent-subtle)" : "transparent"
                        }}
                      >
                        <span style={{ "font-family": FONT_SANS, "font-size": "12px", color: "var(--color-text)" }}>
                          {item.label}
                        </span>
                        <span
                          style={{ "font-family": FONT_SANS, "font-size": "11px", color: "var(--color-text-faint)" }}
                        >
                          {item.description}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <button
              type="button"
              title="attach file (or drop / paste)"
              onClick={openFilePicker}
              style={{
                all: "unset",
                "box-sizing": "border-box",
                cursor: "pointer",
                height: "28px",
                padding: "0 7px",
                color: attachments().length > 0 ? "var(--color-text)" : "var(--color-text-faint)",
                display: "inline-flex",
                "align-items": "center",
                gap: "4px",
                "border-radius": "4px",
                "font-family": FONT_MONO,
                "font-size": "12px",
              }}
            >
              <IconPaperclip size={13} strokeWidth={1.5} />
              <Show when={attachments().length > 0}>
                <span>{attachments().length}</span>
              </Show>
            </button>

            <button
              type="button"
              title="browse skills (or type / in the prompt)"
              onClick={() => setSkillsOpen((v) => !v)}
              style={{
                all: "unset",
                "box-sizing": "border-box",
                cursor: "pointer",
                height: "28px",
                padding: "0 7px",
                color: skillsOpen() ? "var(--color-text)" : "var(--color-text-faint)",
                display: "inline-flex",
                "align-items": "center",
                "border-radius": "4px",
                background: skillsOpen() ? "var(--color-accent-subtle)" : "transparent",
              }}
            >
              <IconSparkles size={13} strokeWidth={1.5} />
            </button>

            <span style={{ flex: 1 }} />

            <Show when={isWorking() || inflight()}>
              <span
                style={{
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-text-faint)",
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "5px",
                }}
              >
                <AgentIcon
                  size={12}
                  animated
                  style={{
                    "--agent-icon-ink": "var(--color-text-faint)",
                    "--agent-icon-paper": "var(--color-surface-solid, var(--color-bg))",
                  }}
                />
                streaming
              </span>
            </Show>

            <Show when={!submitting()}>
              <span
                style={{
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-text-faint)",
                }}
              >
                {isWorking() || inflight() ? "↵ to queue · ⇧↵ newline" : "↵ to send · ⇧↵ newline"}
              </span>
            </Show>

            <Show
              when={isWorking() || inflight()}
              fallback={
                <button
                  onClick={() => void submit()}
                  disabled={submitting() || (text().trim().length === 0 && attachments().length === 0)}
                  type="button"
                  title="send"
                  style={{
                    all: "unset",
                    "box-sizing": "border-box",
                    cursor: text().trim().length > 0 || attachments().length > 0 ? "pointer" : "default",
                    opacity: text().trim().length > 0 || attachments().length > 0 ? 1 : 0.35,
                    width: "32px",
                    height: "32px",
                    display: "inline-flex",
                    "align-items": "center",
                    "justify-content": "center",
                    "border-radius": "50%",
                    background:
                      text().trim().length > 0 || attachments().length > 0
                        ? "var(--color-accent)"
                        : "var(--color-border)",
                    color: "var(--color-on-accent)",
                    "font-family": FONT_MONO,
                    "font-size": "12px",
                    transition: "all 150ms ease",
                  }}
                >
                  <IconArrowUp size={16} strokeWidth={2} />
                </button>
              }
            >
              <button
                onClick={() => void stop()}
                type="button"
                title="stop streaming"
                style={{
                  all: "unset",
                  "box-sizing": "border-box",
                  cursor: "pointer",
                  width: "32px",
                  height: "32px",
                  display: "inline-flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "border-radius": "50%",
                  background: "var(--color-text)",
                  color: "var(--color-bg)",
                  "font-family": FONT_MONO,
                  "font-size": "12px",
                  transition: "all 150ms ease",
                }}
              >
                <IconStop size={14} strokeWidth={2} />
              </button>
            </Show>
          </div>
        </div>
        <FloatingControls
          modelOpen={modelOpen}
          setModelOpen={setModelOpen}
          selectedLabel={selectedLabel}
          selectedSource={selectedSource}
          modelBtnRef={(el: HTMLButtonElement) => {
            modelBtnRef = el
          }}
          effortOpen={effortOpen}
          setEffortOpen={setEffortOpen}
          variantKeys={variantKeys}
          effort={effort}
          setEffort={setEffort}
          effortBtnRef={(el: HTMLButtonElement) => {
            effortBtnRef = el
          }}
          effortAnchor={effortAnchor}
          composeWrapRef={composeWrapRef}
        />
      </div>
    </div>
  )
}

// Faint caption preceding a segmented control ("effort" / "speed" / "context").
const CONTROL_LABEL: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "10px",
  color: "var(--color-text-faint)",
  "text-transform": "lowercase",
}

// Cursor-style segmented control: a quiet row of peers where the selected one is
// marked by a faint tint + hairline border at a consistent weight — never bold.
// Used on the active model row for the effort keys, the fast/normal speed toggle,
// and the context tier.
function Segmented(props: {
  options: { id: string; label: string }[]
  value: string
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <span style={{ display: "inline-flex", gap: "2px" }} onClick={(e) => e.stopPropagation()}>
      <For each={props.options}>
        {(o) => {
          const on = () => props.value === o.id
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                props.onPick(o.id)
              }}
              style={{
                all: "unset",
                cursor: "pointer",
                "font-family": FONT_MONO,
                "font-size": "11px",
                "font-weight": 400,
                "text-transform": "lowercase",
                color: on() ? "var(--color-text)" : "var(--color-text-muted)",
                background: on() ? "var(--color-accent-subtle)" : "transparent",
                border: on() ? "1px solid var(--color-border)" : "1px solid transparent",
                "border-radius": "4px",
                padding: "1px 7px",
                "line-height": 1.5,
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => {
                if (!on()) e.currentTarget.style.background = "var(--color-bg-elevated)"
              }}
              onMouseLeave={(e) => {
                if (!on()) e.currentTarget.style.background = "transparent"
              }}
            >
              {o.label}
            </button>
          )
        }}
      </For>
    </span>
  )
}

function AttachmentChip(props: { att: Attachment; onRemove: () => void }): JSX.Element {
  const isImage = () => props.att.mime.startsWith("image/")
  const sizeLabel = () => {
    const s = props.att.size
    if (s < 1024) return `${s}B`
    if (s < 1024 * 1024) return `${(s / 1024).toFixed(0)}KB`
    return `${(s / (1024 * 1024)).toFixed(1)}MB`
  }
  const statusLabel = () => {
    if (props.att.status === "saving") return "saving…"
    if (props.att.status === "failed") return "not saved"
    if (props.att.path) return props.att.path
    return CONTEXT_DIR + "/"
  }
  return (
    <div
      title={`${props.att.filename} · ${sizeLabel()} · ${statusLabel()}`}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
        padding: "3px 6px 3px 4px",
        "border-radius": "4px",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        "font-family": FONT_MONO,
        "font-size": "11px",
        color: "var(--color-text)",
        "max-width": "280px",
        opacity: props.att.status === "saving" ? 0.7 : 1,
      }}
    >
      <Show when={isImage()} fallback={<IconPaperclip size={11} strokeWidth={1.5} />}>
        <img
          src={props.att.dataUrl}
          alt={props.att.filename}
          style={{
            width: "18px",
            height: "18px",
            "object-fit": "cover",
            "border-radius": "4px",
          }}
        />
      </Show>
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          flex: 1,
          "min-width": 0,
        }}
      >
        {props.att.filename}
      </span>
      <span style={{ color: "var(--color-text-faint)", "font-size": "10px" }}>
        {props.att.status === "saving" ? "…" : props.att.status === "failed" ? "!" : sizeLabel()}
      </span>
      <button
        type="button"
        title="remove"
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "0 4px",
          color: "var(--color-text-faint)",
          "font-size": "11px",
          "line-height": 1,
        }}
        onMouseEnter={(el) => (el.currentTarget.style.color = "var(--color-error)")}
        onMouseLeave={(el) => (el.currentTarget.style.color = "var(--color-text-faint)")}
      >
        ×
      </button>
    </div>
  )
}

// ── Floating controls (model + effort chips, below the composer) ──
// Rendered inline inside cs-composer-inner, below the input box. Only the
// effort slider popover is portaled.
function FloatingControls(props: {
  modelOpen: () => boolean
  setModelOpen: (v: boolean) => void
  selectedLabel: () => { name: string; providerID: string } | undefined
  selectedSource: () => { color: string; opacity: number; title: string } | undefined
  modelBtnRef: (el: HTMLButtonElement) => void
  effortOpen: () => boolean
  setEffortOpen: (v: boolean) => void
  variantKeys: () => string[]
  effort: () => string | undefined
  setEffort: (v: string | undefined) => void
  effortBtnRef: (el: HTMLButtonElement) => void
  effortAnchor: () => { left: number; bottom: number; width: number; up: boolean } | undefined
  composeWrapRef: HTMLDivElement | undefined
}): JSX.Element {
  const effortLabel = () => {
    const key = props.effort()
    if (!key) return undefined
    const labels: Record<string, string> = {
      none: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    }
    return labels[key] ?? key
  }

  return (
    <div
      class="cs-floating-controls"
      style={{
        display: "flex",
        "align-items": "flex-end",
        gap: "8px",
        "margin-top": "8px",
        "pointer-events": "none",
      }}
    >
      {/* Effort chip */}
      <Show when={props.variantKeys().length > 0}>
        <button
          ref={props.effortBtnRef}
          type="button"
          class="cs-floating-chip"
          onClick={() => props.setEffortOpen(!props.effortOpen())}
          title={`reasoning effort: ${effortLabel() ?? "none"}`}
        >
          <span
            style={{
              "font-family": FONT_MONO,
              "font-size": "11px",
              "text-transform": "lowercase",
            }}
          >
            {effortLabel() ?? "effort"}
          </span>
          <IconChevronDown size={8} strokeWidth={1.5} />
        </button>
      </Show>

      {/* Model chip */}
      <button
        ref={props.modelBtnRef}
        type="button"
        class="cs-floating-chip"
        onClick={() => props.setModelOpen(!props.modelOpen())}
        title={
          props.selectedLabel()
            ? `${props.selectedLabel()!.name}${props.selectedSource() ? ` — ${props.selectedSource()!.title}` : ""}`
            : "select model"
        }
      >
        <Show when={props.selectedSource()}>
          {(dot) => (
            <span
              style={{
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                "flex-shrink": 0,
                background: dot().color,
                opacity: dot().opacity,
              }}
            />
          )}
        </Show>
        <span
          style={{
            "font-family": FONT_MONO,
            "font-size": "11px",
            "max-width": "180px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.selectedLabel()?.name ?? "select model"}
        </span>
        <IconChevronDown size={8} strokeWidth={1.5} />
      </button>

      {/* Effort slider popover */}
      <Show when={props.effortOpen()}>
        <Portal>
          <div onClick={() => props.setEffortOpen(false)} style={{ position: "fixed", inset: 0, "z-index": 190 }} />
          <Show when={props.effortAnchor()}>
            {(a) => (
              <div
                class="thesis-fade-in cs-effort-popover"
                role="dialog"
                aria-label="Reasoning effort"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: `${a().left}px`,
                  bottom: `${a().bottom}px`,
                  width: `${a().width}px`,
                }}
              >
                <span class="cs-effort-popover-label">effort</span>
                <EffortSlider
                  options={props.variantKeys()}
                  value={props.effort() ?? props.variantKeys()[0]}
                  onPick={(key) => {
                    props.setEffort(key)
                    props.setEffortOpen(false)
                  }}
                />
              </div>
            )}
          </Show>
        </Portal>
      </Show>
    </div>
  )
}
