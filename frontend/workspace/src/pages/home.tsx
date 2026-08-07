import { createEffect, createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@hysci/util/encode"
import type { Project, Session } from "@hysci/sdk/v2/client"
import { DropdownMenu } from "@hysci/ui/dropdown-menu"
import { useDialog } from "@hysci/ui/context/dialog"
import { DialogProjectForm, type ProjectFormValues } from "@/components/dialog-project-form"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Wordmark } from "@/thesis/Wordmark"
import { AgentIcon } from "@/thesis/shared/AgentIcon"
import { ToastContainer } from "@/thesis/Toast"
import { toast } from "@/thesis/Toast"
import { DialogSettings } from "@/components/dialog-settings"
import { HomeCapabilities } from "@/components/home-capabilities/HomeCapabilities"
import { DisconnectedPanel } from "@/thesis/DisconnectedPanel"
import { uiStore } from "@/thesis/store/ui"
import { useGlobalKeys } from "@/thesis/useGlobalKeys"
import { CommandPalette } from "@/thesis/CommandPalette"
import { HelpOverlay } from "@/thesis/HelpOverlay"
import { HomeParticles } from "@/thesis/HomeParticles"
import { projectPrefs } from "@/thesis/store/projectPrefs"
import { projectMetaLocal } from "@/thesis/store/projectMetaLocal"
import { confirmDialog } from "@/thesis/dialogs"
import { saveProjectAgentContext } from "@/utils/projectMemory"
import { projectLabel } from "@/utils/projectLabel"
import { getSessionDisplayTitle } from "@/utils/sessionDisplayTitle"
import { sessionTitleLocal } from "@/thesis/store/sessionTitleLocal"
import { resolveProjectWorkingDir } from "@/utils/projectWorkspace"
import { isResultDirectory, normalizeResultFolderName, resultFolderName } from "@/utils/projectResult"
import { runningSessionCount } from "@/thesis/project-session-status"
import {
  IconCircle,
  IconClock,
  IconFolder,
  IconLogOut,
  IconMoreH,
  IconPlus,
  IconSettings,
  IconStarFilled,
  IconTrash,
  IconUser,
} from "@/thesis/shared/Icon"

function sessionUpdatedAt(session: Session): number {
  return session.time.updated ?? session.time.created
}

function compactTime(ms: number): string {
  // 0 / missing timestamps used to render as ~1970 → "689mo"
  if (!Number.isFinite(ms) || ms < 1_000_000_000_000) return "—"
  const diff = Math.max(0, Date.now() - ms)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months > 120) return "—"
  return `${months}mo`
}

export default function Home(): JSX.Element {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const fetchFn = () => platform.fetch ?? fetch

  const projects = createMemo(() => {
    projectMetaLocal.all()
    const fav = projectPrefs.favorites()
    const hide = projectPrefs.hidden()
    const byWorktree = new Map<string, Project>()
    const norm = (w: string) => w.replace(/\/$/, "")
    for (const p of sync.data.project) {
      if (!p.worktree || hide.has(p.worktree) || hide.has(norm(p.worktree))) continue
      if (isResultDirectory(p.worktree)) continue
      const existing = byWorktree.get(p.worktree)
      if (!existing) {
        byWorktree.set(p.worktree, p)
        continue
      }
      const cur = p.time.updated ?? p.time.created ?? 0
      const old = existing.time.updated ?? existing.time.created ?? 0
      if (cur > old) byWorktree.set(p.worktree, p)
    }
    for (const entry of server.projects.list()) {
      const worktree = entry.worktree
      if (!worktree || hide.has(worktree) || hide.has(norm(worktree)) || byWorktree.has(worktree)) continue
      if (isResultDirectory(worktree)) continue
      // Skip if a sync project already covers this path (same folder / git root).
      if ([...byWorktree.keys()].some((root) => worktree === root || worktree.startsWith(root + "/"))) continue
      const now = Date.now()
      byWorktree.set(worktree, {
        id: worktree,
        worktree,
        sandboxes: [],
        time: { created: now, updated: now },
      })
    }
    // Stable order: favorites first, then worktree path. Avoid sorting by
    // time.updated — config/session refreshes mutate timestamps and reshuffle the list.
    return Array.from(byWorktree.values()).sort((a, b) => {
      const af = fav.has(a.worktree) ? 1 : 0
      const bf = fav.has(b.worktree) ? 1 : 0
      if (af !== bf) return bf - af
      return a.worktree.localeCompare(b.worktree)
    })
  })

  const projectRows = createMemo(() => {
    projectMetaLocal.all()
    return projects().map((project) => {
      const [child] = sync.child(resolveProjectWorkingDir(project.worktree), { bootstrap: false })
      const sessions = child.session.filter((s) => !s.parentID && !s.time?.archived)
      const latestSession = sessions.reduce<Session | undefined>((best, s) => {
        if (!best) return s
        return sessionUpdatedAt(s) > sessionUpdatedAt(best) ? s : best
      }, undefined)
      const updatedAt = Math.max(
        project.time.updated ?? project.time.created ?? 0,
        latestSession ? sessionUpdatedAt(latestSession) : 0,
      )
      const total = Math.max(child.sessionTotal, sessions.length)
      const running = runningSessionCount(sessions, child.session_status)
      return { project, total, running, updatedAt }
    })
  })

  const recentSessions = createMemo(() => {
    projectMetaLocal.all()
    sessionTitleLocal.all()
    const hidden = projectPrefs.hidden()
    const items: Array<{ session: Session; project: Project; title: string }> = []
    for (const project of projects()) {
      if (hidden.has(project.worktree)) continue
      const [child] = sync.child(resolveProjectWorkingDir(project.worktree), { bootstrap: false })
      for (const session of child.session) {
        if (!session?.id || session.parentID || session.time?.archived) continue
        items.push({
          session,
          project,
          title: getSessionDisplayTitle(session, child.message[session.id], child.part),
        })
      }
    }
    const seen = new Set<string>()
    const deduped: typeof items = []
    for (const item of items.sort((a, b) => {
      const at = sessionUpdatedAt(b.session) - sessionUpdatedAt(a.session)
      if (at !== 0) return at
      return a.session.id.localeCompare(b.session.id)
    })) {
      if (seen.has(item.session.id)) continue
      seen.add(item.session.id)
      deduped.push(item)
    }
    return deduped
  })

  createEffect((prev?: string) => {
    const dirs = projects().map((p) => p.worktree)
    const key = dirs.slice().sort().join("\0")
    if (key === prev) return key
    if (dirs.length === 0) return key
    void Promise.all(dirs.map((dir) => sync.project.loadSessions(resolveProjectWorkingDir(dir))))
    void Promise.all(dirs.map((dir) => sync.project.loadSessionStatus(resolveProjectWorkingDir(dir))))
    return key
  })

  function sessionCountLabel(count: number): string {
    if (count === 0) return language.t("home.session.zero")
    if (count === 1) return language.t("home.session.one")
    return language.t("home.session.other", { count: String(count) })
  }

  function openProject(directory: string) {
    projectPrefs.unhide(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  function openSession(directory: string, sessionId: string) {
    projectPrefs.unhide(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session/${sessionId}`)
  }

  async function applyProjectMeta(directory: string, values: ProjectFormValues) {
    // Resolve canonical project root first — git subfolders share one worktree/id.
    const current = await sdk.client.project.current({ directory }).catch(() => undefined)
    const project = current?.data
    const root = project?.worktree ?? directory
    const workspace = resolveProjectWorkingDir(root)
    const resultName = normalizeResultFolderName(values.resultFolderName ?? values.name, root)
    const existed =
      !!project?.name ||
      !!sync.data.project.some((p) => p.id === project?.id || p.worktree === root) ||
      !!server.projects.list().some((p) => p.worktree === root)

    projectMetaLocal.patch(root, {
      description: values.description,
      resultFolderName: resultName,
      name: values.name?.trim() || undefined,
    })
    if (directory !== root) projectMetaLocal.remove(directory)

    layout.projects.open(root)
    server.projects.open(root)
    server.projects.touch(root)
    if (directory !== root) server.projects.close(directory)

    if (project?.id && project.id !== "global") {
      await sdk.client.project
        .update({
          projectID: project.id,
          directory: root,
          name: values.name || undefined,
          description: values.description || undefined,
          resultFolder: resultName,
          research: {
            domain: values.researchDomain,
            subdomain: values.researchSubdomain,
            notes: values.researchNotes || undefined,
          },
        } as any)
        .catch(() => undefined)
    }

    if (values.agentContext) {
      await saveProjectAgentContext(sdk.url, root, values.agentContext, fetchFn()).catch(() => undefined)
    }

    sync.child(workspace, { bootstrap: true })
    await sync.project.loadSessions(workspace)

    const next = await sdk.client.project.list().catch(() => undefined)
    const listed = (next?.data ?? [])
      .filter((p) => !!p?.id)
      .filter((p) => !!p.worktree && !p.worktree.includes("hyscience-test"))
    const refreshed = await sdk.client.project.current({ directory: root }).catch(() => undefined)
    const created = refreshed?.data
    const merged =
      created?.id && !listed.some((p) => p.id === created.id) ? [...listed, created] : listed
    if (merged.length > 0 || created) {
      sync.set("project", merged)
    }
    return { root, existed }
  }

  async function finalizeCreate(values: ProjectFormValues) {
    const directory = values.directory
    if (!directory) return
    try {
      const result = await applyProjectMeta(directory, {
        ...values,
        resultFolderName: normalizeResultFolderName(
          values.name ? (values.resultFolderName ?? values.name) : "",
          directory,
        ),
      })
      projectPrefs.unhide(result.root)
      if (result.existed) {
        toast.info(language.t("dialog.project.new.updatedExisting"))
      }
    } catch (err) {
      toast.error(language.t("common.requestFailed"), err instanceof Error ? err.message : String(err))
    }
  }

  function openNewProjectDialog() {
    dialog.show(() => <DialogProjectForm mode="create" onCreate={(values) => void finalizeCreate(values)} />)
  }

  function openProjectSettings(project: Project) {
    dialog.show(() => (
      <DialogProjectForm
        mode="edit"
        project={project}
        initial={{
          name: project.name ?? projectLabel(project),
          description: project.description ?? projectMetaLocal.get(project.worktree).description ?? "",
          resultFolderName:
            project.resultFolder ?? resultFolderName(project.worktree, project.name ?? projectLabel(project)),
          researchDomain: project.research?.domain ?? "general",
          researchSubdomain: project.research?.subdomain,
          researchNotes: project.research?.notes ?? "",
        }}
      />
    ))
  }

  async function deleteProject(project: Project) {
    const ok = await confirmDialog(dialog, {
      title: language.t("home.menu.deleteConfirm.title"),
      message: language.t("home.menu.deleteConfirm.message"),
      confirmLabel: language.t("home.menu.delete"),
      danger: true,
    })
    if (!ok) return
    const worktree = project.worktree.replace(/\/$/, "")
    const ws = resolveProjectWorkingDir(worktree)
    const [sessions] = sync.child(ws, { bootstrap: false })
    await Promise.all(
      sessions.session.map((s: Session) =>
        sdk.client.session.delete({ sessionID: s.id, directory: ws }).catch(() => {}),
      ),
    )
    server.projects.close(worktree)
    projectPrefs.hide(worktree)
    projectMetaLocal.remove(worktree)
  }

  const openSettings = () => dialog.show(() => <DialogSettings />)

  useGlobalKeys({ onNew: () => openNewProjectDialog() })

  return (
    <div class="thesis-root cs-home">
      <ToastContainer />
      <HelpOverlay open={uiStore.helpOpen()} onClose={() => uiStore.setHelpOpen(false)} />
      <CommandPalette open={uiStore.paletteOpen()} onClose={() => uiStore.setPaletteOpen(false)} />
      <DisconnectedPanel />

      <main class="thesis-scroll cs-home-main">
        <HomeParticles />
        <Show when={projects().length > 0} fallback={<EmptyHero onChoose={openNewProjectDialog} />}>
          <div class="cs-workbench-inner">
            <div class="cs-workbench-header">
              <div class="cs-workbench-brand-block">
                <AgentIcon
                  class="cs-workbench-mark"
                  size={96}
                  style={{
                    "--agent-icon-ink": "var(--color-text)",
                    "--agent-icon-paper": "var(--color-surface-solid, var(--color-bg))",
                  }}
                />
                <div class="cs-workbench-copy">
                  <h1 class="cs-workbench-brand">HYscience</h1>
                  <p class="cs-workbench-tagline">{language.t("home.tagline")}</p>
                </div>
              </div>
              <div class="cs-workbench-actions">
                <HomeUserMenu onSettings={openSettings} />
              </div>
            </div>

            <div class="cs-dashboard">
              <section>
                <div class="cs-section-head-row">
                  <h2 class="cs-section-head">
                    <IconFolder size={24} strokeWidth={1.5} />
                    {language.t("home.projects")}
                  </h2>
                  <button
                    type="button"
                    class="cs-btn-primary cs-section-head-action"
                    onClick={openNewProjectDialog}
                    title={language.t("command.project.open")}
                    aria-label={language.t("home.newProject")}
                  >
                    <IconPlus size={22} strokeWidth={1.75} />
                  </button>
                </div>
                <div class="cs-panel cs-home-scroll-panel thesis-scroll">
                  <For each={projectRows()} by={(row) => row.project.worktree}>
                    {(row, i) => (
                      <ProjectRow
                        index={i() + 1}
                        project={row.project}
                        total={row.total}
                        running={row.running}
                        updatedAt={row.updatedAt}
                        sessionCountLabel={sessionCountLabel(row.total)}
                        runningSessionLabel={language.t("home.session.running", { count: String(row.running) })}
                        pinned={projectPrefs.isFavorite(row.project.worktree)}
                        onOpen={() => openProject(row.project.worktree)}
                        onPin={() => {
                          projectPrefs.toggleFavorite(row.project.worktree)
                        }}
                        onSettings={() => openProjectSettings(row.project)}
                        onDelete={() => void deleteProject(row.project)}
                      />
                    )}
                  </For>
                </div>
              </section>

              <section class="cs-dashboard-recent">
                <h2 class="cs-section-head">
                  <IconClock size={16} strokeWidth={1.5} />
                  {language.t("sidebar.project.recentSessions")}
                </h2>
                <div class="cs-panel cs-home-scroll-panel thesis-scroll">
                  <Show
                    when={recentSessions().length > 0}
                    fallback={<div class="cs-empty-panel">{language.t("home.noRecentSessions")}</div>}
                  >
                    <For each={recentSessions()} by={(item) => item.session.id}>
                      {(item) => (
                        <button
                          type="button"
                          class="cs-workbench-list-row"
                          onClick={() => openSession(item.project.worktree, item.session.id)}
                        >
                          <span class="cs-session-body">
                            <span class="cs-row-title">{item.title}</span>
                            <span class="cs-row-sub">{projectLabel(item.project)}</span>
                          </span>
                          <span class="cs-row-meta">
                            <span class="cs-row-time">{compactTime(sessionUpdatedAt(item.session))}</span>
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </section>
            </div>

            <HomeCapabilities />
          </div>
        </Show>
      </main>
    </div>
  )
}

function HomeUserMenu(props: { onSettings: () => void }): JSX.Element {
  const sdk = useGlobalSDK()
  const server = useServer()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [email, setEmail] = createSignal("")

  onMount(() => {
    void sdk.client.account
      .get()
      .then((res) => {
        const data = ((res as { data?: { user?: { email?: string } } }).data ?? res) as {
          user?: { email?: string }
        }
        setEmail(data.user?.email ?? "")
      })
      .catch(() => undefined)
  })

  const displayEmail = () => email() || `local@${server.name || "hyscience"}`

  async function signOut() {
    if (!window.confirm(language.t("home.user.signOutConfirm"))) return
    try {
      const res = await sdk.client.account.logout()
      if (res.error) throw new Error(String(res.error))
      setEmail("")
      toast.info(language.t("home.user.signOut"))
    } catch (err) {
      toast.error(language.t("home.user.signOut"), err instanceof Error ? err.message : String(err))
    } finally {
      setOpen(false)
    }
  }

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger class="cs-workbench-icon-btn" data-expanded={open() ? "true" : "false"}>
        <IconUser size={64} strokeWidth={1.5} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="cs-user-menu mt-2">
          <span class="cs-user-menu-email">{displayEmail()}</span>
          <DropdownMenu.Item
            class="cs-user-menu-item"
            onSelect={() => {
              setOpen(false)
              props.onSettings()
            }}
          >
            <IconSettings size={15} strokeWidth={1.5} />
            {language.t("sidebar.settings")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="cs-user-menu-item"
            onSelect={() => {
              void signOut()
            }}
          >
            <IconLogOut size={15} strokeWidth={1.5} />
            {language.t("home.user.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function ProjectRow(props: {
  index: number
  project: Project
  total: number
  running: number
  updatedAt: number
  sessionCountLabel: string
  runningSessionLabel: string
  pinned: boolean
  onOpen: () => void
  onPin: () => void
  onSettings: () => void
  onDelete: () => void
}): JSX.Element {
  const language = useLanguage()
  const [menuOpen, setMenuOpen] = createSignal(false)

  return (
    <div class="cs-row-wrap">
      <button type="button" class="cs-row-main" onClick={props.onOpen}>
        <div class="cs-row-content">
          <div class="cs-row-title-line">
            <ProjectSessionStatus
              index={props.index}
              total={props.total}
              running={props.running}
              sessionCountLabel={props.sessionCountLabel}
              runningSessionLabel={props.runningSessionLabel}
            />
            <Show when={props.pinned}>
              <span class="cs-star-amber">
                <IconStarFilled size={14} strokeWidth={1.5} />
              </span>
            </Show>
            <span class="cs-row-title">{projectLabel(props.project)}</span>
            <Show when={props.project.name?.toLowerCase().includes("example")}>
              <span class="cs-tag">Example</span>
            </Show>
          </div>
        </div>
        <span class="cs-row-meta">
          <span class="cs-row-count">{props.sessionCountLabel}</span>
          <span class="cs-row-time">{compactTime(props.updatedAt)}</span>
        </span>
      </button>

      <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger
          class="cs-row-menu-btn"
          data-open={menuOpen() ? "true" : "false"}
          onClick={(e: MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
        >
          <IconMoreH size={16} strokeWidth={1.5} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="cs-menu mt-1">
            <DropdownMenu.Item
              class="cs-menu-item"
              onSelect={() => {
                props.onPin()
                setMenuOpen(false)
              }}
            >
              <IconStarFilled size={14} strokeWidth={1.5} />
              {props.pinned ? language.t("home.menu.unpin") : language.t("home.menu.pin")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="cs-menu-item"
              onSelect={() => {
                props.onSettings()
                setMenuOpen(false)
              }}
            >
              <IconSettings size={14} strokeWidth={1.5} />
              {language.t("home.menu.settings")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              class="cs-menu-item cs-menu-item-danger"
              onSelect={() => {
                props.onDelete()
                setMenuOpen(false)
              }}
            >
              <IconTrash size={14} strokeWidth={1.5} />
              {language.t("home.menu.delete")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

function ProjectSessionStatus(props: {
  index: number
  total: number
  running: number
  sessionCountLabel: string
  runningSessionLabel: string
}): JSX.Element {
  return (
    <Show
      when={props.running > 0}
      fallback={
        <span
          class="cs-project-index"
          data-wide={props.index >= 10 ? "true" : undefined}
          aria-label={props.sessionCountLabel}
          title={props.sessionCountLabel}
        >
          {props.index}
        </span>
      }
    >
      <span
        class="cs-project-index cs-project-session-status"
        aria-label={props.runningSessionLabel}
        title={props.runningSessionLabel}
      >
        <span class="cs-project-session-status-ring" aria-hidden="true" />
        <span class="cs-project-session-status-count" aria-hidden="true">
          {props.running}
        </span>
      </span>
    </Show>
  )
}

function EmptyHero(props: { onChoose: () => void }): JSX.Element {
  const language = useLanguage()

  return (
    <div class="cs-empty-hero thesis-fade-in">
      <Wordmark size="lg" textOnly showBeta />
      <p class="cs-empty-hero-desc">{language.t("home.empty.description")}</p>
      <button type="button" class="cs-btn-primary" onClick={props.onChoose} style={{ "margin-top": "8px" }}>
        <IconFolder size={14} strokeWidth={1.5} />
        {language.t("home.openFolder")}
      </button>
      <div class="cs-empty-hero-hint">{language.t("home.empty.hint")}</div>
    </div>
  )
}
