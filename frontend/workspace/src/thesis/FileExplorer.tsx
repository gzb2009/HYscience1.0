import { createSignal, createResource, createMemo, createEffect, on, onCleanup, type JSX, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@hysci/ui/context/dialog"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { centerTabs } from "@/thesis/store/centerTabs"
import { FileView } from "@/thesis/FilePreview"
import { uiStore } from "@/thesis/store/ui"
import { ExtBadge } from "@/thesis/HYscienceFileTree"
import { artifactMetaLocal } from "@/thesis/store/artifactMetaLocal"
import { artifactImageUrl } from "@/utils/artifactPreview"
import { isResultFolderName } from "@/utils/projectResult"
import { filterLatestFileNodes, artifactPathsMatch, type ResultFile } from "@hysci/ui/session-result"
import { alertDialog, confirmDialog, promptDialog } from "@/thesis/dialogs"
import { toast } from "@/thesis/Toast"
import {
  IconFolder,
  IconFolderOpen,
  IconFile,
  IconRefresh,
  IconSearch,
  IconLayoutGrid,
  IconDownload,
  IconTrash,
  IconX,
  IconMoreV,
  IconEye,
  IconEyeOff,
  IconLink,
  IconPencil,
  IconStar,
  IconStarFilled,
  IconCopy,
  IconGitBranch,
} from "@/thesis/shared/Icon"

interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
  size?: number
  mtime?: number
}

const EXT_COLOR: Record<string, string> = {
  py: "#3776AB",
  ts: "#3178C6",
  tsx: "#3178C6",
  js: "#F7DF1E",
  jsx: "#F7DF1E",
  json: "#888892",
  yaml: "#CB171E",
  yml: "#CB171E",
  toml: "#9C4221",
  md: "var(--color-text-faint)",
  ipynb: "#F37626",
  parquet: "#50C878",
  rs: "#CE412B",
  go: "#00ADD8",
  pdf: "#E5484D",
  tex: "#3D6117",
  png: "#8B5CF6",
  jpg: "#8B5CF6",
  jpeg: "#8B5CF6",
  svg: "#E34F26",
}

const ext = (name: string): string => {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.ignored !== b.ignored) return a.ignored ? 1 : -1
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function ListGlyph(props: { size?: number }): JSX.Element {
  const s = props.size ?? 12
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <line x1="5" y1="4" x2="14" y2="4" />
      <line x1="5" y1="8" x2="14" y2="8" />
      <line x1="5" y1="12" x2="14" y2="12" />
      <circle cx="2.5" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Host file explorer. Navigates real directories via sdk.client.file.list
 * (the `directory` query param re-roots the backend Instance, so any absolute
 * path is browsable). Clicking a folder navigates in; clicking a file opens a
 * center-pane document tab. The default artifacts scope renders files from the
 * Result folder as large cards; folder scopes keep the raw filesystem browser.
 */
export function FileExplorer(props: {
  projectRoot?: string
  taskFileNames?: Set<string>
  recentTurnFileNames?: Set<string>
  taskResultFiles?: ResultFile[]
  recentResultFiles?: ResultFile[]
}): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()

  const [scope, setScope] = createSignal<"artifacts" | "root">("artifacts")
  const projectRoot = () => props.projectRoot || sync.project?.worktree || sync.data.path.directory || sdk.directory
  const resultRoot = () => projectRoot()
  const scopeRoot = () => (scope() === "root" ? projectRoot() : resultRoot())

  const [cwd, setCwd] = createSignal(scopeRoot())
  const [filter, setFilter] = createSignal("")
  // Debounced copy of `filter` that actually drives the (heavier) list filter,
  // so sorting/filtering the directory doesn't rerun on every keystroke.
  const [query, setQuery] = createSignal("")
  let filterTimer: ReturnType<typeof setTimeout> | undefined
  const setFilterDebounced = (v: string) => {
    setFilter(v)
    clearTimeout(filterTimer)
    filterTimer = setTimeout(() => setQuery(v), 110)
  }
  const clearFilter = () => {
    clearTimeout(filterTimer)
    setFilter("")
    setQuery("")
  }
  onCleanup(() => clearTimeout(filterTimer))

  const [view, setView] = createSignal<"list" | "grid">("grid")
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [permissionError, setPermissionError] = createSignal<string | null>(null)
  const [preview, setPreview] = createSignal<{ directory: string; path: string } | null>(null)

  createEffect(
    on(
      () => [sdk.directory, projectRoot(), scope()] as const,
      ([, , s]) => {
        const dir = s === "root" ? projectRoot() : resultRoot()
        setCwd(dir)
        clearFilter()
        setPreview(null)
        setPermissionError(null)
      },
      { defer: true },
    ),
  )

  const navigate = (dir: string) => {
    const target = dir || scopeRoot()
    const root = scopeRoot().replace(/\/+$/, "")
    if (target !== root && !target.startsWith(`${root}/`)) return
    setCwd(target)
    setPreview(null)
    clearFilter()
  }

  const [entries] = createResource(
    () => [cwd(), refreshKey(), scope()] as const,
    async ([dir, , s]) => {
      if (s === "artifacts") return [] as FileNode[]
      setPermissionError(null)
      if (!dir) return [] as FileNode[]
      try {
        // Pass the params FLAT — the generated client maps `directory`/`path`
        // into the query string via buildClientParams; a `{ query: {...} }`
        // wrapper is silently dropped (no key matches), which sends neither
        // param and 400s. `directory` re-roots the backend Instance, letting us
        // browse any host directory (see server middleware + File.list).
        const res: any = await sdk.client.file.list({ directory: dir, path: "." })
        const data = res?.data ?? res
        return Array.isArray(data) ? (data as FileNode[]) : []
      } catch (err: any) {
        // throwOnError surfaces the response body (a plain-text HTTPException
        // message on macOS: "permission denied reading … — grant Full Disk
        // Access"). Detect that so the SPA can prompt for FDA instead of
        // silently showing an empty folder.
        const msg = String(err?.body?.message ?? err?.message ?? (typeof err === "string" ? err : "") ?? "")
        const status = err?.response?.status ?? err?.status ?? err?.statusCode
        if (status === 403 || /permission denied|full disk access/i.test(msg)) {
          setPermissionError(msg || "HYscience cannot read this directory")
        }
        return [] as FileNode[]
      }
    },
  )

  // Sort once per directory load (stale-while-revalidate: `entries.latest`
  // keeps the previous folder's rows on screen while the next one fetches, so
  // navigating never blanks to an empty "loading…" flash). Filtering then runs
  // over the already-sorted list against the debounced query.
  const sorted = createMemo(() => sortNodes(entries.latest ?? []))
  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim()
    const rows = sorted()
    if (!q) return rows
    return rows.filter((n) => n.name.toLowerCase().includes(q))
  })

  const openFile = (node: FileNode) => {
    setPreview({ directory: cwd(), path: node.name })
    centerTabs.openFile(cwd(), node.name)
  }
  const onRowClick = (node: FileNode) => {
    if (node.type === "directory") navigate(node.absolute)
    else openFile(node)
  }
  const previewSelected = (node: FileNode) => {
    const p = preview()
    return p?.directory === cwd() && p.path === node.name
  }

  const browseMode = (): BrowseMode =>
    scope() === "root" ? "project" : centerTabs.artifactsScope() === "task" ? "task" : "recent"

  const setBrowseMode = (mode: BrowseMode) => {
    if (mode === "project") {
      setScope("root")
      return
    }
    setScope("artifacts")
    centerTabs.setArtifactsScope(mode)
  }

  return (
    <div
      style={{
        flex: 1,
        "min-height": 0,
        "min-width": 0,
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
      }}
    >
      <Show
        when={scope() !== "artifacts"}
        fallback={
          <ArtifactsGrid
            directory={resultRoot()}
            view={view()}
            onViewChange={setView}
            browseMode={browseMode()}
            onBrowseModeChange={setBrowseMode}
            taskFileNames={props.taskFileNames}
            recentTurnFileNames={props.recentTurnFileNames}
            taskResultFiles={props.taskResultFiles}
            recentResultFiles={props.recentResultFiles}
            projectPath={projectRoot()}
            onRefresh={() => setRefreshKey((k) => k + 1)}
          />
        }
      >
        <>
          <FilesToolbar
            browseMode={browseMode()}
            onBrowseModeChange={setBrowseMode}
            search={filter()}
            onSearch={setFilterDebounced}
            count={filtered().length}
            view={view()}
            onViewChange={setView}
            onRefresh={() => setRefreshKey((k) => k + 1)}
            projectPath={
              cwd() === scopeRoot()
                ? projectRoot()
                : cwd().replace(`${scopeRoot().replace(/\/+$/, "")}/`, "") || projectRoot()
            }
          />
          <Show
            when={view() === "list"}
            fallback={
              <div
                class="thesis-scroll"
                style={{ flex: 1, "min-height": 0, "overflow-y": "auto", "overflow-x": "hidden" }}
              >
                <HostFolderBody
                  loading={entries.loading && !entries.latest}
                  permissionError={permissionError()}
                  nodes={filtered()}
                  onRefresh={() => setRefreshKey((k) => k + 1)}
                  onClick={onRowClick}
                />
              </div>
            }
          >
            <div class="hy-files-panel">
              <div class="hy-files-body">
                <div class="hy-files-preview">
                  <Show when={preview()}>
                    {(p) => (
                      <div class="hy-files-preview-bar">
                        <span class="hy-files-preview-label">open file</span>
                        <span class="hy-files-preview-name">{p().path.split("/").pop()}</span>
                        <button
                          type="button"
                          class="hy-files-preview-close"
                          title="close"
                          onClick={() => setPreview(null)}
                        >
                          <IconX size={12} strokeWidth={1.7} />
                        </button>
                      </div>
                    )}
                  </Show>
                  <div class="hy-files-preview-body">
                    <Show
                      when={preview()}
                      fallback={
                        <div class="hy-files-empty">
                          <div class="hy-files-empty-icon">
                            <IconFolder size={22} strokeWidth={1.4} />
                          </div>
                          <p class="hy-files-empty-title">open file</p>
                          <p class="hy-files-empty-hint">select a file from the tree</p>
                        </div>
                      }
                    >
                      {(p) => <FileView path={p().path} directory={p().directory} onClose={() => setPreview(null)} />}
                    </Show>
                  </div>
                </div>

                <div class="hy-files-sidebar">
                  <div class="hy-files-sidebar-scroll thesis-scroll">
                    <Show when={!entries.loading || entries.latest} fallback={<div style={emptyMsg()}>loading…</div>}>
                      <Show
                        when={!permissionError()}
                        fallback={
                          <div style={{ padding: "20px 10px", "text-align": "center" }}>
                            <IconFolder size={16} strokeWidth={1.4} />
                            <div
                              style={{
                                "font-family": FONT_SANS,
                                "font-size": "11px",
                                color: "var(--color-text-faint)",
                                "margin-top": "8px",
                                "line-height": 1.4,
                              }}
                            >
                              {permissionError()}
                            </div>
                            <button
                              type="button"
                              onClick={() => setRefreshKey((k) => k + 1)}
                              style={{ ...navBtn(false), "margin-top": "8px", width: "100%" }}
                            >
                              retry
                            </button>
                          </div>
                        }
                      >
                        <Show
                          when={filtered().length > 0}
                          fallback={<div style={{ ...emptyMsg(), padding: "24px 8px" }}>empty folder</div>}
                        >
                          <div class="hy-files-tree">
                            <For each={filtered()}>
                              {(node) => (
                                <SidebarRow
                                  node={node}
                                  selected={node.type === "file" && previewSelected(node)}
                                  onClick={() => onRowClick(node)}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                  <div class="hy-files-sidebar-meta">{filtered().length} items</div>
                </div>
              </div>
            </div>
          </Show>
        </>
      </Show>
    </div>
  )
}

function SidebarRow(props: { node: FileNode; selected: boolean; onClick: () => void }): JSX.Element {
  if (props.node.type === "directory") {
    return (
      <button
        type="button"
        class="hy-files-row hy-files-row-folder"
        onClick={() => props.onClick()}
        title={props.node.absolute}
      >
        <span class="hy-files-chevron">
          <IconFolder size={12} strokeWidth={1.5} />
        </span>
        <span class="hy-files-row-folder-name">{props.node.name}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      class={`hy-files-row${props.selected ? " hy-files-row-selected" : ""}`}
      onClick={() => props.onClick()}
      title={props.node.absolute}
    >
      <ExtBadge name={props.node.name} />
      <span class="hy-files-row-name">{props.node.name}</span>
    </button>
  )
}

function HostFolderBody(props: {
  loading: boolean
  permissionError: string | null
  nodes: FileNode[]
  onRefresh: () => void
  onClick: (n: FileNode) => void
}): JSX.Element {
  return (
    <Show when={!props.loading} fallback={<div style={emptyMsg()}>loading…</div>}>
      <Show
        when={!props.permissionError}
        fallback={
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              "align-items": "center",
              gap: "8px",
              padding: "40px 22px",
              "text-align": "center",
            }}
          >
            <IconFolder size={20} strokeWidth={1.4} />
            <div
              style={{ "font-family": FONT_SANS, "font-size": "13px", "font-weight": 500, color: "var(--color-text)" }}
            >
              Can't read this folder
            </div>
            <div
              style={{
                "font-family": FONT_SANS,
                "font-size": "12px",
                color: "var(--color-text-faint)",
                "line-height": 1.5,
                "max-width": "320px",
              }}
            >
              {props.permissionError}
            </div>
            <button
              type="button"
              onClick={props.onRefresh}
              style={{
                all: "unset",
                cursor: "pointer",
                "margin-top": "2px",
                padding: "5px 12px",
                "border-radius": "4px",
                border: "1px solid var(--color-border)",
                "font-family": FONT_MONO,
                "font-size": "11px",
                color: "var(--color-text)",
              }}
            >
              retry
            </button>
          </div>
        }
      >
        <Show when={props.nodes.length > 0} fallback={<div style={emptyMsg()}>empty folder</div>}>
          <GridBody nodes={props.nodes} onClick={props.onClick} />
        </Show>
      </Show>
    </Show>
  )
}

function GridBody(props: { nodes: FileNode[]; onClick: (n: FileNode) => void }): JSX.Element {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fill, minmax(108px, 1fr))",
        gap: "8px",
        padding: "12px 14px",
      }}
    >
      <For each={props.nodes}>
        {(node) => {
          const c =
            node.type === "directory" ? "var(--color-text)" : (EXT_COLOR[ext(node.name)] ?? "var(--color-text-muted)")
          return (
            <button
              type="button"
              onClick={() => props.onClick(node)}
              title={node.absolute}
              style={card(node.ignored)}
              onMouseEnter={(el) => (el.currentTarget.style.background = "var(--color-accent-subtle)")}
              onMouseLeave={(el) => (el.currentTarget.style.background = "var(--color-surface-solid)")}
            >
              <span style={{ display: "inline-flex", color: c }}>
                <Show when={node.type === "directory"} fallback={<IconFile size={22} strokeWidth={1.3} />}>
                  <IconFolder size={22} strokeWidth={1.3} />
                </Show>
              </span>
              <span
                style={{
                  width: "100%",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                  "text-align": "center",
                }}
              >
                {node.name}
              </span>
            </button>
          )
        }}
      </For>
    </div>
  )
}

// ── Artifacts (Result folder files) ────────────────────────────────
function isImage(name: string) {
  return ["png", "jpg", "jpeg", "webp", "svg", "gif"].includes(ext(name))
}

function isTable(name: string) {
  return ["csv", "tsv", "xlsx", "xls", "json", "jsonl"].includes(ext(name))
}

function isDelimited(name: string) {
  return ["csv", "tsv"].includes(ext(name))
}

function isReport(name: string) {
  return ["md", "markdown", "html", "pdf", "txt"].includes(ext(name))
}

function kindLabel(name: string) {
  if (isImage(name)) return "Image"
  if (isTable(name)) return "Table"
  if (isReport(name)) return "Report"
  return ext(name).toUpperCase() || "File"
}

function compactBytes(size?: number) {
  if (!size) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function compactAge(ms?: number) {
  if (!ms) return ""
  const diff = Math.max(0, Date.now() - ms)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type FileData = { content?: string; encoding?: string; mimeType?: string }

function fileDataUrl(file: FileData | undefined, name: string) {
  if (!file?.content) return ""
  const image = artifactImageUrl(file, ext(name) === "svg" ? "image/svg+xml" : undefined)
  if (image) return image
  return `data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`
}

function base64Bytes(input: string) {
  const raw = atob(input)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function downloadMime(name: string) {
  const e = ext(name)
  if (e === "csv") return "text/csv;charset=utf-8"
  if (e === "tsv") return "text/tab-separated-values;charset=utf-8"
  if (e === "json" || e === "jsonl") return "application/json;charset=utf-8"
  if (e === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (e === "xls") return "application/vnd.ms-excel"
  if (e === "pdf") return "application/pdf"
  if (e === "png") return "image/png"
  if (e === "jpg" || e === "jpeg") return "image/jpeg"
  if (e === "webp") return "image/webp"
  if (e === "svg") return "image/svg+xml"
  if (e === "md" || e === "markdown" || e === "txt") return "text/plain;charset=utf-8"
  return "application/octet-stream"
}

function catalogRelativePath(directory: string, file: ResultFile): string {
  const raw = file.path.replace(/^file:\/\//, "").trim()
  const base = directory.replace(/\/+$/, "")
  if (base && raw.startsWith(`${base}/`)) return raw.slice(base.length + 1)
  return raw
}

function resultFileToNode(directory: string, file: ResultFile): FileNode {
  const path = catalogRelativePath(directory, file)
  const root = directory.replace(/\/+$/, "")
  return {
    name: path,
    path,
    absolute: `${root}/${path}`,
    type: "file",
    ignored: false,
    size: file.size,
  }
}
function downloadBlob(file: FileData, name: string) {
  const mime = downloadMime(name)
  if (file.encoding === "base64") {
    return new Blob([base64Bytes(file.content ?? "")], { type: mime })
  }
  // Excel on macOS/Windows often fails to open UTF-8 CSV without a BOM.
  if (["csv", "tsv"].includes(ext(name))) {
    return new Blob(["\uFEFF", file.content ?? ""], { type: mime })
  }
  return new Blob([file.content ?? ""], { type: mime })
}

function ArtifactsGrid(props: {
  directory: string
  view: "list" | "grid"
  onViewChange: (view: "list" | "grid") => void
  browseMode: BrowseMode
  onBrowseModeChange: (mode: BrowseMode) => void
  taskFileNames?: Set<string>
  recentTurnFileNames?: Set<string>
  taskResultFiles?: ResultFile[]
  recentResultFiles?: ResultFile[]
  projectPath?: string
  onRefresh: () => void
}): JSX.Element {
  const sdk = useSDK()
  const platform = usePlatform()
  const dialog = useDialog()
  const [refresh, setRefresh] = createSignal(0)
  const [preview, setPreview] = createSignal<FileNode | undefined>()
  const [query, setQuery] = createSignal("")
  const [showHidden, setShowHidden] = createSignal(false)
  const [menu, setMenu] = createSignal<{ path: string; x: number; y: number } | undefined>()
  const [data] = createResource(
    () =>
      [
        props.directory,
        refresh(),
        props.browseMode,
        [...(props.taskFileNames ?? [])].sort().join("\0"),
        [...(props.recentTurnFileNames ?? [])].sort().join("\0"),
        (props.taskResultFiles ?? []).map((f) => f.path).join("\0"),
        (props.recentResultFiles ?? []).map((f) => f.path).join("\0"),
      ] as const,
    async ([dir]) => {
      if (!dir) return [] as FileNode[]
      try {
        const res: any = await sdk.client.file.list({ directory: dir, path: "." })
        const rows = (res?.data ?? res) as FileNode[]
        if (!Array.isArray(rows)) return []
        const files: FileNode[] = rows.filter((n) => n.type === "file")
        const dirs = rows.filter((n) => n.type === "directory" && !n.name.startsWith("."))
        // Recurse one level into subdirectories (figures/, tables/, etc.)
        for (const d of dirs) {
          try {
            const sub: any = await sdk.client.file.list({ directory: dir, path: d.name })
            const subRows = (sub?.data ?? sub) as FileNode[]
            if (Array.isArray(subRows)) {
              for (const f of subRows) {
                if (f.type === "file") files.push({ ...f, name: f.path, path: f.path })
              }
              if (isResultFolderName(d.name)) {
                const children = subRows.filter((node) => node.type === "directory" && !node.name.startsWith("."))
                for (const child of children) {
                  const nested: any = await sdk.client.file.list({ directory: dir, path: `${d.name}/${child.name}` })
                  const nestedRows = (nested?.data ?? nested) as FileNode[]
                  if (!Array.isArray(nestedRows)) continue
                  for (const f of nestedRows) {
                    if (f.type === "file") {
                      files.push({
                        ...f,
                        name: f.path,
                        path: f.path,
                      })
                    }
                  }
                }
              }
            }
          } catch {
            /* skip unreadable subdir */
          }
        }
        return files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
      } catch {
        return [] as FileNode[]
      }
    },
  )

  // Touch local meta so starred/hidden updates re-render.
  const metaTick = () => artifactMetaLocal.all()
  const baseRows = createMemo(() => {
    metaTick()
    const q = query().toLowerCase().trim()
    return (data.latest ?? []).filter((n) => {
      const meta = artifactMetaLocal.get(props.directory, n.path)
      if (!showHidden() && meta.hidden) return false
      if (q && !n.name.toLowerCase().includes(q)) return false
      return true
    })
  })
  const activeNames = () => (props.browseMode === "recent" ? props.recentTurnFileNames : props.taskFileNames)
  const activeCatalog = () => (props.browseMode === "recent" ? props.recentResultFiles : props.taskResultFiles) ?? []
  const pathInNames = (diskPath: string) => {
    const names = activeNames()
    if (!names?.size) return false
    for (const key of names) {
      if (artifactPathsMatch(diskPath, key)) return true
    }
    return false
  }
  const pathInCatalog = (diskPath: string) => activeCatalog().some((file) => artifactPathsMatch(diskPath, file.path))
  const matchesTask = (name: string) => pathInNames(name) || pathInCatalog(name)
  const scopedList = (list: FileNode[]) => {
    const names = activeNames()
    const catalog = activeCatalog()
    if (names?.size || catalog.length) return list.filter((n) => matchesTask(n.name) || matchesTask(n.path))
    if (props.browseMode === "task") return list
    return []
  }
  const legacyFallback = createMemo(
    () =>
      props.browseMode === "task" && !activeNames()?.size && !activeCatalog().length && (baseRows().length ?? 0) > 0,
  )
  const diskScoped = createMemo(() => scopedList(baseRows()))
  const catalogRows = createMemo(() => {
    const catalog = activeCatalog()
    if (!catalog.length) return [] as FileNode[]
    const disk = diskScoped()
    return catalog
      .filter(
        (file) =>
          !disk.some((node) => artifactPathsMatch(node.path, file.path) || artifactPathsMatch(node.name, file.path)),
      )
      .map((file) => resultFileToNode(props.directory, file))
  })
  const mergedScoped = createMemo(() => [...diskScoped(), ...catalogRows()])
  const rows = createMemo(() => filterLatestFileNodes(mergedScoped()).deliverables)
  const hiddenVersionCount = createMemo(() => filterLatestFileNodes(mergedScoped()).hiddenCount)
  const images = createMemo(() => rows().filter((n) => isImage(n.name)))
  const open = (node: FileNode) => {
    if (isImage(node.name)) {
      uiStore.setImagePreview({
        directory: props.directory,
        path: node.path,
        name: node.name,
      })
      return
    }
    if (isDelimited(node.name)) {
      centerTabs.openFile(props.directory, node.path)
      return
    }
    centerTabs.openFile(props.directory, node.path)
  }
  const read = async (node: FileNode) => {
    const res: any = await sdk.client.file.read({ directory: props.directory, path: node.path })
    return (res?.data ?? res) as FileData
  }
  const download = async (node: FileNode) => {
    try {
      const file = await read(node)
      const blob = downloadBlob(file, node.name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = node.name
      a.click()
      URL.revokeObjectURL(url)
      toast.success("downloaded", node.name)
    } catch (e: any) {
      toast.error("download failed", e?.message ?? String(e))
    }
  }
  const remove = async (node: FileNode) => {
    const ok = await confirmDialog(dialog, {
      title: "Delete artifact?",
      message: `Delete ${node.name}? This cannot be undone.`,
      confirmLabel: "delete",
      danger: true,
    })
    if (!ok) return
    const url = `${sdk.url.replace(/\/$/, "")}/file/delete?directory=${encodeURIComponent(props.directory)}`
    const res = await (platform.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: node.path }),
    })
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}))
      toast.error("delete failed", body?.error ?? body?.message ?? `HTTP ${res.status}`)
      return
    }
    artifactMetaLocal.remove(props.directory, node.path)
    setRefresh((k) => k + 1)
    props.onRefresh()
    toast.success("deleted", node.name)
  }
  const rename = async (node: FileNode) => {
    const next = (
      await promptDialog(dialog, {
        title: "Rename artifact",
        message: "Enter a new file name. Path separators are not allowed.",
        initial: node.name,
        placeholder: node.name,
        confirmLabel: "rename",
      })
    )?.trim()
    if (!next || next === node.name) return
    if (next.includes("/") || next.includes("\\")) {
      toast.error("rename failed", "name cannot contain path separators")
      return
    }
    const to = node.path.includes("/") ? `${node.path.slice(0, node.path.lastIndexOf("/") + 1)}${next}` : next
    const url = `${sdk.url.replace(/\/$/, "")}/file/rename?directory=${encodeURIComponent(props.directory)}`
    const res = await (platform.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: node.path, to }),
    })
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}))
      toast.error("rename failed", body?.error ?? body?.message ?? `HTTP ${res.status}`)
      return
    }
    artifactMetaLocal.move(props.directory, node.path, to)
    setRefresh((k) => k + 1)
    props.onRefresh()
    toast.success("renamed", next)
  }
  const copyPath = async (node: FileNode) => {
    try {
      await navigator.clipboard?.writeText(node.absolute)
      toast.success("copied path", node.absolute)
    } catch (e: any) {
      toast.error("copy failed", e?.message ?? String(e))
    }
  }
  const exportMeta = async (node: FileNode) => {
    const meta = {
      name: node.name,
      path: node.path,
      absolute: node.absolute,
      size: node.size ?? null,
      mtime: node.mtime ?? null,
      kind: kindLabel(node.name),
      starred: !!artifactMetaLocal.get(props.directory, node.path).starred,
      hidden: !!artifactMetaLocal.get(props.directory, node.path).hidden,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${node.name}.meta.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("exported metadata", a.download)
  }
  const provenance = async (node: FileNode) => {
    const base = sdk.url.replace(/\/$/, "")
    const q = new URLSearchParams({
      directory: props.directory,
      path: node.absolute,
    })
    const res = await (platform.fetch ?? fetch)(`${base}/provenance?${q}`)
    if (!res.ok) {
      toast.error("provenance failed", `HTTP ${res.status}`)
      return
    }
    const body: any = await res.json().catch(() => ({}))
    const nodes = Array.isArray(body?.nodes) ? body.nodes : []
    if (!nodes.length) {
      await alertDialog(dialog, {
        title: "Provenance",
        message: `No provenance nodes are linked to ${node.name} yet.\n\nAsk the agent to call provenance_record with:\n• path\n• code_path (script/notebook)\n• env (python/R packages)\n• inputs_hash (source data)`,
      })
      return
    }
    const lines = nodes.slice(0, 6).map((n: any) => {
      const meta = n.meta && typeof n.meta === "object" ? n.meta : {}
      const bits = [
        `[${n.kind}] ${n.label}${n.id ? ` (${n.id})` : ""}`,
        n.path ? `  path: ${n.path}` : "",
        n.contentHash ? `  hash: ${n.contentHash}` : "",
        meta.codePath ? `  code: ${meta.codePath}` : "",
        meta.env ? `  env: ${meta.env}` : "",
        meta.inputsHash ? `  inputs: ${meta.inputsHash}` : "",
        meta.command ? `  cmd: ${meta.command}` : "",
        meta.sessionID ? `  session: ${meta.sessionID}` : "",
      ].filter(Boolean)
      return bits.join("\n")
    })
    await alertDialog(dialog, {
      title: `Provenance · ${node.name}`,
      message: `${nodes.length} node(s):\n\n${lines.join("\n\n")}`,
    })
  }
  const toggleStar = (node: FileNode) => {
    const cur = artifactMetaLocal.get(props.directory, node.path)
    artifactMetaLocal.patch(props.directory, node.path, { starred: !cur.starred })
  }
  const toggleHide = (node: FileNode) => {
    const cur = artifactMetaLocal.get(props.directory, node.path)
    artifactMetaLocal.patch(props.directory, node.path, { hidden: !cur.hidden })
  }
  const openMenu = (node: FileNode, event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ path: node.path, x: rect.right - 220, y: rect.bottom + 4 })
  }
  const closeMenu = () => setMenu(undefined)
  createEffect(() => {
    if (!menu()) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.("[data-artifact-menu]")) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu()
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    })
  })
  const menuNode = createMemo(() => rows().find((n) => n.path === menu()?.path))

  return (
    <div
      style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column", background: "var(--color-bg)" }}
    >
      <FilesToolbar
        browseMode={props.browseMode}
        onBrowseModeChange={props.onBrowseModeChange}
        search={query()}
        onSearch={setQuery}
        count={rows().length}
        view={props.view}
        onViewChange={props.onViewChange}
        onRefresh={() => {
          setRefresh((k) => k + 1)
          props.onRefresh()
        }}
        meta={hiddenVersionCount() > 0 ? `已折叠 ${hiddenVersionCount()} 个历史版本` : undefined}
        showHidden={showHidden()}
        onToggleHidden={() => setShowHidden((v) => !v)}
        projectPath={props.projectPath}
      />

      <div class="thesis-scroll" style={{ flex: 1, "min-height": 0, "overflow-y": "auto" }}>
        <Show when={legacyFallback()}>
          <div
            style={{
              padding: "8px 14px",
              "font-size": "11px",
              color: "var(--color-text-faint)",
              "border-bottom": "1px solid var(--color-border-weak-base)",
            }}
          >
            未从对话记录识别到产物关联，暂显示 result/ 下全部文件。精确关联需工具 verified 元数据或重新运行分析。
          </div>
        </Show>
        <Show
          when={rows().length > 0}
          fallback={
            <div style={emptyMsg()}>
              {data.loading
                ? "loading artifacts…"
                : query()
                  ? "No matching artifacts"
                  : props.browseMode === "recent"
                    ? "最近一轮暂无产物。切换「本任务」查看累计产出，或在「项目」中浏览完整目录。"
                    : "本任务暂无产物。运行分析后刷新，或在「项目」中浏览完整目录。"}
            </div>
          }
        >
          <Show
            when={props.view === "grid"}
            fallback={
              <div style={{ padding: "8px 10px", display: "flex", "flex-direction": "column", gap: "4px" }}>
                <For each={rows()}>
                  {(node) => (
                    <ArtifactListRow
                      node={node}
                      directory={props.directory}
                      onOpen={() => open(node)}
                      onDownload={() => void download(node)}
                      onMenu={(e) => openMenu(node, e)}
                    />
                  )}
                </For>
              </div>
            }
          >
            <div
              style={{
                padding: "14px",
                display: "grid",
                "grid-template-columns": "repeat(auto-fill, minmax(178px, 1fr))",
                gap: "12px",
              }}
            >
              <For each={rows()}>
                {(node) => (
                  <ArtifactCard
                    node={node}
                    directory={props.directory}
                    onOpen={() => open(node)}
                    onDownload={(e) => {
                      e.stopPropagation()
                      void download(node)
                    }}
                    onMenu={(e) => openMenu(node, e)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={menu() && menuNode()}>
        <Portal>
          <div
            data-artifact-menu
            style={{
              position: "fixed",
              left: `${menu()!.x}px`,
              top: `${menu()!.y}px`,
              width: "220px",
              background: "var(--color-surface-solid)",
              border: "1px solid var(--color-border-strong)",
              "border-radius": "10px",
              "box-shadow": "var(--shadow-md)",
              padding: "6px",
              "z-index": 1200,
            }}
          >
            <ArtifactMenu
              node={menuNode()!}
              directory={props.directory}
              onClose={closeMenu}
              onStar={() => toggleStar(menuNode()!)}
              onHide={() => toggleHide(menuNode()!)}
              onOpen={() => open(menuNode()!)}
              onCopy={() => void copyPath(menuNode()!)}
              onRename={() => void rename(menuNode()!)}
              onDownload={() => void download(menuNode()!)}
              onExportMeta={() => void exportMeta(menuNode()!)}
              onProvenance={() => void provenance(menuNode()!)}
              onDelete={() => void remove(menuNode()!)}
            />
          </div>
        </Portal>
      </Show>
    </div>
  )
}

function subtitle(node: FileNode) {
  const age = compactAge(node.mtime)
  return age ? `${age} · HYscience` : "HYscience"
}

function ArtifactQuick(props: {
  onDownload: (event: MouseEvent) => void
  onMenu: (event: MouseEvent) => void
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        title="more"
        style={artifactAction()}
        onClick={(e) => {
          e.stopPropagation()
          props.onMenu(e)
        }}
      >
        <IconMoreV size={13} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        title="download"
        style={artifactAction()}
        onClick={(e) => {
          e.stopPropagation()
          props.onDownload(e)
        }}
      >
        <IconDownload size={13} strokeWidth={1.7} />
      </button>
    </>
  )
}

function ArtifactCard(props: {
  node: FileNode
  directory: string
  onOpen: () => void
  onDownload: (event: MouseEvent) => void
  onMenu: (event: MouseEvent) => void
}): JSX.Element {
  const starred = () => !!artifactMetaLocal.get(props.directory, props.node.path).starred
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onOpen()
      }}
      title={props.node.absolute}
      style={artifactCard()}
    >
      <div style={artifactThumb()}>
        <Show
          when={isImage(props.node.name)}
          fallback={
            <Show when={isTable(props.node.name)} fallback={<FileThumb node={props.node} />}>
              <TableThumb directory={props.directory} node={props.node} />
            </Show>
          }
        >
          <ImageThumb directory={props.directory} node={props.node} />
        </Show>
        <Show when={starred()}>
          <span style={{ position: "absolute", top: "8px", left: "8px", color: "#d4a017" }}>
            <IconStarFilled size={13} strokeWidth={1.5} />
          </span>
        </Show>
        <div style={artifactActions()}>
          <ArtifactQuick onDownload={props.onDownload} onMenu={props.onMenu} />
        </div>
      </div>
      <div
        style={{
          padding: "9px 10px 10px",
          display: "flex",
          "flex-direction": "column",
          gap: "4px",
          "text-align": "left",
        }}
      >
        <span
          style={{
            "font-family": FONT_SANS,
            "font-size": "13px",
            "font-weight": 600,
            color: "var(--color-text)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.node.name}
        </span>
        <span style={{ "font-family": FONT_SANS, "font-size": "11px", color: "var(--color-text-faint)" }}>
          {subtitle(props.node)}
        </span>
      </div>
    </div>
  )
}

function FileThumb(props: { node: FileNode }): JSX.Element {
  const label = () => ext(props.node.name).toUpperCase() || "FILE"
  return (
    <div
      style={{
        height: "100%",
        padding: "18px",
        display: "flex",
        "flex-direction": "column",
        "justify-content": "space-between",
        background: "linear-gradient(135deg, var(--color-bg-subtle), var(--color-surface-solid))",
        color: "var(--color-text-faint)",
      }}
    >
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
        <ExtBadge name={props.node.name} />
        <IconFile size={18} strokeWidth={1.3} />
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "5px", "min-width": 0 }}>
        <span
          style={{
            "font-family": FONT_MONO,
            "font-size": "11px",
            "font-weight": 700,
            color: "var(--color-text-muted)",
            "letter-spacing": "0.06em",
          }}
        >
          {label()}
        </span>
        <span
          style={{
            "font-family": FONT_SANS,
            "font-size": "11px",
            color: "var(--color-text-faint)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.node.name}
        </span>
      </div>
    </div>
  )
}

function ArtifactListRow(props: {
  node: FileNode
  directory: string
  onOpen: () => void
  onDownload: () => void
  onMenu: (event: MouseEvent) => void
}): JSX.Element {
  const starred = () => !!artifactMetaLocal.get(props.directory, props.node.path).starred
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onOpen()
      }}
      title={props.node.absolute}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "8px 10px",
        "border-radius": "8px",
        border: "1px solid transparent",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        style={{
          width: "44px",
          height: "44px",
          "border-radius": "6px",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-subtle)",
          overflow: "hidden",
          "flex-shrink": 0,
          display: "grid",
          "place-items": "center",
        }}
      >
        <Show
          when={isImage(props.node.name)}
          fallback={
            <Show when={isTable(props.node.name)} fallback={<IconFile size={18} strokeWidth={1.3} />}>
              <TableGlyph size={18} />
            </Show>
          }
        >
          <ImageThumb directory={props.directory} node={props.node} />
        </Show>
      </div>
      <div style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: "2px" }}>
        <span
          style={{
            "font-family": FONT_SANS,
            "font-size": "13px",
            "font-weight": 600,
            color: "var(--color-text)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            display: "inline-flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <Show when={starred()}>
            <span style={{ color: "#d4a017", display: "inline-flex" }}>
              <IconStarFilled size={11} strokeWidth={1.5} />
            </span>
          </Show>
          {props.node.name}
        </span>
        <span style={{ "font-family": FONT_SANS, "font-size": "11px", color: "var(--color-text-faint)" }}>
          {kindLabel(props.node.name)} · {subtitle(props.node)}
        </span>
      </div>
      <span
        style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)", "flex-shrink": 0 }}
      >
        {compactBytes(props.node.size)}
      </span>
      <ArtifactQuick onDownload={() => props.onDownload()} onMenu={props.onMenu} />
    </div>
  )
}

function ArtifactMenu(props: {
  node: FileNode
  directory: string
  onClose: () => void
  onStar: () => void
  onHide: () => void
  onOpen: () => void
  onCopy: () => void
  onRename: () => void
  onDownload: () => void
  onExportMeta: () => void
  onProvenance: () => void
  onDelete: () => void
}): JSX.Element {
  const meta = () => artifactMetaLocal.get(props.directory, props.node.path)
  const run = (fn: () => void) => {
    fn()
    props.onClose()
  }
  return (
    <>
      <MenuRow
        icon={
          meta().starred ? <IconStarFilled size={13} strokeWidth={1.6} /> : <IconStar size={13} strokeWidth={1.6} />
        }
        label={meta().starred ? "Unstar" : "Star"}
        onClick={() => run(props.onStar)}
      />
      <MenuRow
        icon={<IconEyeOff size={13} strokeWidth={1.6} />}
        label={meta().hidden ? "Unhide" : "Hide"}
        onClick={() => run(props.onHide)}
      />
      <MenuSep />
      <MenuRow icon={<IconEye size={13} strokeWidth={1.6} />} label="Open" onClick={() => run(props.onOpen)} />
      <MenuRow icon={<IconLink size={13} strokeWidth={1.6} />} label="Copy path" onClick={() => run(props.onCopy)} />
      <MenuRow icon={<IconPencil size={13} strokeWidth={1.6} />} label="Rename" onClick={() => run(props.onRename)} />
      <MenuRow
        icon={<IconDownload size={13} strokeWidth={1.6} />}
        label="Download"
        onClick={() => run(props.onDownload)}
      />
      <MenuRow
        icon={<IconCopy size={13} strokeWidth={1.6} />}
        label="Export Metadata"
        onClick={() => run(props.onExportMeta)}
      />
      <MenuRow
        icon={<IconGitBranch size={13} strokeWidth={1.6} />}
        label="Provenance"
        onClick={() => run(props.onProvenance)}
      />
      <MenuSep />
      <MenuRow
        icon={<IconTrash size={13} strokeWidth={1.6} />}
        label="Delete"
        danger
        onClick={() => run(props.onDelete)}
      />
    </>
  )
}

function MenuSep(): JSX.Element {
  return <div style={{ height: "1px", margin: "4px 6px", background: "var(--color-border)" }} />
}

function MenuRow(props: { icon: JSX.Element; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        "align-items": "center",
        gap: "10px",
        width: "100%",
        "box-sizing": "border-box",
        padding: "8px 9px",
        "border-radius": "6px",
        "font-family": FONT_SANS,
        "font-size": "13px",
        color: props.danger ? "#c0392b" : "var(--color-text)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ display: "inline-flex", width: "14px", "justify-content": "center" }}>{props.icon}</span>
      <span>{props.label}</span>
    </button>
  )
}

function ImageThumb(props: { directory: string; node: FileNode }): JSX.Element {
  const sdk = useSDK()
  const [file] = createResource(
    () => [props.directory, props.node.path] as const,
    async ([directory, path]) => {
      const res: any = await sdk.client.file.read({ directory, path })
      return (res?.data ?? res) as FileData
    },
  )
  const src = () => fileDataUrl(file(), props.node.name)
  return (
    <Show when={src()} fallback={<div style={{ width: "100%", height: "100%", "min-height": "80px" }} />}>
      {(ready) => (
        <img
          src={ready()}
          alt=""
          style={{ width: "100%", height: "100%", "object-fit": "contain", display: "block" }}
        />
      )}
    </Show>
  )
}

function splitLine(line: string, sep: string) {
  const out: string[] = []
  let cur = ""
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
        continue
      }
      q = !q
      continue
    }
    if (c === sep && !q) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

function isNumeric(value: string) {
  const t = value.trim()
  if (!t) return false
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)
}

function parseTable(text: string, name: string) {
  const sep = ext(name) === "tsv" ? "\t" : ","
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
  if (!lines.length)
    return { rows: 0, cols: 0, fields: [] as { name: string; kind: "num" | "str" }[], cells: [] as string[][] }
  const header = splitLine(lines[0], sep).map((h) => h.trim() || "col")
  const sample = lines.slice(1, 9).map((l) => splitLine(l, sep))
  const fields = header.map((h, i) => {
    const vals = sample.map((r) => r[i] ?? "").filter((v) => v.trim().length > 0)
    const kind = vals.length > 0 && vals.every(isNumeric) ? ("num" as const) : ("str" as const)
    return { name: h, kind }
  })
  const cells = [header, ...sample]
  return { rows: Math.max(0, lines.length - 1), cols: header.length, fields, cells }
}

function TableGlyph(props: { size?: number }): JSX.Element {
  const s = props.size ?? 22
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.4" />
      <path d="M3 9h18M3 14h18M9 4v16M15 4v16" stroke="currentColor" stroke-width="1.4" />
      <rect x="9" y="9" width="6" height="5" fill="color-mix(in srgb, var(--color-accent, #3b82f6) 35%, transparent)" />
    </svg>
  )
}

function TypeChip(props: { kind: "num" | "str" }): JSX.Element {
  const num = props.kind === "num"
  return (
    <span
      style={{
        display: "inline-grid",
        "place-items": "center",
        width: "22px",
        height: "16px",
        "border-radius": "3px",
        "flex-shrink": 0,
        "font-family": FONT_MONO,
        "font-size": "9px",
        "font-weight": 600,
        "letter-spacing": "-0.02em",
        background: num
          ? "color-mix(in srgb, #3b82f6 18%, var(--color-bg-subtle))"
          : "color-mix(in srgb, var(--color-text-faint) 14%, var(--color-bg-subtle))",
        color: num ? "#2563eb" : "var(--color-text-muted)",
        border: `1px solid ${num ? "color-mix(in srgb, #3b82f6 28%, transparent)" : "var(--color-border)"}`,
      }}
    >
      {num ? "123" : "Aa"}
    </span>
  )
}

function TableThumb(props: { directory: string; node: FileNode }): JSX.Element {
  const sdk = useSDK()
  const delimited = () => isDelimited(props.node.name)
  const [file] = createResource(
    () => (delimited() ? ([props.directory, props.node.path] as const) : undefined),
    async (input) => {
      if (!input) return ""
      const res: any = await sdk.client.file.read({ directory: input[0], path: input[1] })
      const data = (res?.data ?? res) as FileData
      return data.content ?? ""
    },
  )
  const summary = createMemo(() => {
    if (!delimited()) return null
    const text = file()
    if (!text) return null
    return parseTable(text, props.node.name)
  })
  return (
    <Show
      when={summary()}
      fallback={
        <div
          style={{
            height: "100%",
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            gap: "8px",
            padding: "12px",
            color: "var(--color-text-muted)",
            background: "linear-gradient(180deg, var(--color-bg-subtle) 0%, var(--color-surface-solid) 100%)",
          }}
        >
          <TableGlyph size={28} />
          <span style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)" }}>
            {ext(props.node.name).toUpperCase() || "TABLE"} · {compactBytes(props.node.size)}
          </span>
        </div>
      }
    >
      {(meta) => (
        <div
          style={{
            height: "100%",
            display: "flex",
            "flex-direction": "column",
            gap: "6px",
            padding: "12px 12px 10px",
            "box-sizing": "border-box",
            background: "linear-gradient(180deg, var(--color-bg-subtle) 0%, var(--color-surface-solid) 100%)",
          }}
        >
          <div
            style={{
              "font-family": FONT_MONO,
              "font-size": "10px",
              color: "var(--color-text-faint)",
              "letter-spacing": "0.01em",
            }}
          >
            {meta().rows.toLocaleString()} rows · {meta().cols} columns
          </div>
          <div
            style={{
              flex: 1,
              "min-height": 0,
              display: "flex",
              "flex-direction": "column",
              gap: "5px",
              overflow: "hidden",
            }}
          >
            <For each={meta().fields.slice(0, 5)}>
              {(field) => (
                <div style={{ display: "flex", "align-items": "center", gap: "7px", "min-width": 0 }}>
                  <TypeChip kind={field.kind} />
                  <span
                    style={{
                      "font-family": FONT_SANS,
                      "font-size": "12px",
                      color: "var(--color-text)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {field.name}
                  </span>
                </div>
              )}
            </For>
            <Show when={meta().fields.length > 5}>
              <span style={{ "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)" }}>
                +{meta().fields.length - 5} more
              </span>
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}

function useOverlayVisible(active: () => boolean) {
  const [visible, setVisible] = createSignal(false)
  createEffect(() => {
    if (!active()) {
      setVisible(false)
      return
    }
    const frame = requestAnimationFrame(() => setVisible(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })
  return visible
}

function TablePreview(props: {
  node: FileNode
  directory: string
  onClose: () => void
  onDownload: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [file] = createResource(
    () => [props.directory, props.node.path] as const,
    async ([directory, path]) => {
      const res: any = await sdk.client.file.read({ directory, path })
      return (res?.data ?? res) as FileData
    },
  )
  const table = createMemo(() => {
    const text = file()?.content
    if (!text) return null
    return parseTable(text, props.node.name)
  })
  const overlayVisible = useOverlayVisible(() => true)
  return (
    <Portal>
      <div style={previewOverlay(overlayVisible())} onClick={props.onClose}>
        <div style={previewFrame()} onClick={(e) => e.stopPropagation()}>
          <div style={previewBar()}>
            <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
              {props.node.name}
            </span>
            <Show when={table()}>
              {(meta) => (
                <span style={{ "font-family": FONT_MONO, "font-size": "11px", color: "var(--color-text-faint)" }}>
                  {meta().rows.toLocaleString()} × {meta().cols}
                </span>
              )}
            </Show>
            <button type="button" title="download" style={previewBtn()} onClick={props.onDownload}>
              <IconDownload size={13} strokeWidth={1.7} />
            </button>
            <button type="button" title="close" style={previewBtn()} onClick={props.onClose}>
              <IconX size={13} strokeWidth={1.7} />
            </button>
          </div>
          <div style={{ flex: 1, "min-height": 0, overflow: "auto", background: "var(--color-bg)" }}>
            <Show
              when={table()}
              fallback={
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    "place-items": "center",
                    "font-family": FONT_SANS,
                    "font-size": "13px",
                    color: "var(--color-text-faint)",
                  }}
                >
                  {file.loading ? "loading…" : "no preview"}
                </div>
              }
            >
              {(meta) => (
                <table
                  style={{
                    width: "max-content",
                    "min-width": "100%",
                    "border-collapse": "separate",
                    "border-spacing": 0,
                    "font-family": FONT_SANS,
                    "font-size": "12px",
                  }}
                >
                  <thead>
                    <tr>
                      <For each={meta().fields}>
                        {(field) => (
                          <th
                            style={{
                              position: "sticky",
                              top: 0,
                              "z-index": 1,
                              padding: "10px 14px",
                              "text-align": "left",
                              "font-weight": 600,
                              color: "var(--color-text)",
                              background: "var(--color-surface-solid)",
                              border: "0 solid var(--color-border)",
                              "border-bottom-width": "1px",
                              "border-right-width": "1px",
                              "white-space": "nowrap",
                            }}
                          >
                            <span style={{ display: "inline-flex", "align-items": "center", gap: "7px" }}>
                              <TypeChip kind={field.kind} />
                              {field.name}
                            </span>
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={meta().cells.slice(1)}>
                      {(row, ri) => (
                        <tr>
                          <For each={meta().fields}>
                            {(_, ci) => (
                              <td
                                style={{
                                  padding: "8px 14px",
                                  color: "var(--color-text)",
                                  background: ri() % 2 === 0 ? "var(--color-surface-solid)" : "var(--color-bg-subtle)",
                                  border: "0 solid var(--color-border)",
                                  "border-bottom-width": "1px",
                                  "border-right-width": "1px",
                                  "white-space": "nowrap",
                                  "max-width": "280px",
                                  overflow: "hidden",
                                  "text-overflow": "ellipsis",
                                  "font-variant-numeric": "tabular-nums",
                                }}
                              >
                                {row[ci()] ?? ""}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              )}
            </Show>
          </div>
          <Show when={table() && table()!.rows > 8}>
            <div
              style={{
                padding: "8px 14px",
                "border-top": "1px solid var(--color-border)",
                "font-family": FONT_MONO,
                "font-size": "11px",
                color: "var(--color-text-faint)",
              }}
            >
              showing first 8 of {table()!.rows.toLocaleString()} rows
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  )
}

function ImagePreview(props: {
  node: FileNode
  images: FileNode[]
  directory: string
  onClose: () => void
  onSelect: (node: FileNode) => void
  onDownload: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [file] = createResource(
    () => [props.directory, props.node.path] as const,
    async ([directory, path]) => {
      const res: any = await sdk.client.file.read({ directory, path })
      return (res?.data ?? res) as FileData
    },
  )
  const source = () => fileDataUrl(file(), props.node.name)
  const [ready, setReady] = createSignal("")
  createEffect(() => {
    const value = source()
    if (!value) {
      setReady("")
      return
    }
    setReady("")
    const image = new Image()
    const reveal = () => {
      if (source() !== value) return
      setReady(value)
    }
    image.decoding = "async"
    image.onload = reveal
    image.src = value
    void image
      .decode()
      .then(reveal)
      .catch(() => undefined)
    onCleanup(() => {
      image.onload = null
    })
  })
  const index = () => props.images.findIndex((n) => n.path === props.node.path)
  const [zoom, setZoom] = createSignal(1)
  const setZoomBounded = (value: number) => setZoom(Math.min(6, Math.max(0.5, value)))
  createEffect(() => {
    props.node.path
    setZoom(1)
  })
  const step = (delta: number) => {
    const items = props.images
    if (!items.length) return
    const next = (index() + delta + items.length) % items.length
    props.onSelect(items[next])
  }
  const overlayVisible = useOverlayVisible(() => !!ready())
  return (
    <Show when={ready()}>
      {(image) => (
        <Portal>
          <div style={previewOverlay(overlayVisible())} onClick={props.onClose}>
            <div style={previewFrame()} onClick={(e) => e.stopPropagation()}>
              <div style={previewBar()}>
                <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  {props.node.name}
                </span>
                <button type="button" style={previewBtn()} onClick={() => step(-1)}>
                  ‹
                </button>
                <span style={{ "font-family": FONT_MONO, "font-size": "11px", color: "var(--color-text-faint)" }}>
                  {index() + 1}/{props.images.length}
                </span>
                <button type="button" style={previewBtn()} onClick={() => step(1)}>
                  ›
                </button>
                <button
                  type="button"
                  title="zoom out"
                  style={previewBtn()}
                  onClick={() => setZoomBounded(zoom() - 0.25)}
                >
                  −
                </button>
                <span
                  style={{
                    "font-family": FONT_MONO,
                    "font-size": "10px",
                    color: "var(--color-text-faint)",
                    width: "34px",
                  }}
                >
                  {Math.round(zoom() * 100)}%
                </span>
                <button
                  type="button"
                  title="zoom in"
                  style={previewBtn()}
                  onClick={() => setZoomBounded(zoom() + 0.25)}
                >
                  +
                </button>
                <button type="button" title="reset zoom" style={previewBtn()} onClick={() => setZoom(1)}>
                  1:1
                </button>
                <button type="button" title="download" style={previewBtn()} onClick={props.onDownload}>
                  <IconDownload size={13} strokeWidth={1.7} />
                </button>
                <button type="button" title="close" style={previewBtn()} onClick={props.onClose}>
                  <IconX size={13} strokeWidth={1.7} />
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  "min-height": 0,
                  display: "grid",
                  "place-items": "center",
                  padding: "18px",
                  overflow: "auto",
                }}
                onWheel={(event) => {
                  event.preventDefault()
                  setZoomBounded(zoom() + (event.deltaY < 0 ? 0.25 : -0.25))
                }}
              >
                <img
                  src={image()}
                  alt={props.node.name}
                  style={{
                    width: zoom() === 1 ? "auto" : `${zoom() * 100}%`,
                    height: "auto",
                    "max-width": zoom() === 1 ? "100%" : "none",
                    "max-height": zoom() === 1 ? "100%" : "none",
                    "object-fit": "contain",
                    display: "block",
                    cursor: zoom() > 1 ? "zoom-out" : "zoom-in",
                  }}
                />
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function pill(): JSX.CSSProperties {
  return {
    display: "inline-flex",
    "align-items": "center",
    gap: "2px",
    padding: "2px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
  } as JSX.CSSProperties
}

type BrowseMode = "recent" | "task" | "project"

function FilesToolbar(props: {
  browseMode: BrowseMode
  onBrowseModeChange: (mode: BrowseMode) => void
  search: string
  onSearch: (value: string) => void
  count: number
  view: "list" | "grid"
  onViewChange: (view: "list" | "grid") => void
  onRefresh: () => void
  meta?: string
  showHidden?: boolean
  onToggleHidden?: () => void
  projectPath?: string
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "6px",
        padding: "8px 12px",
        "border-bottom": "1px solid var(--color-border)",
        "flex-shrink": 0,
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
        <span
          style={{
            "font-family": FONT_SANS,
            "font-size": "12px",
            "font-weight": 600,
            color: "var(--color-text)",
            "flex-shrink": 0,
          }}
        >
          产物
        </span>
        <div
          style={{
            flex: 1,
            "min-width": 0,
            display: "flex",
            "align-items": "center",
            gap: "6px",
            height: "28px",
            padding: "0 8px",
            "border-radius": "6px",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-solid)",
          }}
        >
          <IconSearch size={12} strokeWidth={1.5} style={{ color: "var(--color-text-faint)", "flex-shrink": 0 }} />
          <input
            value={props.search}
            onInput={(e) => props.onSearch(e.currentTarget.value)}
            placeholder="搜索产物…"
            style={{
              all: "unset",
              flex: 1,
              "min-width": 0,
              "font-family": FONT_SANS,
              "font-size": "12px",
              color: "var(--color-text)",
            }}
          />
        </div>
        <span style={{ "font-size": "11px", color: "var(--color-text-faint)", "white-space": "nowrap" }}>
          {props.count} 项
        </span>
        <Show when={props.meta}>
          {(meta) => (
            <span style={{ "font-size": "10px", color: "var(--color-text-faint)", "white-space": "nowrap" }}>
              {meta()}
            </span>
          )}
        </Show>
        <ViewSwitch view={props.view} onChange={props.onViewChange} />
        <Show when={props.onToggleHidden !== undefined}>
          <button
            type="button"
            title={props.showHidden ? "隐藏已标记项" : "显示已隐藏项"}
            style={navBtn(false)}
            onClick={props.onToggleHidden}
          >
            <Show when={props.showHidden} fallback={<IconEyeOff size={12} strokeWidth={1.6} />}>
              <IconEye size={12} strokeWidth={1.6} />
            </Show>
          </button>
        </Show>
        <button type="button" title="刷新" style={navBtn(false)} onClick={props.onRefresh}>
          <IconRefresh size={12} strokeWidth={1.6} />
        </button>
      </div>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
        <BrowseModeSwitch mode={props.browseMode} onChange={props.onBrowseModeChange} projectPath={props.projectPath} />
      </div>
    </div>
  )
}

function BrowseModeSwitch(props: {
  mode: BrowseMode
  onChange: (mode: BrowseMode) => void
  projectPath?: string
}): JSX.Element {
  return (
    <div style={{ ...pill(), "flex-shrink": 0 }}>
      <button type="button" style={pillBtn(props.mode === "recent")} onClick={() => props.onChange("recent")}>
        最近
      </button>
      <button type="button" style={pillBtn(props.mode === "task")} onClick={() => props.onChange("task")}>
        本任务
      </button>
      <button type="button" style={pillBtn(props.mode === "project")} onClick={() => props.onChange("project")}>
        <IconFolder size={11} strokeWidth={1.6} />
        项目
        <Show when={props.projectPath}>
          {(path) => (
            <span
              title={path()}
              style={{
                "font-weight": 500,
                color: "var(--color-text-faint)",
                "max-width": "min(360px, 40vw)",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              ({path()})
            </span>
          )}
        </Show>
      </button>
    </div>
  )
}

function ViewSwitch(props: { view: "list" | "grid"; onChange: (view: "list" | "grid") => void }): JSX.Element {
  return (
    <div style={pill()}>
      <button type="button" title="列表" style={pillBtn(props.view === "list")} onClick={() => props.onChange("list")}>
        <ListGlyph size={12} />
      </button>
      <button type="button" title="平铺" style={pillBtn(props.view === "grid")} onClick={() => props.onChange("grid")}>
        <IconLayoutGrid size={12} strokeWidth={1.6} />
      </button>
    </div>
  )
}

function pillBtn(active: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    "align-items": "center",
    gap: "5px",
    padding: "4px 9px",
    "border-radius": "4px",
    "font-family": FONT_MONO,
    "font-size": "11px",
    "font-weight": active ? 600 : 500,
    color: active ? "var(--color-text)" : "var(--color-text-muted)",
    background: active ? "var(--color-surface-solid)" : "transparent",
    "box-shadow": active ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
    transition: "all 120ms ease",
  } as JSX.CSSProperties
}

function navBtn(disabled: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "28px",
    height: "28px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    color: "var(--color-text-muted)",
    opacity: disabled ? 0.4 : 1,
    "flex-shrink": 0,
  } as JSX.CSSProperties
}

function colHeader(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "center",
    gap: "10px",
    padding: "6px 16px",
    "font-family": FONT_MONO,
    "font-size": "10px",
    "letter-spacing": "0.08em",
    "text-transform": "uppercase",
    color: "var(--color-text-faint)",
    "border-bottom": "1px solid var(--color-border)",
    position: "sticky",
    top: 0,
    background: "var(--color-bg-subtle)",
    "z-index": 1,
  } as JSX.CSSProperties
}

function row(ignored: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "align-items": "center",
    gap: "10px",
    width: "100%",
    padding: "7px 16px",
    "font-family": FONT_MONO,
    "font-size": "12px",
    color: "var(--color-text-muted)",
    opacity: ignored ? 0.5 : 1,
    "font-style": ignored ? "italic" : "normal",
    transition: "background 120ms ease",
  } as JSX.CSSProperties
}

function cell(): JSX.CSSProperties {
  return {
    width: "78px",
    "text-align": "right",
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    "flex-shrink": 0,
  } as JSX.CSSProperties
}

function card(ignored: boolean): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    gap: "8px",
    padding: "14px 8px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    "font-family": FONT_MONO,
    "font-size": "11px",
    color: "var(--color-text-muted)",
    opacity: ignored ? 0.5 : 1,
    transition: "background 120ms ease",
  } as JSX.CSSProperties
}

function artifactCard(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "flex",
    "flex-direction": "column",
    "border-radius": "10px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
    overflow: "hidden",
    "box-shadow": "0 1px 2px rgba(15,23,42,0.04)",
    transition: "transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
  } as JSX.CSSProperties
}

function artifactThumb(): JSX.CSSProperties {
  return {
    position: "relative",
    height: "168px",
    background: "var(--color-bg-subtle)",
    border: "0 solid var(--color-border)",
    "border-bottom-width": "1px",
    overflow: "hidden",
  } as JSX.CSSProperties
}

function artifactActions(): JSX.CSSProperties {
  return {
    position: "absolute",
    top: "8px",
    right: "8px",
    display: "flex",
    gap: "6px",
  } as JSX.CSSProperties
}

function artifactAction(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "grid",
    "place-items": "center",
    width: "26px",
    height: "26px",
    "border-radius": "999px",
    border: "1px solid color-mix(in srgb, var(--color-border) 70%, transparent)",
    background: "color-mix(in srgb, var(--color-surface-solid) 88%, transparent)",
    color: "var(--color-text-muted)",
    "backdrop-filter": "blur(8px)",
  } as JSX.CSSProperties
}

function previewOverlay(visible = true): JSX.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    "z-index": 1000,
    background: "rgba(15, 23, 42, 0.72)",
    display: "grid",
    "place-items": "center",
    padding: "28px",
    opacity: visible ? 1 : 0,
    transition: "opacity 150ms ease",
  } as JSX.CSSProperties
}

function previewFrame(): JSX.CSSProperties {
  return {
    width: "min(1120px, 94vw)",
    height: "min(780px, 88vh)",
    display: "flex",
    "flex-direction": "column",
    "border-radius": "14px",
    background: "var(--color-surface-solid)",
    overflow: "hidden",
    "box-shadow": "0 24px 70px rgba(0,0,0,0.32)",
  } as JSX.CSSProperties
}

function previewBar(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    padding: "10px 12px",
    border: "0 solid var(--color-border)",
    "border-bottom-width": "1px",
    "font-family": FONT_SANS,
    "font-size": "13px",
    color: "var(--color-text)",
  } as JSX.CSSProperties
}

function previewBtn(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "grid",
    "place-items": "center",
    width: "28px",
    height: "28px",
    "border-radius": "6px",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-muted)",
  } as JSX.CSSProperties
}

function emptyMsg(): JSX.CSSProperties {
  return {
    display: "grid",
    "place-items": "center",
    padding: "40px 20px",
    "font-family": FONT_MONO,
    "font-size": "11px",
    color: "var(--color-text-faint)",
    "text-align": "center",
  } as JSX.CSSProperties
}
