import {
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  type PermissionRequest,
  type QuestionRequest,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@hysci/sdk/v2/client"
import { type FileDiff } from "@hysci/sdk/v2"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { type UiI18nKey, type UiI18nParams, useI18n } from "../context/i18n"
import { findLast, shallowEqual } from "@hysci/util/array"
import { getDirectory, getFilename } from "@hysci/util/path"

import { Binary } from "@hysci/util/binary"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Message, Part } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { Card } from "./card"
import { Dynamic, Portal } from "solid-js/web"
import { Button } from "./button"
import { AgentStreamIcon } from "./agent-stream-icon"
import { Tooltip } from "./tooltip"
import { createStore } from "solid-js/store"
import { DateTime, DurationUnit, Interval } from "luxon"
import { createAutoScroll } from "../hooks"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import {
  collectDecisionCards,
  splitTextAroundQuestion,
  isStatusNarration,
  collectResultFiles,
  customerFacingResultFiles,
  formatSectionForDisplay,
  hasStructuredResult,
  isUserStopError,
  resultFileCtaKind,
  resultFileCtaName,
  resultFileGlyph,
  resultFileHowLabel,
  resultFileTypeLabel,
  resultFileVisual,
  splitResultSections,
  type ResultFile,
} from "./session-result"
import { ChoiceCard } from "./choice-card"
import { partStamp, turnClockEnd } from "./turn-clock"

type Translator = (key: UiI18nKey, params?: UiI18nParams) => string

function computeStatusFromPart(part: PartType | undefined, t: Translator): string | undefined {
  if (!part) return undefined

  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
      case "websearch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      case "notebook":
      case "rkernel":
        return t("ui.sessionTurn.status.runningComputation")
      case "skill":
        return t("ui.sessionTurn.status.loadingSkill")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") {
    const text = (part as ReasoningPart).text ?? ""
    const match = text.trimStart().match(/^\*\*(.+?)\*\*/)
    if (match) return t("ui.sessionTurn.status.thinkingWithTopic", { topic: match[1].trim() })
    return t("ui.sessionTurn.status.thinking")
  }
  if (part.type === "text") {
    return t("ui.sessionTurn.status.writingOutput")
  }
  return undefined
}

function ResultFileCards(props: {
  files: ResultFile[]
  onOpenFile?: (path: string) => void
  onPreviewFile?: (path: string) => void
  renderFilePreview?: (file: ResultFile) => JSX.Element | undefined
}) {
  const i18n = useI18n()
  const [limit, setLimit] = createSignal(6)
  const visible = createMemo(() => props.files.slice(0, limit()))
  const remaining = createMemo(() => Math.max(0, props.files.length - limit()))
  const thumbs = createMemo(() => visible().filter(resultFileVisual))
  const chips = createMemo(() => visible().filter((file) => !resultFileVisual(file)))
  return (
    <Show when={props.files.length > 0}>
      <section data-slot="session-turn-result-files">
        <Show when={thumbs().length > 0}>
          <div data-slot="session-turn-result-files-grid">
            <For each={thumbs()}>
              {(file) => (
                <ResultFileTile
                  file={file}
                  preview={props.renderFilePreview?.(file)}
                  onOpenFile={props.onOpenFile}
                  onPreviewFile={props.onPreviewFile}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={chips().length > 0}>
          <div data-slot="session-turn-result-files-chips">
            <For each={chips()}>
              {(file) => (
                <ResultFileTile file={file} onOpenFile={props.onOpenFile} onPreviewFile={props.onPreviewFile} />
              )}
            </For>
          </div>
        </Show>
        <Show when={remaining() > 0}>
          <Button
            data-slot="session-turn-result-files-more"
            variant="ghost"
            size="small"
            aria-label={i18n.t("ui.sessionTurn.diff.showMore", { count: remaining() })}
            onClick={() => setLimit(props.files.length)}
          >
            +{remaining()} more
          </Button>
        </Show>
        <Show when={props.files.length > limit()}>
          <span data-slot="session-turn-result-files-header">展示 {limit()}</span>
        </Show>
      </section>
    </Show>
  )
}

function ResultFileTile(props: {
  file: ResultFile
  preview?: JSX.Element
  onOpenFile?: (path: string) => void
  onPreviewFile?: (path: string) => void
}) {
  const i18n = useI18n()
  const image = () => props.file.kind === "png" || props.file.kind === "jpg" || props.file.kind === "svg"
  const chip = () => !resultFileVisual(props.file)
  const glyph = () => resultFileGlyph(props.file.kind)
  const ext = () => props.file.name.slice(props.file.name.lastIndexOf(".") + 1).toUpperCase()
  const cta = () => {
    const name = resultFileCtaName(props.file.name)
    if (resultFileCtaKind(props.file) === "table") return i18n.t("ui.sessionTurn.resultFile.viewTable", { name })
    return i18n.t("ui.sessionTurn.resultFile.viewFile", { name })
  }
  const open = () => {
    if (image() || props.file.kind === "pdf") {
      props.onPreviewFile?.(props.file.path)
      return
    }
    props.onOpenFile?.(props.file.path)
  }
  return (
    <div
      data-slot="session-turn-result-file-tile"
      data-variant={chip() ? "chip" : "thumb"}
      data-role={props.file.role}
      role="button"
      tabIndex={0}
      onClick={() => open()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        open()
      }}
    >
      <Show
        when={chip()}
        fallback={
          <>
            <div data-slot="session-turn-result-file-preview">
              <Show
                when={props.preview}
                fallback={
                  <div data-slot="session-turn-result-file-placeholder">
                    <FileIcon
                      node={{ path: props.file.name, type: "file" }}
                      style={{ width: "30px", height: "30px" }}
                    />
                    <span>{ext()}</span>
                  </div>
                }
              >
                {(content) => content()}
              </Show>
            </div>
            <div data-slot="session-turn-result-file-caption">
              <div data-slot="session-turn-result-cta">{cta()}</div>
              <Show when={resultFileHowLabel(props.file, i18n.locale())}>
                {(label) => <div data-slot="session-turn-result-file-how">{label()}</div>}
              </Show>
            </div>
          </>
        }
      >
        <div data-slot="session-turn-result-file-glyph" data-tone={glyph().tone}>
          {glyph().mark}
        </div>
        <div data-slot="session-turn-result-file-meta">
          <div data-slot="session-turn-result-file-name">{props.file.name}</div>
          <div data-slot="session-turn-result-file-sub">{resultFileTypeLabel(props.file.kind, i18n.locale())}</div>
          <Show when={resultFileHowLabel(props.file, i18n.locale())}>
            {(label) => <div data-slot="session-turn-result-file-how">{label()}</div>}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function isAttachment(part: PartType | undefined) {
  if (part?.type !== "file") return false
  const mime = (part as FilePart).mime ?? ""
  return mime.startsWith("image/") || mime === "application/pdf"
}

function AssistantMessageItem(props: {
  message: AssistantMessage
  hideResponsePartIds: string[]
  hideReasoning: boolean
  hideTools?: string[]
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const msgParts = createMemo(() => data.store.part[props.message.id] ?? emptyParts)

  const filteredParts = createMemo(() => {
    const skip = new Set(props.hideTools ?? [])
    const hideText = new Set(props.hideResponsePartIds)
    return msgParts().filter((part) => {
      if (props.hideReasoning && part?.type === "reasoning") return false
      if (part?.type === "tool" && skip.has((part as ToolPart).tool)) return false
      if (part?.type === "tool" && (part as ToolPart).tool === "question") return false
      if (hideText.has(part.id)) return false
      return true
    })
  })

  return <Message message={props.message} parts={filteredParts()} />
}

function TurnTraceTrigger(props: {
  live: boolean
  expanded: boolean
  disabled: boolean
  label: string
  duration: string
  onToggle: () => void
}) {
  return (
    <div data-slot="session-turn-trace" data-live={props.live ? "true" : undefined}>
      <Button
        data-slot="session-turn-collapsible-trigger-content"
        data-expanded={props.expanded ? "true" : undefined}
        variant="ghost"
        size="small"
        onClick={() => {
          if (props.disabled) return
          props.onToggle()
        }}
        aria-expanded={props.expanded}
        aria-disabled={props.disabled}
      >
        <Show
          when={props.live}
          fallback={
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              data-slot="session-turn-trigger-icon"
            >
              <path
                d="M8.125 1.875H1.875L5 8.125L8.125 1.875Z"
                fill="currentColor"
                stroke="currentColor"
                stroke-linejoin="round"
              />
            </svg>
          }
        >
          <AgentStreamIcon />
        </Show>
        <span data-slot="session-turn-status-text">{props.label}</span>
        <Show when={props.duration}>
          <span aria-hidden="true">·</span>
          <span aria-live="off">{props.duration}</span>
        </Show>
      </Button>
    </div>
  )
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    sessionTitle?: string
    messageID: string
    lastUserMessageID?: string
    stepsExpanded?: boolean
    onStepsExpandedToggle?: () => void
    onUserInteracted?: () => void
    onRevertMessage?: (messageID: string) => void
    onOpenFile?: (path: string) => void
    onPreviewFile?: (path: string) => void
    renderFilePreview?: (file: ResultFile) => JSX.Element | undefined
    onRevealFile?: (path: string) => void
    onOpenInApp?: (path: string, app?: "excel") => void
    hideTools?: string[]
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const i18n = useI18n()
  const data = useData()
  const diffComponent = useDiffComponent()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyFiles: FilePart[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyPermissions: PermissionRequest[] = []
  const emptyQuestions: QuestionRequest[] = []
  const emptyPromptParts: { part: ToolPart; message: AssistantMessage }[] = []
  const emptyDiffs: FileDiff[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => data.store.message[props.sessionID] ?? emptyMessages)

  const messageIndex = createMemo(() => {
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, props.messageID, (m) => m.id)
    if (!result.found) return -1

    const msg = messages[result.index]
    if (!msg || msg.role !== "user") return -1

    return result.index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const messages = allMessages() ?? emptyMessages
    const msg = messages[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const lastUserMessageID = createMemo(() => {
    if (props.lastUserMessageID) return props.lastUserMessageID

    const messages = allMessages() ?? emptyMessages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role === "user") return msg.id
    }
    return undefined
  })

  const isLastUserMessage = createMemo(() => props.messageID === lastUserMessageID())

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return data.store.part[msg.id] ?? emptyParts
  })

  const attachmentParts = createMemo(() => {
    const msgParts = parts()
    if (msgParts.length === 0) return emptyFiles
    return msgParts.filter((part) => isAttachment(part)) as FilePart[]
  })

  const stickyParts = createMemo(() => {
    const msgParts = parts()
    if (msgParts.length === 0) return emptyParts
    if (attachmentParts().length === 0) return msgParts
    return msgParts.filter((part) => !isAttachment(part))
  })

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages() ?? emptyMessages
      const index = messageIndex()
      if (index < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = index + 1; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "user") break
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: shallowEqual },
  )

  const lastAssistantMessage = createMemo(() => assistantMessages().at(-1))

  const error = createMemo(() => assistantMessages().find((m) => m.error)?.error)
  const stopped = createMemo(() => isUserStopError(error()))
  const displayError = createMemo(() => (stopped() ? undefined : error()))

  const reasoningParts = createMemo(() => {
    const out: { id: string; text: string }[] = []
    for (const msg of assistantMessages()) {
      for (const part of data.store.part[msg.id] ?? emptyParts) {
        if (part?.type !== "reasoning") continue
        const text = (part as ReasoningPart).text?.trim()
        if (text) out.push({ id: part.id, text })
      }
    }
    return out
  })

  const textParts = createMemo(() => {
    const out: TextPart[] = []
    for (const msg of assistantMessages()) {
      for (const part of data.store.part[msg.id] ?? emptyParts) {
        if (part?.type !== "text") continue
        const text = (part as TextPart).text?.trim()
        if (text) out.push(part as TextPart)
      }
    }
    return out
  })
  const lastTextPart = createMemo(() => textParts().at(-1))
  const textAroundQuestion = createMemo(() =>
    splitTextAroundQuestion({
      assistantMessages: assistantMessages(),
      partsByMessage: data.store.part,
    }),
  )
  const hideResponsePartIds = createMemo(() => {
    const ids = [
      lastTextPart()?.id,
      ...textAroundQuestion().before.map((part) => part.id),
      ...textAroundQuestion().after.map((part) => part.id),
    ].filter((id): id is string => !!id)
    return [...new Set(ids)]
  })
  const decisionCards = createMemo(() =>
    collectDecisionCards({
      assistantMessages: assistantMessages(),
      partsByMessage: data.store.part,
    }),
  )

  const hasSteps = createMemo(() => {
    for (const m of assistantMessages()) {
      const msgParts = data.store.part[m.id]
      if (!msgParts) continue
      for (const p of msgParts) {
        if (p?.type === "tool") return true
      }
    }
    return false
  })

  const permissions = createMemo(() => data.store.permission?.[props.sessionID] ?? emptyPermissions)
  const permissionCount = createMemo(() => permissions().length)
  const nextPermission = createMemo(() => permissions()[0])

  const questions = createMemo(() => data.store.question?.[props.sessionID] ?? emptyQuestions)
  const questionCount = createMemo(() => questions().length)
  const nextQuestion = createMemo(() => questions()[0])

  const findPromptPart = (request: PermissionRequest | QuestionRequest | undefined) => {
    if (!request?.tool) return undefined

    const message = findLast(assistantMessages(), (m) => m.id === request.tool!.messageID)
    if (!message) return undefined

    const parts = data.store.part[message.id] ?? emptyParts
    for (const part of parts) {
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      if (tool.callID === request.tool!.callID) return { part: tool, message }
    }

    return undefined
  }

  // Pending permission and question prompts render inside their tool part,
  // which is hidden while steps are collapsed — surface those parts below
  // the trigger so the user can respond without expanding steps.
  const promptParts = createMemo(() => {
    if (props.stepsExpanded) return emptyPromptParts

    const result: { part: ToolPart; message: AssistantMessage }[] = []
    const permission = findPromptPart(nextPermission())
    if (permission) result.push(permission)
    if (result.length === 0) return emptyPromptParts
    return result
  })

  const shellModePart = createMemo(() => {
    const p = parts()
    if (p.length === 0) return
    if (!p.every((part) => part?.type === "text" && (part?.hybio || (part as { synthetic?: boolean })?.synthetic)))
      return

    const msgs = assistantMessages()
    if (msgs.length !== 1) return

    const msgParts = data.store.part[msgs[0].id] ?? emptyParts
    if (msgParts.length !== 1) return

    const assistantPart = msgParts[0]
    if (assistantPart?.type === "tool" && assistantPart.tool === "bash") return assistantPart
  })

  const isShellMode = createMemo(() => !!shellModePart())

  const rawStatus = createMemo(() => {
    const msgs = assistantMessages()
    let last: PartType | undefined
    let currentTask: ToolPart | undefined

    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const msgParts = data.store.part[msgs[mi].id] ?? emptyParts
      for (let pi = msgParts.length - 1; pi >= 0; pi--) {
        const part = msgParts[pi]
        if (!part) continue
        if (!last) last = part

        if (
          part.type === "tool" &&
          part.tool === "task" &&
          part.state &&
          "metadata" in part.state &&
          part.state.metadata?.sessionId &&
          part.state.status === "running"
        ) {
          currentTask = part as ToolPart
          break
        }
      }
      if (currentTask) break
    }

    const taskSessionId =
      currentTask?.state && "metadata" in currentTask.state
        ? (currentTask.state.metadata?.sessionId as string | undefined)
        : undefined

    if (taskSessionId) {
      const taskMessages = data.store.message[taskSessionId] ?? emptyMessages
      for (let mi = taskMessages.length - 1; mi >= 0; mi--) {
        const msg = taskMessages[mi]
        if (!msg || msg.role !== "assistant") continue

        const msgParts = data.store.part[msg.id] ?? emptyParts
        for (let pi = msgParts.length - 1; pi >= 0; pi--) {
          const part = msgParts[pi]
          if (part) return computeStatusFromPart(part, i18n.t)
        }
      }
    }

    return computeStatusFromPart(last, i18n.t)
  })

  const status = createMemo(() => data.store.session_status[props.sessionID] ?? idle)
  const working = createMemo(() => {
    const s = status()
    if (s.type === "idle") return false
    if (s.type === "busy" && "phase" in s && s.phase === "finalizing") return false
    // A pending question parks the loop: the turn is the user's, not the model's.
    if (s.type === "busy" && "phase" in s && s.phase === "waiting") return false
    return isLastUserMessage()
  })
  const pendingQuestionPart = createMemo(() => findPromptPart(nextQuestion()))
  const waitingOnQuestion = createMemo(() => questionCount() > 0)
  const toolBusy = createMemo(() => {
    for (const msg of assistantMessages()) {
      for (const part of data.store.part[msg.id] ?? emptyParts) {
        if (part?.type !== "tool") continue
        const state = (part as ToolPart).state?.status
        if (state === "pending" || state === "running") return true
      }
    }
    return false
  })
  const reasoningOpen = createMemo(() => {
    for (const msg of assistantMessages()) {
      for (const part of data.store.part[msg.id] ?? emptyParts) {
        if (part?.type !== "reasoning") continue
        if (!(part as ReasoningPart).time?.end) return true
      }
    }
    return false
  })
  const answerClosed = createMemo(() => {
    const part = lastTextPart()
    return !!part?.time?.end && !toolBusy() && !reasoningOpen()
  })
  const live = createMemo(() => working() && !waitingOnQuestion() && !answerClosed())
  const docked = createMemo(() => working() && isLastUserMessage() && !waitingOnQuestion())
  const [dock, setDock] = createSignal<HTMLElement>()
  onMount(() => {
    const node = document.querySelector("[data-chat-live-dock]")
    if (node instanceof HTMLElement) setDock(node)
  })
  createEffect(() => {
    if (dock()) return
    const node = document.querySelector("[data-chat-live-dock]")
    if (node instanceof HTMLElement) setDock(node)
  })
  const lastActivity = createMemo(() => {
    const stamp = assistantMessages().reduce((latest, item) => {
      const created = item.time.created ?? 0
      const completed = item.time.completed ?? 0
      const parts = data.store.part[item.id] ?? emptyParts
      const partTimes = parts.reduce((max, part) => Math.max(max, partStamp(part)), 0)
      return Math.max(latest, created, completed, partTimes)
    }, 0)
    return stamp || undefined
  })
  const awaitingChoice = createMemo(() => waitingOnQuestion() && isLastUserMessage())
  const retry = createMemo(() => {
    const s = status()
    if (s.type !== "retry") return
    return s
  })
  const hasTrace = createMemo(
    () => hasSteps() || reasoningParts().length > 0 || live() || awaitingChoice() || !!retry(),
  )
  const canExpand = createMemo(() => assistantMessages().length > 0 && (hasSteps() || reasoningParts().length > 0))

  const response = createMemo(() => lastTextPart()?.text)
  const beforeText = createMemo(() => (textAroundQuestion().before.at(-1)?.text ?? "").trim())
  const afterText = createMemo(() => (textAroundQuestion().after.at(-1)?.text ?? "").trim())
  const resultSections = createMemo(() => splitResultSections(afterText() || beforeText() || response() || ""))
  const responsePartId = createMemo(() => lastTextPart()?.id)
  const messageDiffs = createMemo(() => message()?.summary?.diffs ?? emptyDiffs)
  const hasDiffs = createMemo(() => messageDiffs().length > 0)
  const resultFiles = createMemo(() =>
    customerFacingResultFiles(
      collectResultFiles({
        assistantMessages: assistantMessages(),
        partsByMessage: data.store.part,
        responseText: response() ?? "",
      }),
    ),
  )
  const structuredResult = createMemo(() => hasStructuredResult(resultSections(), resultFiles().length))
  const sectionsFor = (text: string, live: boolean) => {
    const value = text.trim()
    if (!value) return []
    if (live) return [{ kind: "body" as const, text: value }]
    const sections = splitResultSections(value).filter((section) => section.text.trim())
    if (!resultFiles().length) return sections
    return sections.filter((section) => section.kind !== "deliverable")
  }
  const beforeSections = createMemo(() => {
    if (!beforeText()) return []
    return sectionsFor(beforeText(), working() && !afterText())
  })
  const afterSections = createMemo(() => {
    if (!afterText()) return []
    return sectionsFor(afterText(), working())
  })
  const visibleBefore = createMemo(() => {
    const text = beforeText()
    if (!text) return []
    if (working() && isStatusNarration(text) && !afterText()) return []
    return beforeSections()
  })
  const visibleAfter = createMemo(() => {
    const text = afterText()
    if (!text || isStatusNarration(text)) return []
    return afterSections()
  })
  const showLead = createMemo(
    () => visibleBefore().length > 0 && (visibleAfter().length > 0 || decisionCards().length > 0),
  )
  const cardSections = createMemo(() => {
    if (visibleAfter().length) return visibleAfter()
    if (decisionCards().length) return []
    return visibleBefore()
  })
  const showResponseCard = createMemo(
    () => cardSections().some((section) => section.text.trim()) || resultFiles().length > 0,
  )
  // Relocate the answer text out of the collapsed steps and into the top-level
  // Response block ALWAYS (not just after finishing), so it streams live like a
  // chat message instead of appearing only once the turn completes.
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = response() ?? ""
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const [rootRef, setRootRef] = createSignal<HTMLDivElement | undefined>()
  const [stickyRef, setStickyRef] = createSignal<HTMLDivElement | undefined>()

  const updateStickyHeight = (height: number) => {
    const root = rootRef()
    if (!root) return
    const next = Math.ceil(height)
    root.style.setProperty("--session-turn-sticky-height", `${next}px`)
  }

  // While a question is open the clock stops at the moment it was asked.
  const askedAt = createMemo(() => {
    const found = pendingQuestionPart()
    if (!found) return
    const state = found.part.state as { time?: { start?: number } } | undefined
    return state?.time?.start ?? lastAssistantMessage()?.time.created
  })

  function duration() {
    const msg = message()
    if (!msg) return ""
    const created = msg.time.created
    const from = DateTime.fromMillis(created)
    const end = turnClockEnd({
      created,
      now: Date.now(),
      live: live(),
      completed: lastAssistantMessage()?.time.completed,
      paused: awaitingChoice() ? askedAt() : undefined,
      lastActivity: lastActivity(),
    })
    const to = DateTime.fromMillis(Math.max(created, end))
    const interval = Interval.fromDateTimes(from, to)
    const unit: DurationUnit[] = interval.length("seconds") > 60 ? ["minutes", "seconds"] : ["seconds"]

    const locale = i18n.locale()
    const human = interval.toDuration(unit).normalize().reconfigure({ locale }).toHuman({
      notation: "compact",
      unitDisplay: "narrow",
      compactDisplay: "short",
      showZeros: false,
    })
    return locale.startsWith("zh") ? human.replaceAll("、", "") : human
  }

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "auto",
  })

  createResizeObserver(
    () => stickyRef(),
    ({ height }) => {
      updateStickyHeight(height)
    },
  )

  createEffect(() => {
    const root = rootRef()
    if (!root) return
    const sticky = stickyRef()
    if (!sticky) {
      root.style.setProperty("--session-turn-sticky-height", "0px")
      return
    }
    updateStickyHeight(sticky.getBoundingClientRect().height)
  })

  const diffInit = 20
  const diffBatch = 20

  const [store, setStore] = createStore({
    retrySeconds: 0,
    diffsOpen: [] as string[],
    diffLimit: diffInit,
    status: rawStatus(),
    duration: duration(),
  })
  const workingLabel = createMemo(() => {
    const r = retry()
    if (r) {
      const message = r.message.length > 60 ? r.message.slice(0, 60) + "..." : r.message
      return `${message} · ${i18n.t("ui.sessionTurn.retry.retrying")}${store.retrySeconds > 0 ? " " + i18n.t("ui.sessionTurn.retry.inSeconds", { seconds: store.retrySeconds }) : ""} (#${r.attempt})`
    }
    if (awaitingChoice()) return i18n.t("ui.sessionTurn.status.waitingChoice")
    if (live()) return store.status ?? i18n.t("ui.sessionTurn.status.consideringNextSteps")
    return i18n.t("ui.messagePart.reasoning.title")
  })

  createEffect(
    on(
      () => message()?.id,
      () => {
        setStore("diffsOpen", [])
        setStore("diffLimit", diffInit)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const r = retry()
    if (!r) {
      setStore("retrySeconds", 0)
      return
    }
    const updateSeconds = () => {
      const next = r.next
      if (next) setStore("retrySeconds", Math.max(0, Math.round((next - Date.now()) / 1000)))
    }
    updateSeconds()
    const timer = setInterval(updateSeconds, 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const update = () => {
      setStore("duration", duration())
    }

    update()

    // Tick only while tokens/tools are in flight. Chat stays mounted under
    // file/doc tabs, so a stuck `busy` status must not keep the clock running.
    if (!live()) return

    const timer = setInterval(update, 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(
    on(
      () => permissionCount() + questionCount(),
      (count, prev) => {
        if (!count) return
        if (prev !== undefined && count <= prev) return
        autoScroll.forceScrollToBottom()
      },
    ),
  )

  let lastStatusChange = Date.now()
  let statusTimeout: number | undefined
  createEffect(() => {
    const newStatus = rawStatus()
    if (newStatus === store.status || !newStatus) return

    const minStatusMs = working() ? 600 : 2500
    const timeSinceLastChange = Date.now() - lastStatusChange
    if (timeSinceLastChange >= minStatusMs) {
      setStore("status", newStatus)
      lastStatusChange = Date.now()
      if (statusTimeout) {
        clearTimeout(statusTimeout)
        statusTimeout = undefined
      }
    } else {
      if (statusTimeout) clearTimeout(statusTimeout)
      statusTimeout = setTimeout(() => {
        setStore("status", rawStatus())
        lastStatusChange = Date.now()
        statusTimeout = undefined
      }, minStatusMs - timeSinceLastChange) as unknown as number
    }
  })

  onCleanup(() => {
    if (!statusTimeout) return
    clearTimeout(statusTimeout)
  })

  return (
    <div data-component="session-turn" class={props.classes?.root} ref={setRootRef}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        class={props.classes?.content}
      >
        <div onClick={autoScroll.handleInteraction}>
          <Show when={message()}>
            {(msg) => (
              <div
                ref={autoScroll.contentRef}
                data-message={msg().id}
                data-slot="session-turn-message-container"
                class={props.classes?.container}
              >
                <Switch>
                  <Match when={isShellMode()}>
                    <Part part={shellModePart()!} message={msg()} defaultOpen />
                  </Match>
                  <Match when={true}>
                    <Show when={attachmentParts().length > 0}>
                      <div data-slot="session-turn-attachments" aria-live="off">
                        <Message message={msg()} parts={attachmentParts()} />
                      </div>
                    </Show>
                    <div data-slot="session-turn-sticky" ref={setStickyRef}>
                      {/* User Message */}
                      <div data-slot="session-turn-message-content" aria-live="off">
                        <Message
                          message={msg()}
                          parts={stickyParts()}
                          onRevert={props.onRevertMessage ? () => props.onRevertMessage?.(msg().id) : undefined}
                        />
                      </div>

                      <Show when={hasTrace() && !docked()}>
                        <TurnTraceTrigger
                          live={false}
                          expanded={!!props.stepsExpanded}
                          disabled={!canExpand()}
                          label={
                            awaitingChoice() || retry() ? workingLabel() : i18n.t("ui.messagePart.reasoning.title")
                          }
                          duration={store.duration}
                          onToggle={() => props.onStepsExpandedToggle?.()}
                        />
                      </Show>
                      <Show when={hasTrace() && docked() ? dock() : undefined}>
                        {(el) => (
                          <Portal mount={el()}>
                            <TurnTraceTrigger
                              live={live()}
                              expanded={!!props.stepsExpanded}
                              disabled={!canExpand()}
                              label={workingLabel()}
                              duration={store.duration}
                              onToggle={() => props.onStepsExpandedToggle?.()}
                            />
                          </Portal>
                        )}
                      </Show>
                    </div>
                    <Show when={props.stepsExpanded && canExpand()}>
                      <div data-slot="session-turn-trace-body" aria-live="off">
                        <Show when={reasoningParts().length > 0}>
                          <div data-slot="session-turn-reasoning-body">
                            <For each={reasoningParts()}>
                              {(item) => <Markdown text={item.text} cacheKey={item.id} />}
                            </For>
                          </div>
                        </Show>
                        <For each={assistantMessages()}>
                          {(assistantMessage) => (
                            <AssistantMessageItem
                              message={assistantMessage}
                              hideResponsePartIds={hideResponsePartIds()}
                              hideReasoning
                              hideTools={props.hideTools}
                            />
                          )}
                        </For>
                        <Show when={displayError()}>
                          <Card variant="error" class="error-card">
                            {displayError()?.data?.message as string}
                          </Card>
                        </Show>
                      </div>
                    </Show>
                    <Show when={!props.stepsExpanded && promptParts().length > 0}>
                      <div data-slot="session-turn-permission-parts">
                        <For each={promptParts()}>{({ part, message }) => <Part part={part} message={message} />}</For>
                      </div>
                    </Show>
                    {/* Response */}
                    <div class="sr-only" aria-live="polite">
                      {!working() && response() ? response() : ""}
                    </div>
                    <Show
                      when={showResponseCard() || hasDiffs() || resultFiles().length > 0 || decisionCards().length > 0}
                    >
                      <div
                        data-slot="session-turn-summary-section"
                        data-structured={!working() && structuredResult() ? "true" : undefined}
                      >
                        <div data-slot="session-turn-summary-header">
                          <Show when={showLead()}>
                            <section data-slot="session-turn-lead">
                              <For each={visibleBefore()}>
                                {(section, index) => (
                                  <Markdown
                                    text={formatSectionForDisplay(section)}
                                    cacheKey={`${responsePartId() ?? "response"}:before:${index()}:${section.kind}`}
                                  />
                                )}
                              </For>
                            </section>
                          </Show>
                          <Show when={decisionCards().length > 0}>
                            <section data-slot="session-turn-decision-card">
                              <For each={decisionCards()}>
                                {(item) => (
                                  <ChoiceCard
                                    review
                                    question={item.question}
                                    options={item.options}
                                    recommendation={item.recommendation}
                                    answer={item.answer}
                                    onPick={(answers) => {
                                      data.reviseQuestion?.({
                                        sessionID: props.sessionID,
                                        question: item.question,
                                        answers,
                                        messageID: item.messageID,
                                        partID: item.partID,
                                      })
                                    }}
                                    onSkip={() => undefined}
                                    onAgentDecide={() => undefined}
                                  />
                                )}
                              </For>
                            </section>
                          </Show>
                          <Show when={showResponseCard() || resultFiles().length > 0}>
                            <div data-slot="session-turn-response">
                              <For each={cardSections()}>
                                {(section, index) => (
                                  <section data-slot="session-turn-result-section" data-kind={section.kind}>
                                    <Markdown
                                      data-slot="session-turn-markdown"
                                      data-diffs={hasDiffs()}
                                      text={formatSectionForDisplay(section)}
                                      cacheKey={`${responsePartId() ?? "response"}:${index()}:${section.kind}`}
                                    />
                                  </section>
                                )}
                              </For>
                              <Show when={resultFiles().length > 0}>
                                <ResultFileCards
                                  files={resultFiles()}
                                  onOpenFile={props.onOpenFile}
                                  onPreviewFile={props.onPreviewFile}
                                  renderFilePreview={props.renderFilePreview}
                                />
                              </Show>
                              <Show when={showResponseCard()}>
                                <div data-slot="session-turn-response-copy-wrapper">
                                  <Tooltip
                                    value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                                    placement="top"
                                    gutter={8}
                                  >
                                    <IconButton
                                      icon={copied() ? "check" : "copy"}
                                      variant="secondary"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        handleCopy()
                                      }}
                                      aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                                    />
                                  </Tooltip>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        </div>
                        <Accordion
                          data-slot="session-turn-accordion"
                          multiple
                          value={store.diffsOpen}
                          onChange={(value) => {
                            if (!Array.isArray(value)) return
                            setStore("diffsOpen", value)
                          }}
                        >
                          <For each={messageDiffs().slice(0, store.diffLimit)}>
                            {(diff) => (
                              <Accordion.Item value={diff.file}>
                                <StickyAccordionHeader>
                                  <Accordion.Trigger>
                                    <div data-slot="session-turn-accordion-trigger-content">
                                      <div data-slot="session-turn-file-info">
                                        <FileIcon
                                          node={{ path: diff.file, type: "file" }}
                                          data-slot="session-turn-file-icon"
                                        />
                                        <div data-slot="session-turn-file-path">
                                          <Show when={diff.file.includes("/")}>
                                            <span data-slot="session-turn-directory">
                                              {`\u202A${getDirectory(diff.file)}\u202C`}
                                            </span>
                                          </Show>
                                          <span data-slot="session-turn-filename">{getFilename(diff.file)}</span>
                                        </div>
                                      </div>
                                      <div data-slot="session-turn-accordion-actions">
                                        <DiffChanges changes={diff} />
                                        <Icon name="chevron-grabber-vertical" size="small" />
                                      </div>
                                    </div>
                                  </Accordion.Trigger>
                                </StickyAccordionHeader>
                                <Accordion.Content data-slot="session-turn-accordion-content">
                                  <Show when={store.diffsOpen.includes(diff.file!)}>
                                    <Dynamic
                                      component={diffComponent}
                                      before={{
                                        name: diff.file!,
                                        contents: diff.before!,
                                      }}
                                      after={{
                                        name: diff.file!,
                                        contents: diff.after!,
                                      }}
                                    />
                                  </Show>
                                </Accordion.Content>
                              </Accordion.Item>
                            )}
                          </For>
                        </Accordion>
                        <Show when={messageDiffs().length > store.diffLimit}>
                          <Button
                            data-slot="session-turn-accordion-more"
                            variant="ghost"
                            size="small"
                            onClick={() => {
                              const total = messageDiffs().length
                              setStore("diffLimit", (limit) => {
                                const next = limit + diffBatch
                                if (next > total) return total
                                return next
                              })
                            }}
                          >
                            {i18n.t("ui.sessionTurn.diff.showMore", {
                              count: messageDiffs().length - store.diffLimit,
                            })}
                          </Button>
                        </Show>
                      </div>
                    </Show>
                    <Show when={pendingQuestionPart()}>
                      {(item) => (
                        <div data-slot="session-turn-question">
                          <Part part={item().part} message={item().message} />
                        </div>
                      )}
                    </Show>
                    <Show when={stopped()}>
                      <p data-slot="session-turn-stopped">{i18n.t("ui.sessionTurn.stopped")}</p>
                    </Show>
                    <Show when={displayError() && !props.stepsExpanded}>
                      <Card variant="error" class="error-card">
                        {displayError()?.data?.message as string}
                      </Card>
                    </Show>
                  </Match>
                </Switch>
              </div>
            )}
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
