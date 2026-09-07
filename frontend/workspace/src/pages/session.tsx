import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  ErrorBoundary,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { useNavigate, useParams } from "@solidjs/router"
import { produce } from "solid-js/store"
import { Binary } from "@hysci/util/binary"
import { SessionTurn } from "@hysci/ui/session-turn"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useSDK } from "@/context/sdk"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { Composer } from "@/thesis/Composer"
import { RightPane } from "@/thesis/RightPane"
import { ColumnHandle } from "@/thesis/ColumnHandle"
import { SIDEBAR_COL, rightReserved } from "@/thesis/column-width"
import { FileExplorer } from "@/thesis/FileExplorer"
import { FileView } from "@/thesis/FilePreview"
import { centerTabs } from "@/thesis/store/centerTabs"
import { FONT_MONO, FONT_SANS, FONT_SERIF } from "@/styles/tokens"
import { uiStore } from "@/thesis/store/ui"
import { useGlobalKeys } from "@/thesis/useGlobalKeys"
import { useDialog } from "@hysci/ui/context/dialog"
import { useModels } from "@/context/models"
import { openSetupDialog } from "@/thesis/SetupDialog"
import { confirmDialog } from "@/thesis/dialogs"
import { DialogSettings } from "@/components/dialog-settings"
import { DisconnectedPanel } from "@/thesis/DisconnectedPanel"
import { CommandPalette } from "@/thesis/CommandPalette"
import { HelpOverlay } from "@/thesis/HelpOverlay"
import { ToastContainer } from "@/thesis/Toast"
import {
  IconPlus,
  IconSettings,
  IconFile,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconTrash,
  IconBookOpen,
  IconArrowLeft,
  IconSearch,
  IconFolder,
  IconFolderOpen,
  IconStarFilled,
} from "@/thesis/shared/Icon"
import { AgentIcon } from "@/thesis/shared/AgentIcon"
import { useLanguage } from "@/context/language"
import { projectPrefs } from "@/thesis/store/projectPrefs"
import { SessionStatusLight } from "@/thesis/shared/SessionStatusLight"
import { ReviewStatusCard } from "@/components/session/review-status-card"
import { DomainSwitchCard } from "@/domain/DomainSwitchCard"
import { switchFromParts } from "@/domain/switch"
import { reviewForTurn, reviewState } from "@/utils/review"
import { InlineRename } from "@/thesis/shared/InlineRename"
import { decode64 } from "@/utils/base64"
import { projectLabel } from "@/utils/projectLabel"
import {
  findProjectByWorktree,
  formatHostFilePath,
  type HostFileRef,
  resolveHostFileRef,
  resolveProjectWorkingDir,
} from "@/utils/projectWorkspace"
import {
  assistantMessagesForLastTurn,
  collectRecentTurnFileNames,
  collectResultFiles,
  collectTaskFileNames,
  customerFacingResultFiles,
  type ResultFile,
} from "@hysci/ui/session-result"
import {
  migrateResultDirectory,
  isResultFolderName,
  normalizeResultFolderName,
  resultFolderName,
} from "@/utils/projectResult"
import { firstUserMessageText, getSessionDisplayTitle } from "@/utils/sessionDisplayTitle"
import { projectMetaLocal } from "@/thesis/store/projectMetaLocal"
import { projectDomainId } from "@/domain/registry"
import { lastSelectedDomain } from "@/domain/store"
import { sessionTitleLocal } from "@/thesis/store/sessionTitleLocal"
import { toast } from "@/thesis/Toast"
import { artifactImageUrl, artifactTable, type ArtifactData } from "@/utils/artifactPreview"

type SyncSession = ReturnType<typeof useSync>["data"]["session"][number]
/**
 * Session page — sidebar + chat/files center + inspector rail (terminal/review).
 */
export default function Page(): JSX.Element {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const sdk = useSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const dialog = useDialog()
  const [creating, setCreating] = createSignal(false)

  async function resolveOutputFile(path: string): Promise<HostFileRef> {
    const worktree = sync.data.path.directory || sdk.directory || sync.project?.worktree || ""
    const ref = resolveHostFileRef(worktree, path)
    if (path.includes("/") || path.startsWith("~") || path.startsWith("file://")) return ref

    const root: any = await sdk.client.file.list({ directory: worktree, path: "." }).catch(() => undefined)
    const rows = root?.data ?? root
    if (!Array.isArray(rows)) return ref
    const folders = rows.filter(
      (node: { type: string; name: string }) => node.type === "directory" && isResultFolderName(node.name),
    )
    for (const folder of folders) {
      const listing: any = await sdk.client.file.list({ directory: worktree, path: folder.name }).catch(() => undefined)
      const files = listing?.data ?? listing
      const file = Array.isArray(files)
        ? files.find((node: { type: string; name: string }) => node.type === "file" && node.name === path)
        : undefined
      if (file) return { directory: worktree, path: `${folder.name}/${file.name}` }
      const children = Array.isArray(files)
        ? files.filter(
            (node: { type: string; name: string }) => node.type === "directory" && !node.name.startsWith("."),
          )
        : []
      for (const child of children) {
        const nested: any = await sdk.client.file
          .list({ directory: worktree, path: `${folder.name}/${child.name}` })
          .catch(() => undefined)
        const nestedFiles = nested?.data ?? nested
        const nestedFile = Array.isArray(nestedFiles)
          ? nestedFiles.find((node: { type: string; name: string }) => node.type === "file" && node.name === path)
          : undefined
        if (nestedFile) return { directory: worktree, path: `${folder.name}/${child.name}/${nestedFile.name}` }
      }
    }
    return ref
  }

  async function previewImage(path: string) {
    const ref = await resolveOutputFile(path)
    if (!ref.path) {
      toast.error("preview failed", "invalid file path")
      return
    }
    uiStore.setImagePreview({
      ...ref,
      name: ref.path.split("/").pop() || ref.path,
    })
  }

  async function openFile(path: string) {
    const ref = await resolveOutputFile(path)
    if (!ref.path) {
      toast.error("open failed", "invalid file path")
      return
    }
    centerTabs.openFile(ref.directory, ref.path)
  }

  async function openLocalFile(path: string, action: "reveal" | "app", app?: "excel") {
    const ref = await resolveOutputFile(path)
    if (!ref.path) {
      toast.error("open failed", "invalid file path")
      return
    }
    const url = `${sdk.url.replace(/\/$/, "")}/file/open?directory=${encodeURIComponent(ref.directory)}`
    const res = await (platform.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ref.path, action, ...(app ? { app } : {}) }),
    })
    const body: { opened?: boolean; error?: string; message?: string } = await res.json().catch(() => ({}))
    if (res.ok && body.opened !== false) return
    toast.error("open failed", body.error ?? body.message ?? `HTTP ${res.status}`)
  }

  async function newSession() {
    if (creating()) return
    setCreating(true)
    try {
      const res: any = await sdk.client.session.create({
        directory: sdk.directory,
      } as any)
      const data = res?.data ?? res
      const id = data?.id ?? data?.sessionID
      if (id) {
        navigate(`/${params.dir}/session/${id}`)
      } else {
        navigate(`/${params.dir}/session/new`)
      }
    } catch {
      navigate(`/${params.dir}/session/new`)
    } finally {
      setCreating(false)
    }
  }

  const language = useLanguage()

  async function renameProject(name: string) {
    const worktree = projectWorktree()
    if (!worktree) return
    const trimmed = name.trim()
    if (!trimmed) return
    const p = projectRecord()
    try {
      const oldFolder = resultFolderName(worktree, p?.name ?? projectLabel(p ?? { worktree }))
      const nextFolder = normalizeResultFolderName(trimmed, worktree)
      if (oldFolder !== nextFolder) {
        await migrateResultDirectory(sdk.url, fetch, worktree, oldFolder, nextFolder)
      }
      projectMetaLocal.patch(worktree, { name: trimmed, resultFolderName: nextFolder })
      globalSync.project.meta(worktree, { name: trimmed })
      if (p?.id && p.id !== "global" && p.id !== worktree) {
        await sdk.client.project.update({
          projectID: p.id,
          directory: worktree,
          name: trimmed,
          resultFolder: nextFolder,
        } as any)
      }
    } catch (e: any) {
      toast.error(language.t("common.requestFailed"), e?.message ?? String(e))
    }
  }

  async function renameSession(sessionID: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    sessionTitleLocal.patch(sessionID, trimmed)
    const [, setStore] = globalSync.child(sdk.directory)
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, sessionID, (s) => s.id)
        if (match.found) draft.session[match.index].title = trimmed
      }),
    )
    try {
      const res = await sdk.client.session.update({ sessionID, title: trimmed })
      const updated = (res as { data?: { title?: string } })?.data
      if (updated?.title) {
        setStore(
          produce((draft) => {
            const match = Binary.search(draft.session, sessionID, (s) => s.id)
            if (match.found) draft.session[match.index].title = updated.title!
          }),
        )
      }
    } catch (e: any) {
      toast.error(language.t("common.requestFailed"), e?.message ?? String(e))
      void sync.session.sync(sessionID).catch(() => undefined)
    }
  }

  async function deleteSession(sessionID: string) {
    // Capture the next-active id BEFORE the optimistic splice so we
    // know where to navigate.
    const active = params.id === sessionID
    const next = sessions().find((s) => s.id !== sessionID)?.id
    try {
      await sync.session.delete(sessionID)
      sessionTitleLocal.remove(sessionID)
      if (active) {
        navigate(next ? `/${params.dir}/session/${next}` : `/${params.dir}/session/new`)
      }
    } catch (e: any) {
      console.error("session.delete failed", e)
      toast.error("could not delete", e?.message ?? String(e))
    }
  }

  // Force-load the session list into the sync store every time we land
  // on a project. sync.session.fetch() calls session.list AND reconciles
  // the result into the per-directory store; the raw SDK call alone
  // doesn't.
  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        centerTabs.resetForProject(dir)
        setVisitedFiles(false)
        ;(async () => {
          try {
            await sync.session.fetch(50)
          } catch {}
        })()
      },
    ),
  )

  // When the active session id changes, hydrate that session's messages
  // (and parts) into the store. Without this the chat panel shows blank
  // when you click an existing session — sync.session.sync() pulls the
  // backend's stored messages in.
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id || id === "new") return
        ;(async () => {
          try {
            await Promise.all([sync.session.sync(id), sync.session.review(id)])
            await sync.session.refresh(id)
          } catch {}
        })()
      },
    ),
  )

  // Hydrate child (sub-agent) sessions of the active session regardless of
  // which right-pane tab is open, so the Agents view and inline turn status
  // populate immediately and survive a reload.
  const hydratedChildren = new Set<string>()
  createEffect(() => {
    const id = params.id
    if (!id || id === "new") return
    for (const child of sync.data.session) {
      if (child.parentID !== id || hydratedChildren.has(child.id)) continue
      hydratedChildren.add(child.id)
      void sync.session.sync(child.id).catch(() => {})
    }
  })

  const projectWorktree = createMemo(() => decode64(params.dir) ?? "")
  const workspaceDir = () => sdk.directory
  const projectRecord = createMemo(() => {
    projectMetaLocal.all()
    const worktree = projectWorktree()
    if (!worktree) return sync.project
    return findProjectByWorktree(globalSync.data.project, worktree) ?? sync.project
  })
  const projectName = createMemo(() => {
    projectMetaLocal.all()
    const p = projectRecord()
    if (p) return projectLabel(p)
    const path = projectWorktree() || resolveProjectWorkingDir(workspaceDir())
    const segs = path.split("/").filter(Boolean)
    return segs[segs.length - 1] ?? path
  })

  const sessions = createMemo<SyncSession[]>(() => {
    const dir = workspaceDir()
    return [...sync.data.session]
      .filter((s) => !s.parentID)
      .filter((s) => !s.directory || s.directory === dir)
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  })
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const taskFileNames = createMemo(() => {
    const id = params.id
    if (!id) return new Set<string>()
    const msgs = sync.data.message[id] ?? []
    return collectTaskFileNames({
      messages: msgs,
      partsByMessage: sync.data.part,
    })
  })
  const recentTurnFileNames = createMemo(() => {
    const id = params.id
    if (!id) return new Set<string>()
    const msgs = sync.data.message[id] ?? []
    return collectRecentTurnFileNames({
      messages: msgs,
      partsByMessage: sync.data.part,
    })
  })
  const taskResultFiles = createMemo(() => {
    const id = params.id
    if (!id) return [] as ResultFile[]
    const msgs = sync.data.message[id] ?? []
    return customerFacingResultFiles(
      collectResultFiles({
        assistantMessages: msgs.filter(
          (message) => message.role === "assistant",
        ) as import("@hysci/sdk/v2/client").AssistantMessage[],
        partsByMessage: sync.data.part,
        responseText: "",
      }),
    )
  })
  const recentResultFiles = createMemo(() => {
    const id = params.id
    if (!id) return [] as ResultFile[]
    const msgs = sync.data.message[id] ?? []
    return customerFacingResultFiles(
      collectResultFiles({
        assistantMessages: assistantMessagesForLastTurn(msgs) as import("@hysci/sdk/v2/client").AssistantMessage[],
        partsByMessage: sync.data.part,
        responseText: "",
      }),
    )
  })
  const lastUserMessage = createMemo(() => {
    const ms = messages()
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === "user") return ms[i]
  })
  // A SessionTurn renders nothing for an assistant message — it only renders
  // when handed a user message, gathering that turn's assistant replies itself.
  // So render exactly one turn per user message; iterating every message made
  // each of the (often hundreds of) assistant messages paint an empty turn plus
  // a divider, which stacked up as faint horizontal lines down the chat and
  // bloated the DOM (slowing the reflow when the right pane opens).
  // When the session is in a reverted state, turns at or past the revert point
  // stay hidden until the user restores them or sends a new message (which
  // makes the revert permanent server-side).
  const activeSession = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const revertInfo = createMemo(() => activeSession()?.revert)
  const turnMessages = createMemo(() => {
    const revertID = revertInfo()?.messageID
    return messages().filter((m) => m.role === "user" && (!revertID || m.id < revertID))
  })
  const revertedCount = createMemo(() => {
    const revertID = revertInfo()?.messageID
    if (!revertID) return 0
    return messages().filter((m) => m.role === "user" && m.id >= revertID).length
  })

  const revertTo = async (messageID: string) => {
    const id = params.id
    if (!id) return
    const ok = await confirmDialog(dialog, {
      title: "Undo from here?",
      message:
        "Hides this message and everything after it, and rolls back the file changes they made. You can restore until you send the next message.",
      confirmLabel: "undo",
      danger: true,
    })
    if (!ok) return
    try {
      await sync.session.revert(id, messageID)
      toast.success("reverted", "files rolled back. send a message to continue from here")
    } catch (e: any) {
      toast.error("undo failed", e?.message ?? String(e))
    }
  }

  const restoreRevert = async () => {
    const id = params.id
    if (!id) return
    try {
      await sync.session.unrevert(id)
      toast.success("messages restored")
    } catch (e: any) {
      toast.error("restore failed", e?.message ?? String(e))
    }
  }

  const [stepsExpanded, setStepsExpanded] = createSignal<Record<string, boolean>>({})
  const toggleSteps = (id: string) => setStepsExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  onMount(() => {
    const fit = () => {
      uiStore.setSidebarWidth(uiStore.sidebarWidth())
      uiStore.setRightPaneWidth(uiStore.rightPaneWidth())
    }
    fit()
    window.addEventListener("resize", fit)
    onCleanup(() => window.removeEventListener("resize", fit))
  })

  useGlobalKeys({ onNew: () => void newSession() })

  // Center-pane tabs. The chat tab is always mounted (so streaming + scroll
  // survive tab switches); Files mounts on first visit; document tabs mount
  // when opened from the explorer and unmount on close.
  const chatTitle = createMemo(() => {
    const fallback = language.t("sidebar.newSubTask")
    const id = params.id
    if (!id || id === "new") return fallback
    const s = sessions().find((x) => x.id === id)
    if (!s) return fallback
    return getSessionDisplayTitle(s, sync.data.message[id], sync.data.part, fallback)
  })
  const [visitedFiles, setVisitedFiles] = createSignal(false)
  createEffect(() => {
    if (centerTabs.active() === "files") setVisitedFiles(true)
  })

  // Chat scroll. The container resizes whenever the right pane opens/closes
  // (the chat column narrows/widens) or the window changes size. A bare reflow
  // can drop the scroll position to the top, so we track whether the user is
  // pinned to the bottom and re-anchor on every resize via a ResizeObserver —
  // sticking to the bottom when they were reading the latest output, or
  // preserving their distance from the bottom when they had scrolled up.
  let scrollRef: HTMLDivElement | undefined
  let scrollObserver: ResizeObserver | undefined
  let boundScroll: HTMLDivElement | undefined
  const NEAR_BOTTOM_PX = 120
  let pinnedToBottom = true
  let distanceFromBottom = 0

  const recordScroll = () => {
    if (!scrollRef) return
    distanceFromBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight
    pinnedToBottom = distanceFromBottom <= NEAR_BOTTOM_PX
  }

  const stickToBottom = () => {
    if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight
  }

  const reanchor = () => {
    if (!scrollRef) return
    if (pinnedToBottom) stickToBottom()
    else scrollRef.scrollTop = Math.max(0, scrollRef.scrollHeight - scrollRef.clientHeight - distanceFromBottom)
  }

  const attachScroll = (el: HTMLDivElement) => {
    if (boundScroll === el) return
    if (scrollObserver) scrollObserver.disconnect()
    if (boundScroll) boundScroll.removeEventListener("scroll", recordScroll)
    boundScroll = el
    scrollRef = el
    pinnedToBottom = true
    el.addEventListener("scroll", recordScroll, { passive: true })
    // First callback fires synchronously on observe; ignore it (initial layout)
    // and only re-anchor on genuine resizes after that.
    let primed = false
    scrollObserver = new ResizeObserver(() => {
      if (!primed) {
        primed = true
        return
      }
      reanchor()
    })
    scrollObserver.observe(el)
  }

  onCleanup(() => {
    if (scrollObserver) scrollObserver.disconnect()
    if (boundScroll) boundScroll.removeEventListener("scroll", recordScroll)
  })

  // New messages / session switch → keep the latest output in view when the
  // user is pinned to the bottom (don't yank them down if they scrolled up).
  createEffect(
    on(
      () => [messages().length, params.id],
      ([, id], prev) => {
        const sessionChanged = !prev || prev[1] !== id
        if (sessionChanged) pinnedToBottom = true
        if (scrollRef && pinnedToBottom)
          requestAnimationFrame(() => {
            if (scrollRef && pinnedToBottom) stickToBottom()
          })
      },
    ),
  )

  createEffect(() => {
    const id = params.id
    if (!id) return
    let size = messages().length
    for (const message of messages()) {
      const parts = sync.data.part[message.id] ?? []
      size += parts.length
      for (const part of parts) {
        if (part.type === "text" || part.type === "reasoning") size += part.text?.length ?? 0
      }
    }
    if (!size || !scrollRef || !pinnedToBottom) return
    requestAnimationFrame(() => {
      if (scrollRef && pinnedToBottom) stickToBottom()
    })
  })

  createEffect(() => {
    const worktree = projectWorktree()
    if (projectRecord() && worktree) layout.projects.open(worktree)
  })

  return (
    <div
      class="thesis-root"
      style={{
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--color-bg)",
      }}
    >
      <ToastContainer />
      <Show when={uiStore.imagePreview()}>
        {(artifact) => (
          <ArtifactImagePreview artifact={artifact()} onClose={() => uiStore.setImagePreview(undefined)} />
        )}
      </Show>
      <HelpOverlay open={uiStore.helpOpen()} onClose={() => uiStore.setHelpOpen(false)} />
      <CommandPalette open={uiStore.paletteOpen()} onClose={() => uiStore.setPaletteOpen(false)} />

      <DisconnectedPanel />

      <div
        class="cs-session-layout"
        style={{
          flex: 1,
          "min-height": 0,
          "min-width": 0,
          display: "flex",
          overflow: "hidden",
        }}
      >
        <SessionsSidebar
          open={sidebarOpen()}
          projectName={projectName()}
          projectWorktree={projectWorktree() || resolveProjectWorkingDir(workspaceDir())}
          projectPinned={projectPrefs.isFavorite(projectWorktree())}
          sessions={sessions()}
          activeId={params.id}
          creating={creating()}
          filesActive={centerTabs.filesOpen() && centerTabs.active() === "files"}
          onToggle={() => setSidebarOpen((v) => !v)}
          onBack={() => navigate(`/domain/${projectDomainId(projectRecord()) || lastSelectedDomain() || "general"}`)}
          onNew={() => {
            centerTabs.showChat()
            void newSession()
          }}
          onCustomize={() => dialog.show(() => <DialogSettings />)}
          onFiles={() => {
            setVisitedFiles(true)
            centerTabs.showFiles()
          }}
          onSelect={(id) => {
            centerTabs.showChat()
            navigate(`/${params.dir}/session/${id}`)
          }}
          onDelete={(id) => void deleteSession(id)}
          onRenameProject={(name) => void renameProject(name)}
          onRenameSession={(id, title) => void renameSession(id, title)}
        />

        <div
          class="cs-session-center"
          style={{
            flex: 1,
            "min-width": 0,
            "min-height": 0,
            display: "flex",
            "flex-direction": "column",
            background: "var(--color-bg)",
            overflow: "hidden",
          }}
        >
          <Show when={centerTabs.tabStripVisible()}>
            <CenterTabStrip chatTitle={chatTitle()} />
          </Show>

          <div
            class="cs-session-stage"
            style={{
              flex: 1,
              "min-height": 0,
              "min-width": 0,
              position: "relative",
              display: "flex",
              "flex-direction": "column",
            }}
          >
            {/* chat — always mounted so streaming + scroll survive tab switches */}
            <div
              class="cs-chat-stage"
              style={{
                display: centerTabs.active() === "chat" ? "flex" : "none",
                flex: 1,
                "min-height": 0,
                "flex-direction": "column",
              }}
            >
              <Switch>
                <Match when={params.id && messages().length > 0}>
                  <div
                    ref={attachScroll}
                    class="thesis-scroll thesis-chat-scroll cs-chat-scroll"
                    style={{
                      flex: 1,
                      "min-height": 0,
                      "overflow-y": "auto",
                      "overflow-x": "hidden",
                      "padding-top": "12px",
                    }}
                  >
                    <For each={turnMessages()}>
                      {(message, index) => {
                        const toolCount = (sync.data.part[message.id] ?? []).filter(
                          (part) => part.type === "tool",
                        ).length
                        const review = () => reviewForTurn(messages(), sync.data.review[params.id!] ?? [], message.id)
                        const reviewStatus = () => reviewState(review())
                        return (
                          <div
                            data-message-id={message.id}
                            class={`cs-chat-turn${message.role === "assistant" ? " hys-turn-card" : ""}`}
                            style={{
                              "min-width": 0,
                              width: "100%",
                              "max-width": message.role === "assistant" ? "100%" : "100%",
                            }}
                          >
                            <Show when={message.role === "assistant" && message.agent}>
                              <div
                                class="hys-turn-card-header"
                                style={{
                                  padding: "6px 12px 2px",
                                  "font-family": "var(--font-sans)",
                                  "font-size": "11px",
                                  "font-weight": "600",
                                  color: "var(--color-text-muted)",
                                  display: "flex",
                                  "align-items": "center",
                                  gap: "8px",
                                }}
                              >
                                <span>
                                  {((message.agent as string) || "assistant")
                                    .replace(/_/g, " ")
                                    .replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                </span>
                                <Show when={message.role === "assistant" && message.agent && toolCount > 0}>
                                  <span style={{ color: "var(--color-text-faint)", "font-weight": "400" }}>
                                    · {toolCount} tools
                                  </span>
                                </Show>
                              </div>
                            </Show>
                            <SessionTurn
                              sessionID={params.id!}
                              messageID={message.id}
                              lastUserMessageID={lastUserMessage()?.id}
                              stepsExpanded={stepsExpanded()[message.id] ?? false}
                              onStepsExpandedToggle={() => toggleSteps(message.id)}
                              onRevertMessage={(id) => void revertTo(id)}
                              onOpenFile={(path) => void openFile(path)}
                              onPreviewFile={(path) => void previewImage(path)}
                              renderFilePreview={(file) =>
                                file.kind === "png" || file.kind === "jpg" || file.kind === "svg" ? (
                                  <ArtifactImageThumb
                                    directory={sync.data.path.directory || sdk.directory}
                                    file={file}
                                  />
                                ) : file.kind === "pdf" ? (
                                  <ArtifactPdfThumb directory={sync.data.path.directory || sdk.directory} file={file} />
                                ) : file.kind === "csv" || file.kind === "tsv" ? (
                                  <ArtifactTableThumb
                                    directory={sync.data.path.directory || sdk.directory}
                                    file={file}
                                  />
                                ) : undefined
                              }
                              onRevealFile={(path) => void openLocalFile(path, "reveal")}
                              onOpenInApp={(path, app) => void openLocalFile(path, "app", app)}
                              hideTools={["task"]}
                              hideResponse={reviewStatus().blocked}
                              classes={{
                                root: "min-w-0 w-full relative overflow-x-hidden",
                                content: "flex flex-col justify-between min-w-0 overflow-x-hidden",
                                container: "w-full min-w-0",
                              }}
                            />
                            <Show when={message.role === "user" && switchFromParts(sync.data.part[message.id] ?? [])}>
                              {(hit) => <DomainSwitchCard hit={hit()} />}
                            </Show>
                            <Show when={review()}>
                              {(record) => (
                                <ReviewStatusCard
                                  record={record()}
                                  onInspect={() => uiStore.inspectReview(params.id!, record().messageID)}
                                />
                              )}
                            </Show>
                            {/* Space, not a rule — the bubbles already separate turns. */}
                            <Show when={index() < turnMessages().length - 1}>
                              <div style={{ height: "22px" }} />
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Match>
                <Match when={true}>
                  <ChatWelcome domain={projectDomainId(projectRecord())} />
                </Match>
              </Switch>

              <Show when={revertInfo()}>
                <div style={{ padding: "8px 16px 0" }}>
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "12px",
                      padding: "8px 12px",
                      border: "1px solid var(--color-border)",
                      "border-radius": "4px",
                      "font-size": "12px",
                      "font-family": FONT_SANS,
                      color: "var(--color-text-muted)",
                      background: "var(--color-bg)",
                    }}
                  >
                    <span style={{ flex: 1, "min-width": 0 }}>
                      Conversation reverted. {revertedCount()} turn{revertedCount() === 1 ? "" : "s"} hidden and file
                      changes rolled back. Sending a new message makes this permanent.
                    </span>
                    <button
                      type="button"
                      onClick={() => void restoreRevert()}
                      style={{
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        color: "inherit",
                        padding: "4px 10px",
                        "border-radius": "4px",
                        "font-size": "12px",
                        cursor: "pointer",
                        "white-space": "nowrap",
                      }}
                    >
                      restore
                    </button>
                  </div>
                </div>
              </Show>

              <Composer />
            </div>

            {/* files — the host explorer, mounted on first visit */}
            <Show when={visitedFiles()}>
              <div
                style={{
                  display: centerTabs.active() === "files" ? "flex" : "none",
                  flex: 1,
                  "min-height": 0,
                  "flex-direction": "column",
                }}
              >
                <ErrorBoundary fallback={(err) => <FilesError error={err} />}>
                  <FileExplorer
                    projectRoot={projectWorktree()}
                    taskFileNames={taskFileNames()}
                    recentTurnFileNames={recentTurnFileNames()}
                    taskResultFiles={taskResultFiles()}
                    recentResultFiles={recentResultFiles()}
                  />
                </ErrorBoundary>
              </div>
            </Show>

            {/* document tabs — one inline FileView per opened file */}
            <For each={centerTabs.docs()}>
              {(doc) => (
                <div
                  style={{
                    display: centerTabs.active() === doc.id ? "flex" : "none",
                    flex: 1,
                    "min-height": 0,
                    "flex-direction": "column",
                  }}
                >
                  <FileView
                    path={doc.path}
                    directory={doc.directory}
                    subtitle={`This computer · ${formatHostFilePath(doc.directory, doc.path)}`}
                    onClose={() => centerTabs.closeDoc(doc.id)}
                  />
                </div>
              )}
            </For>
          </div>
        </div>

        <RightPane sessionID={params.id} />
      </div>
    </div>
  )
}

function CenterTabStrip(props: { chatTitle: string }): JSX.Element {
  const active = centerTabs.active
  return (
    <div class="cs-center-tabs thesis-scroll">
      <Show when={centerTabs.chatOpen()}>
        <div
          role="tab"
          class={`cs-center-tab${active() === "chat" ? " cs-center-tab-active" : ""}`}
          onClick={() => centerTabs.showChat()}
          title={props.chatTitle}
        >
          <span class="cs-center-tab-label">{props.chatTitle}</span>
          <span
            role="button"
            aria-label="close tab"
            class="cs-center-tab-close"
            onClick={(e) => {
              e.stopPropagation()
              centerTabs.closeChat()
            }}
          >
            <IconX size={11} strokeWidth={1.8} />
          </span>
        </div>
      </Show>
      <Show when={centerTabs.filesOpen()}>
        <div
          role="tab"
          class={`cs-center-tab${active() === "files" ? " cs-center-tab-active" : ""}`}
          onClick={() => centerTabs.showFiles()}
          title="Files"
        >
          <IconFolder size={14} strokeWidth={1.6} />
          <span class="cs-center-tab-label">Files</span>
          <span
            role="button"
            aria-label="close tab"
            class="cs-center-tab-close"
            onClick={(e) => {
              e.stopPropagation()
              centerTabs.closeFiles()
            }}
          >
            <IconX size={11} strokeWidth={1.8} />
          </span>
        </div>
      </Show>
      <For each={centerTabs.docs()}>
        {(doc) => (
          <div
            role="tab"
            class={`cs-center-tab${active() === doc.id ? " cs-center-tab-active" : ""}`}
            onClick={() => centerTabs.setActive(doc.id)}
            title={doc.name}
          >
            <IconFile size={12} strokeWidth={1.6} />
            <span class="cs-center-tab-label">{doc.name}</span>
            <span
              role="button"
              aria-label="close tab"
              class="cs-center-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                centerTabs.closeDoc(doc.id)
              }}
            >
              <IconX size={11} strokeWidth={1.8} />
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

function SessionsSidebar(props: {
  open: boolean
  projectName: string
  projectWorktree: string
  projectPinned: boolean
  sessions: SyncSession[]
  activeId: string | undefined
  creating: boolean
  filesActive: boolean
  onToggle: () => void
  onBack: () => void
  onNew: () => void
  onCustomize: () => void
  onFiles: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRenameProject: (name: string) => void
  onRenameSession: (sessionID: string, title: string) => void
}): JSX.Element {
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  const [groupCollapsed, setGroupCollapsed] = createSignal(false)

  const filteredSessions = createMemo(() => {
    const q = search().trim().toLowerCase()
    return props.sessions.filter((s) => {
      if (!q) return true
      return (s.title || "").toLowerCase().includes(q)
    })
  })

  return (
    <aside
      class={`cs-sidebar thesis-scroll${props.open ? "" : " cs-sidebar-collapsed"}`}
      style={props.open ? { "--cs-sidebar-width": `${uiStore.sidebarWidth()}px` } : undefined}
    >
      <Show
        when={props.open}
        fallback={
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              "align-items": "center",
              gap: "8px",
              padding: "10px 0",
            }}
          >
            <button type="button" class="cs-sidebar-icon-btn" title="expand sidebar" onClick={props.onToggle}>
              <IconChevronLeft size={14} strokeWidth={1.6} style={{ transform: "rotate(180deg)" }} />
            </button>
            <button type="button" class="cs-sidebar-icon-btn" title="new session" onClick={props.onNew}>
              <IconPlus size={14} strokeWidth={2} />
            </button>
            <button type="button" class="cs-sidebar-icon-btn" title="settings" onClick={props.onCustomize}>
              <IconSettings size={14} strokeWidth={1.6} />
            </button>
            <button type="button" class="cs-sidebar-icon-btn" title="files" onClick={props.onFiles}>
              <IconFolder size={14} strokeWidth={1.6} />
            </button>
          </div>
        }
      >
        <div class="cs-sidebar-head">
          <button
            type="button"
            class="cs-sidebar-back"
            onClick={props.onBack}
            title={language.t("sidebar.backToWorkbench")}
          >
            <IconArrowLeft size={15} strokeWidth={1.5} />
            <span>{language.t("sidebar.backToWorkbench")}</span>
          </button>
          <button type="button" class="cs-sidebar-icon-btn" title="collapse sidebar" onClick={props.onToggle}>
            <IconChevronLeft size={14} strokeWidth={1.6} />
          </button>
        </div>

        <div class="cs-sidebar-search-wrap">
          <div class="cs-sidebar-search">
            <IconSearch size={14} strokeWidth={1.5} style={{ color: "var(--color-text-faint)", "flex-shrink": 0 }} />
            <input
              type="search"
              value={search()}
              placeholder={language.t("sidebar.searchAnalyses")}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>

        <div class="cs-sidebar-scroll thesis-scroll">
          <button type="button" class="cs-sidebar-new-task" disabled={props.creating} onClick={props.onNew}>
            <span class="cs-sidebar-new-task-icon">
              <IconPlus size={16} strokeWidth={1.75} />
            </span>
            <span>{props.creating ? "Creating…" : language.t("sidebar.newSubTask")}</span>
          </button>

          <div class="cs-sidebar-project-group">
            <div class="cs-sidebar-project-head">
              <button
                type="button"
                class="cs-sidebar-project-toggle"
                aria-label={groupCollapsed() ? "expand" : "collapse"}
                onClick={() => setGroupCollapsed((v) => !v)}
              >
                <Show when={groupCollapsed()} fallback={<IconChevronDown size={14} strokeWidth={1.5} />}>
                  <IconChevronRight size={14} strokeWidth={1.5} />
                </Show>
              </button>
              <IconFolder size={14} strokeWidth={1.5} style={{ color: "var(--color-text-faint)", "flex-shrink": 0 }} />
              <Show when={props.projectPinned}>
                <span class="cs-star-amber">
                  <IconStarFilled size={13} strokeWidth={1.5} />
                </span>
              </Show>
              <InlineRename
                class="cs-sidebar-project-name"
                inputClass="cs-inline-rename-input cs-sidebar-project-name-input"
                value={props.projectName}
                title={language.t("common.rename")}
                onSave={props.onRenameProject}
              />
              <span class="cs-sidebar-project-count">{filteredSessions().length}</span>
            </div>

            <Show when={!groupCollapsed()}>
              <div class="cs-sidebar-project-sessions">
                <Show
                  when={filteredSessions().length > 0}
                  fallback={
                    <div
                      style={{
                        padding: "12px 16px",
                        "font-family": FONT_SANS,
                        "font-size": "12px",
                        color: "var(--color-text-faint)",
                      }}
                    >
                      {language.t("home.noRecentSessions")}
                    </div>
                  }
                >
                  <For each={filteredSessions()}>
                    {(s) => (
                      <SessionRow
                        session={s}
                        active={props.activeId === s.id}
                        onSelect={() => props.onSelect(s.id)}
                        onDelete={() => props.onDelete(s.id)}
                        onRename={(title) => props.onRenameSession(s.id, title)}
                      />
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <button
            type="button"
            class="cs-sidebar-files-card"
            data-active={props.filesActive ? "true" : "false"}
            onClick={props.onFiles}
          >
            <span class="cs-sidebar-files-icon">
              <IconFolderOpen size={18} strokeWidth={1.75} />
            </span>
            <span class="cs-sidebar-files-title">{language.t("sidebar.files")}</span>
          </button>
        </div>
        <ColumnHandle
          edge="end"
          value={uiStore.sidebarWidth()}
          min={SIDEBAR_COL.min}
          max={SIDEBAR_COL.max}
          reserved={rightReserved}
          label={language.t("layout.resizeSidebar")}
          hint={language.t("layout.resizeHint")}
          onInput={uiStore.setSidebarWidth}
          onCommit={uiStore.commitSidebarWidth}
          onReset={uiStore.resetSidebarWidth}
        />
      </Show>
    </aside>
  )
}

function SessionRow(props: {
  session: SyncSession
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}): JSX.Element {
  const sync = useSync()
  const language = useLanguage()
  const displayTitle = createMemo(() =>
    getSessionDisplayTitle(props.session, sync.data.message[props.session.id], sync.data.part),
  )
  const fullTitle = createMemo(
    () => firstUserMessageText(sync.data.message[props.session.id], sync.data.part) || displayTitle(),
  )

  return (
    <div
      role="button"
      tabindex="0"
      class={`cs-session-row${props.active ? " cs-session-row-active" : ""}`}
      title={fullTitle()}
      aria-label={`${displayTitle()}：${fullTitle()}`}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          props.onSelect()
        }
      }}
    >
      <SessionStatusLight sessionID={props.session.id} />
      <InlineRename
        class="cs-session-title"
        inputClass="cs-inline-rename-input cs-session-title-input"
        value={displayTitle()}
        title={language.t("common.rename")}
        onSave={props.onRename}
      />
      <button
        type="button"
        class="cs-session-delete"
        title="delete session"
        aria-label="delete session"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          props.onDelete()
        }}
      >
        <IconTrash size={11} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function ChatWelcome(props: { domain: ReturnType<typeof projectDomainId> }): JSX.Element {
  const models = useModels()
  const dialog = useDialog()
  const language = useLanguage()
  const noModel = () => models.list().length === 0
  const prompts = createMemo(() => {
    const id = props.domain
    return [language.t(`chat.welcome.${id}.1`), language.t(`chat.welcome.${id}.2`), language.t(`chat.welcome.${id}.3`)]
  })
  return (
    <div class="thesis-fade-in cs-chat-welcome">
      <div class="cs-chat-welcome-hero">
        <div class="cs-chat-welcome-mark">
          <AgentIcon
            size={52}
            style={{
              "--agent-icon-ink": "var(--color-text)",
              "--agent-icon-paper": "var(--color-surface-solid, var(--color-bg))",
            }}
          />
        </div>
        <div class="cs-chat-welcome-copy">
          <h2 class="cs-chat-welcome-title">
            {language.t("chat.welcome.title")}
            <span class="thesis-blink" style={{ color: "var(--color-text-faint)" }}>
              _
            </span>
          </h2>
          <p class="cs-chat-welcome-lead">{language.t("chat.welcome.lead")}</p>
        </div>
      </div>

      <Show when={noModel()}>
        <div class="cs-chat-welcome-setup">
          <p>{language.t("chat.welcome.noModel")}</p>
          <button type="button" class="cs-chat-welcome-setup-btn" onClick={() => openSetupDialog(dialog)}>
            {language.t("chat.welcome.setup")}
          </button>
        </div>
      </Show>

      <div class="cs-chat-welcome-prompts">
        <For each={prompts()}>
          {(p) => (
            <button type="button" class="cs-chat-welcome-prompt" onClick={() => uiStore.setPrefill(p)}>
              <span class="cs-chat-welcome-prompt-arrow">→</span>
              <span>{p}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function FilesError(props: { error: unknown }): JSX.Element {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <div
      style={{
        flex: 1,
        "min-height": 0,
        display: "grid",
        "place-items": "center",
        padding: "28px",
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          display: "flex",
          "flex-direction": "column",
          "align-items": "center",
          gap: "10px",
          padding: "22px",
          "border-radius": "12px",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface-solid)",
          "text-align": "center",
        }}
      >
        <IconFile size={22} strokeWidth={1.4} />
        <div style={{ "font-family": FONT_SANS, "font-size": "14px", "font-weight": 600, color: "var(--color-text)" }}>
          Files view failed
        </div>
        <div
          style={{
            "font-family": FONT_MONO,
            "font-size": "11px",
            color: "var(--color-text-faint)",
            "line-height": 1.5,
          }}
        >
          {message()}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "7px 12px",
            "border-radius": "6px",
            border: "1px solid var(--color-border)",
            "font-family": FONT_MONO,
            "font-size": "11px",
            color: "var(--color-text)",
          }}
        >
          reload
        </button>
      </div>
    </div>
  )
}

function ArtifactImageThumb(props: { directory: string; file: ResultFile }): JSX.Element {
  const sdk = useSDK()
  const [data] = createResource(
    () => [props.directory, props.file.path] as const,
    async ([directory, path]) => {
      const res: any = await sdk.client.file.read({ directory, path })
      return (res?.data ?? res) as ArtifactData
    },
  )
  const src = () => artifactImageUrl(data(), props.file.mime)
  return (
    <Show when={src()} fallback={<div data-slot="session-turn-result-file-preview-loading">loading preview…</div>}>
      <img src={src()} alt={props.file.name} loading="lazy" decoding="async" />
    </Show>
  )
}

function ArtifactTableThumb(props: { directory: string; file: ResultFile }): JSX.Element {
  const sdk = useSDK()
  const [data] = createResource(
    () => [props.directory, props.file.path] as const,
    async ([directory, path]) => {
      const res: any = await sdk.client.file.read({ directory, path })
      return (res?.data ?? res) as ArtifactData
    },
  )
  const rows = createMemo(() => artifactTable(data()?.content ?? "", props.file.name))
  const summary = createMemo(() => {
    const content = data()?.content ?? ""
    const total = content.split(/\r?\n/).filter((line) => line.trim()).length
    const columns = rows()[0]?.length ?? 0
    return `${Math.max(0, total - 1)} rows · ${columns} columns`
  })
  return (
    <Show
      when={rows().length > 0}
      fallback={<div data-slot="session-turn-result-table-empty">{props.file.kind.toUpperCase()} · 加载预览中</div>}
    >
      <div data-slot="session-turn-result-table">
        <div data-slot="session-turn-result-table-summary">{summary()}</div>
        <table>
          <thead>
            <tr>
              <For each={rows()[0] ?? []}>{(cell) => <th>{cell}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={rows().slice(1)}>
              {(row) => (
                <tr>
                  <For each={row}>{(cell) => <td>{cell}</td>}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}

function ArtifactPdfThumb(props: { directory: string; file: ResultFile }): JSX.Element {
  const sdk = useSDK()
  const [data] = createResource(
    () => [props.directory, props.file.path] as const,
    async ([directory, path]) => {
      const res: unknown = await sdk.client.file.read({ directory, path })
      return ((res as { data?: ArtifactData })?.data ?? res) as ArtifactData
    },
  )
  let canvas!: HTMLCanvasElement

  createEffect(() => {
    const file = data()
    if (!file?.content || file.encoding !== "base64") return
    const content = file.content

    let disposed = false
    let task: { cancel(): void } | undefined
    let doc: { destroy(): Promise<void> } | undefined

    void (async () => {
      try {
        const pdfjs = (await import("pdfjs-dist")) as unknown as {
          GlobalWorkerOptions: { workerSrc: string }
          getDocument(source: { data: Uint8Array }): {
            promise: Promise<{
              getPage(page: number): Promise<{
                getViewport(options: { scale: number }): { width: number; height: number }
                render(options: {
                  canvasContext: CanvasRenderingContext2D
                  viewport: { width: number; height: number }
                }): { promise: Promise<void>; cancel(): void }
              }>
              destroy(): Promise<void>
            }>
          }
        }
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
        }
        const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
        const loaded = await pdfjs.getDocument({ data: bytes }).promise
        if (disposed) {
          await loaded.destroy()
          return
        }
        doc = loaded
        const page = await loaded.getPage(1)
        if (disposed) return
        const viewport = page.getViewport({ scale: 0.28 })
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext("2d")
        if (!context) return
        context.scale(ratio, ratio)
        const rendered = page.render({ canvasContext: context, viewport })
        task = rendered
        await rendered.promise
      } catch {
        // The generic file preview remains available when a PDF cannot be rasterized.
      }
    })()

    onCleanup(() => {
      disposed = true
      task?.cancel()
      void doc?.destroy()
    })
  })

  return <canvas data-slot="session-turn-result-pdf-preview" ref={canvas} aria-label={`${props.file.name} 首页预览`} />
}

function ArtifactImagePreview(props: {
  artifact: { directory: string; path: string; name: string; mime?: string }
  onClose: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [data, setData] = createSignal<ArtifactData>()
  const [ready, setReady] = createSignal("")
  const [zoom, setZoom] = createSignal(1)
  const source = () => artifactImageUrl(data(), props.artifact.mime)
  const setZoomBounded = (value: number) => setZoom(Math.min(6, Math.max(0.5, value)))

  createEffect(() => {
    const directory = props.artifact.directory
    const path = props.artifact.path
    setData(undefined)
    setReady("")
    setZoom(1)
    if (!directory || !path) return
    void sdk.client.file
      .read({ directory, path })
      .then((res: any) => setData((res?.data ?? res) as ArtifactData))
      .catch(() => undefined)
  })

  createEffect(() => {
    const value = source()
    if (!value) return
    const image = new Image()
    const reveal = () => {
      if (source() === value) setReady(value)
    }
    image.decoding = "async"
    image.onload = reveal
    image.src = value
    void image.decode().then(reveal).catch(reveal)
    onCleanup(() => {
      image.onload = null
    })
  })

  return (
    <Show when={ready()}>
      {(image) => (
        <Portal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`查看图片：${props.artifact.name}`}
            onClick={props.onClose}
            style={{
              position: "fixed",
              inset: 0,
              display: "grid",
              "place-items": "center",
              padding: "12px",
              background: "rgba(20, 24, 30, 0.24)",
              "backdrop-filter": "blur(2px)",
              "z-index": "var(--z-modal)",
            }}
          >
            <section
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(1400px, calc(100vw - 24px))",
                height: "min(900px, calc(100dvh - 24px))",
                display: "flex",
                "flex-direction": "column",
                overflow: "hidden",
                "border-radius": "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-solid)",
                "box-shadow": "0 18px 64px rgba(0, 0, 0, 0.28)",
              }}
            >
              <header
                style={{
                  height: "38px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                  padding: "0 12px",
                  "border-bottom": "1px solid var(--color-border)",
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-text-muted)",
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  {props.artifact.name}
                </span>
                <button
                  type="button"
                  title="缩小"
                  onClick={() => setZoomBounded(zoom() - 0.25)}
                  style={previewButton()}
                >
                  −
                </button>
                <span style={{ width: "38px", "text-align": "center", "font-size": "10px" }}>
                  {Math.round(zoom() * 100)}%
                </span>
                <button
                  type="button"
                  title="放大"
                  onClick={() => setZoomBounded(zoom() + 0.25)}
                  style={previewButton()}
                >
                  +
                </button>
                <button type="button" title="原始比例" onClick={() => setZoom(1)} style={previewButton()}>
                  1:1
                </button>
                <a
                  href={image()}
                  download={props.artifact.name}
                  title="下载"
                  style={{ ...previewButton(), "text-decoration": "none" }}
                >
                  ↓
                </a>
                <button type="button" title="关闭" onClick={props.onClose} style={previewButton()}>
                  ×
                </button>
              </header>
              <div
                style={{
                  flex: 1,
                  "min-height": 0,
                  display: "grid",
                  "place-items": "center",
                  padding: "18px",
                  overflow: "auto",
                  background: "var(--color-bg-subtle)",
                }}
                onWheel={(event) => {
                  event.preventDefault()
                  setZoomBounded(zoom() + (event.deltaY < 0 ? 0.25 : -0.25))
                }}
              >
                <img
                  src={image()}
                  alt={props.artifact.name}
                  onClick={() => setZoom(zoom() === 1 ? 2 : 1)}
                  style={{
                    width: zoom() === 1 ? "auto" : `${zoom() * 100}%`,
                    "max-width": zoom() === 1 ? "100%" : "none",
                    "max-height": zoom() === 1 ? "100%" : "none",
                    "object-fit": "contain",
                    cursor: zoom() === 1 ? "zoom-in" : "zoom-out",
                  }}
                />
              </div>
            </section>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function previewButton(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-grid",
    "place-items": "center",
    width: "28px",
    height: "26px",
    "border-radius": "4px",
    color: "var(--color-text-muted)",
  }
}
