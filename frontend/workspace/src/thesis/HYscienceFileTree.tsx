import { createSignal, createResource, createMemo, onCleanup, type JSX, For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconFolder, IconFile, IconChevronRight, IconChevronDown, IconRefresh, IconSearch } from "@/thesis/shared/Icon"

interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
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
  jsonl: "#888892",
  rs: "#CE412B",
  go: "#00ADD8",
  swift: "#F05138",
  java: "#B07219",
  rb: "#CC342D",
  sh: "#89E051",
  css: "#563D7C",
  html: "#E34F26",
  c: "#555555",
  cpp: "#F34B7D",
  h: "#555555",
}

const ext = (name: string): string => {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

type ExtKind =
  | "py"
  | "js"
  | "ts"
  | "tsx"
  | "jsx"
  | "json"
  | "md"
  | "html"
  | "css"
  | "img"
  | "data"
  | "csv"
  | "log"
  | "txt"
  | "file"

function fileExtKind(name: string): ExtKind {
  const x = ext(name)
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(x)) return "img"
  if (["csv", "tsv"].includes(x)) return "csv"
  if (["parquet", "jsonl", "yaml", "yml", "toml", "xml"].includes(x)) return "data"
  if (["log"].includes(x)) return "log"
  if (["txt"].includes(x)) return "txt"
  if (x in EXT_COLOR || ["py", "js", "ts", "tsx", "jsx", "json", "md", "html", "css"].includes(x)) return x as ExtKind
  return "file"
}

export function ExtBadge(props: { name: string }): JSX.Element {
  const kind = () => fileExtKind(props.name)
  const label = () => {
    const k = kind()
    if (k === "img") return "IMG"
    if (k === "data") return "DAT"
    if (k === "file") return "·"
    return k.toUpperCase().slice(0, 3)
  }
  return (
    <span
      class={`hy-files-ext hy-files-ext-${kind() === "file" || kind() === "log" || kind() === "txt" ? "muted" : kind()}`}
    >
      {label()}
    </span>
  )
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.ignored !== b.ignored) return a.ignored ? 1 : -1
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Live file tree backed by sdk.client.file.list (the same endpoint the CLI
 * uses). Folders fetch lazily on expand. Filter shrinks to matches as the
 * user types.
 */
export function HYscienceFileTree(props: {
  onOpen?: (path: string) => void
  selectedPath?: () => string | undefined
  mode?: "default" | "sidebar"
}): JSX.Element {
  const sdk = useSDK()
  const directory = () => sdk.directory
  const sidebar = () => props.mode === "sidebar"

  const [filter, setFilter] = createSignal("")
  const [query, setQuery] = createSignal("")
  let filterTimer: ReturnType<typeof setTimeout> | undefined
  const onFilter = (v: string) => {
    setFilter(v)
    clearTimeout(filterTimer)
    filterTimer = setTimeout(() => setQuery(v), 110)
  }
  onCleanup(() => clearTimeout(filterTimer))
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [permissionError, setPermissionError] = createSignal<string | null>(null)

  const [root] = createResource(
    () => [directory(), refreshKey()] as const,
    async ([dir]) => {
      setPermissionError(null)
      if (!dir) return [] as FileNode[]
      try {
        const res: any = await sdk.client.file.list({ directory: dir, path: "." } as any)
        const data = res?.data ?? res
        if (Array.isArray(data)) return data as FileNode[]
        return []
      } catch (err: any) {
        const status = err?.response?.status ?? err?.status ?? err?.statusCode
        if (status === 403) {
          const message = err?.body?.message ?? err?.message ?? "HYscience cannot read this directory"
          setPermissionError(String(message))
        }
        return [] as FileNode[]
      }
    },
  )

  const rootRows = createMemo(() => sortNodes(root.latest ?? []))
  const totalCount = createMemo(() => (root.latest ?? []).length)
  const isMac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent)

  const searchBar = (
    <div
      class={sidebar() ? "hy-files-sidebar-tools" : undefined}
      style={sidebar() ? undefined : { display: "contents" }}
    >
      <div
        class={sidebar() ? "hy-files-search" : undefined}
        style={sidebar() ? undefined : { display: "flex", flex: 1, "align-items": "center", gap: "6px" }}
      >
        <IconSearch size={12} strokeWidth={1.5} />
        <input value={filter()} onInput={(e) => onFilter(e.currentTarget.value)} placeholder="filter files…" />
      </div>
      <Show when={sidebar()}>
        <button
          type="button"
          class="hy-files-row"
          style={{ "justify-content": "center", padding: "4px" }}
          onClick={() => setRefreshKey((k) => k + 1)}
          title="refresh"
        >
          <IconRefresh size={11} strokeWidth={1.5} />
        </button>
      </Show>
    </div>
  )

  const treeScroll = (
    <div
      class={sidebar() ? "hy-files-sidebar-scroll thesis-scroll" : "thesis-scroll"}
      style={sidebar() ? undefined : { flex: 1, "overflow-y": "auto", "overflow-x": "hidden", padding: "4px 4px 12px" }}
    >
      <Show
        when={rootRows().length > 0}
        fallback={
          <Show
            when={!root.loading || root.latest}
            fallback={
              <div
                style={{
                  padding: "18px",
                  "font-family": FONT_MONO,
                  "font-size": "11px",
                  color: "var(--color-text-faint)",
                }}
              >
                loading…
              </div>
            }
          >
            <Show
              when={permissionError()}
              fallback={
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    gap: "6px",
                    padding: sidebar() ? "24px 12px" : "40px 20px",
                    "text-align": "center",
                  }}
                >
                  <IconFolder size={sidebar() ? 16 : 20} strokeWidth={1.4} />
                  <div
                    style={{
                      "font-family": FONT_SANS,
                      "font-size": sidebar() ? "11px" : "13px",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    No files here
                  </div>
                </div>
              }
            >
              <div
                style={{
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  gap: "10px",
                  padding: sidebar() ? "20px 10px" : "32px 22px",
                  "text-align": "center",
                }}
              >
                <div
                  style={{
                    "font-family": FONT_SANS,
                    "font-size": sidebar() ? "12px" : "13px",
                    "font-weight": 500,
                    color: "var(--color-text)",
                  }}
                >
                  Can't read this folder
                </div>
                <div
                  style={{
                    "font-family": FONT_SANS,
                    "font-size": "11px",
                    color: "var(--color-text-faint)",
                    "line-height": 1.5,
                    "max-width": "300px",
                  }}
                >
                  <Show when={isMac()} fallback={<>{permissionError()}</>}>
                    Grant <strong>Full Disk Access</strong> to HYscience in System Settings → Privacy &amp; Security,
                    then refresh.
                  </Show>
                </div>
                <Show when={isMac()}>
                  <a
                    href="x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      padding: "6px 12px",
                      "border-radius": "4px",
                      border: "1px solid var(--color-border)",
                      "font-family": FONT_MONO,
                      "font-size": "11px",
                      color: "var(--color-text)",
                    }}
                  >
                    Open System Settings
                  </a>
                </Show>
              </div>
            </Show>
          </Show>
        }
      >
        <div class={sidebar() ? "hy-files-tree" : undefined}>
          <For each={rootRows()}>
            {(node) => (
              <Node
                node={node}
                depth={0}
                directory={directory()}
                expanded={expanded}
                onToggle={(p) => {
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(p)) next.delete(p)
                    else next.add(p)
                    return next
                  })
                }}
                onOpen={props.onOpen}
                filter={query}
                selectedPath={props.selectedPath}
                sidebar={sidebar()}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )

  if (sidebar()) {
    return (
      <div class="hy-files-sidebar" style={{ width: "100%", background: "transparent" }}>
        {searchBar}
        {treeScroll}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-height": 0 }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--color-border)",
          "flex-shrink": 0,
        }}
      >
        {searchBar}
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="refresh"
          style={{
            all: "unset",
            cursor: "pointer",
            color: "var(--color-text-faint)",
            display: "inline-flex",
            padding: "2px",
          }}
        >
          <IconRefresh size={11} strokeWidth={1.5} />
        </button>
        <span
          class="tab-fig"
          style={{
            "font-family": FONT_MONO,
            "font-size": "10px",
            color: "var(--color-text-faint)",
            "letter-spacing": "0.04em",
          }}
        >
          {totalCount()} entries
        </span>
      </div>
      {treeScroll}
    </div>
  )
}

function Node(props: {
  node: FileNode
  depth: number
  directory: string
  expanded: () => Set<string>
  onToggle: (path: string) => void
  onOpen?: (path: string) => void
  filter: () => string
  selectedPath?: () => string | undefined
  sidebar: boolean
}): JSX.Element {
  const sdk = useSDK()
  const isOpen = () => props.expanded().has(props.node.path)
  const e = ext(props.node.name)
  const matches = () => {
    const q = props.filter().toLowerCase().trim()
    if (!q) return true
    return props.node.name.toLowerCase().includes(q) || props.node.path.toLowerCase().includes(q)
  }
  const selected = () => props.node.type === "file" && props.node.path === props.selectedPath?.()
  const color = () =>
    props.node.type === "directory" ? "var(--color-text)" : (EXT_COLOR[e] ?? "var(--color-text-muted)")

  const [children] = createResource(
    () => (isOpen() && props.node.type === "directory" ? props.node.path : null),
    async (path) => {
      if (!path) return null
      try {
        const res: any = await sdk.client.file.list({ directory: props.directory, path } as any)
        const data = res?.data ?? res
        if (Array.isArray(data)) return data as FileNode[]
      } catch {}
      return [] as FileNode[]
    },
  )
  const childRows = createMemo(() => sortNodes(children.latest ?? []))

  const dimmed = () => props.node.ignored || !matches()

  if (props.sidebar && props.node.type === "file") {
    return (
      <Show when={matches()}>
        <button
          type="button"
          class={`hy-files-row${selected() ? " hy-files-row-selected" : ""}`}
          style={{ "padding-left": `${props.depth * 10 + 20}px` }}
          title={props.node.name}
          onClick={() => props.onOpen?.(props.node.path)}
        >
          <ExtBadge name={props.node.name} />
          <span class="hy-files-row-name">{props.node.name}</span>
        </button>
      </Show>
    )
  }

  if (props.sidebar && props.node.type === "directory") {
    return (
      <Show when={matches() || isOpen()}>
        <div class="hy-files-folder-row" style={{ "padding-left": `${props.depth * 10 + 4}px` }}>
          <button type="button" class="hy-files-folder-btn" onClick={() => props.onToggle(props.node.path)}>
            <span class="hy-files-chevron">
              <Show when={isOpen()} fallback={<IconChevronRight size={12} strokeWidth={1.5} />}>
                <IconChevronDown size={12} strokeWidth={1.5} />
              </Show>
            </span>
            <span class={`hy-files-row-folder-name${props.depth === 0 ? "" : ""}`}>{props.node.name}</span>
          </button>
        </div>
        <Show when={isOpen()}>
          <Show when={children.loading && !children.latest}>
            <div
              style={{
                "padding-left": `${(props.depth + 1) * 10 + 20}px`,
                "font-family": FONT_MONO,
                "font-size": "10px",
                color: "var(--color-text-faint)",
                padding: "2px 0",
              }}
            >
              loading…
            </div>
          </Show>
          <For each={childRows()}>
            {(child) => (
              <Node
                node={child}
                depth={props.depth + 1}
                directory={props.directory}
                expanded={props.expanded}
                onToggle={props.onToggle}
                onOpen={props.onOpen}
                filter={props.filter}
                selectedPath={props.selectedPath}
                sidebar={props.sidebar}
              />
            )}
          </For>
        </Show>
      </Show>
    )
  }

  return (
    <Show when={matches() || isOpen()}>
      <button
        onClick={() => {
          if (props.node.type === "directory") props.onToggle(props.node.path)
          else props.onOpen?.(props.node.path)
        }}
        title={props.node.ignored ? `${props.node.name} · ignored by gitignore / HYscience` : props.node.name}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          "align-items": "center",
          gap: "6px",
          width: "100%",
          "box-sizing": "border-box",
          padding: "3px 6px",
          "padding-left": `${props.depth * 12 + 6}px`,
          "border-radius": "4px",
          "font-family": FONT_MONO,
          "font-size": "12px",
          color: props.node.type === "directory" ? "var(--color-text)" : "var(--color-text-muted)",
          "font-style": props.node.ignored ? "italic" : "normal",
          transition: "background 120ms ease",
          opacity: dimmed() ? 0.45 : 1,
          background: selected() ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
        }}
        onMouseEnter={(el) => {
          if (!selected()) el.currentTarget.style.background = "var(--color-accent-subtle)"
        }}
        onMouseLeave={(el) => {
          if (!selected()) el.currentTarget.style.background = "transparent"
        }}
      >
        <Show when={props.node.type === "directory"} fallback={<span style={{ width: "10px" }} />}>
          <span style={{ display: "inline-flex", color: "var(--color-text-faint)" }}>
            <Show when={isOpen()} fallback={<IconChevronRight size={9} strokeWidth={1.5} />}>
              <IconChevronDown size={9} strokeWidth={1.5} />
            </Show>
          </span>
        </Show>
        <span style={{ display: "inline-flex", color: color() }}>
          <Show when={props.node.type === "directory"} fallback={<IconFile size={11} strokeWidth={1.5} />}>
            <IconFolder size={11} strokeWidth={1.5} />
          </Show>
        </span>
        <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
          {props.node.name}
        </span>
      </button>
      <Show when={isOpen()}>
        <Show when={children.loading && !children.latest}>
          <div
            style={{
              "padding-left": `${(props.depth + 1) * 12 + 6}px`,
              "font-family": FONT_MONO,
              "font-size": "10px",
              color: "var(--color-text-faint)",
              padding: "2px 0",
            }}
          >
            loading…
          </div>
        </Show>
        <Show when={childRows().length > 0}>
          <For each={childRows()}>
            {(child) => (
              <Node
                node={child}
                depth={props.depth + 1}
                directory={props.directory}
                expanded={props.expanded}
                onToggle={props.onToggle}
                onOpen={props.onOpen}
                filter={props.filter}
                selectedPath={props.selectedPath}
                sidebar={props.sidebar}
              />
            )}
          </For>
        </Show>
      </Show>
    </Show>
  )
}
