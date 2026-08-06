import { createMemo, For, Show, type JSX } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

interface AgentNode {
  id: string
  title: string
  agentName: string
  agentColor: string | undefined
  status: "busy" | "retry" | "idle"
  statusText: string
  toolSummary: string
  toolCount: number
  steps: number
  cost?: number
  children: AgentNode[]
}

function agentLabel(name: string): string {
  if (!name) return "task"
  return name
}

function statusDot(status: string): JSX.CSSProperties {
  const base: JSX.CSSProperties = {
    width: "8px",
    height: "8px",
    "border-radius": "50%",
    "flex-shrink": 0,
  }
  switch (status) {
    case "busy":
      return { ...base, background: "#f59e0b", animation: "thesis-pulse 1.6s ease-in-out infinite" }
    case "retry":
      return { ...base, background: "#ef4444" }
    default:
      return { ...base, background: "#22c55e" }
  }
}

export function AgentsTab(): JSX.Element {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()

  const agentDefs = createMemo(() => {
    const map: Record<string, { color?: string }> = {}
    for (const a of sync.data.agent ?? []) {
      const name = a.name ?? ""
      map[name] = { color: a.color }
    }
    return map
  })

  const activeSessionID = () => params.id

  const childSessions = createMemo(() =>
    sync.data.session.filter((s) => {
      if (!s.parentID) return false
      // Include direct children and nested children so the whole tree is visible
      let parent = s.parentID
      while (parent) {
        if (parent === activeSessionID()) return true
        const grandparent = sync.data.session.find((x) => x.id === parent)
        parent = grandparent?.parentID ?? ""
      }
      return false
    }),
  )

  const tree = createMemo((): AgentNode[] => {
    const children = childSessions()
    const byParent: Record<string, typeof children> = {}
    for (const c of children) {
      const pid = c.parentID ?? "__orphan__"
      if (!byParent[pid]) byParent[pid] = []
      byParent[pid].push(c)
    }

    function build(parentID: string): AgentNode[] {
      const kids = byParent[parentID] ?? []
      if (kids.length === 0) return []
      return kids.map((s): AgentNode => {
        const messages = sync.data.message[s.id] ?? []
        const firstUser = messages.find((m) => m.role === "user") as any
        const agent = firstUser?.agent ?? ""
        const def = agentDefs()[agent]
        const status = sync.data.session_status[s.id]
        const busy = status?.type === "busy"
        const retrying = status?.type === "retry"

        let statusText = "idle"
        if (busy) statusText = "working"
        else if (retrying) statusText = `retry ${(status as any).attempt ?? ""}`

        let steps = 0
        let cost: number | undefined
        for (const msg of messages) {
          if (msg.role !== "assistant") continue
          const a = msg as any
          if (a.cost != null) cost = (cost ?? 0) + a.cost
        }
        // Count step-finish parts
        const parts = sync.data.part
        for (const msg of messages) {
          const msgParts = parts[msg.id] ?? []
          steps += msgParts.filter((p: any) => p.type === "step-finish").length
        }

        // Extract tool activity from the child session's own messages
        let toolSummary = ""
        let toolCount = 0
        for (const msg of messages) {
          const msgParts = parts[msg.id] ?? []
          for (const p of msgParts) {
            if ((p as any).type !== "tool") continue
            toolCount++
            const state = (p as any).state
            if (state?.status === "running" && state?.title) {
              toolSummary = state.title
            } else if (state?.status === "completed" && state?.title && !toolSummary) {
              toolSummary = state.title
            }
          }
        }

        return {
          id: s.id,
          title: s.title ?? agentLabel(agent),
          agentName: agent || "task",
          agentColor: def?.color,
          status: busy ? "busy" : retrying ? "retry" : "idle",
          statusText,
          toolSummary,
          toolCount,
          steps,
          cost,
          children: build(s.id),
        }
      })
    }

    return build(activeSessionID() ?? "")
  })

  const totalChildren = () => childSessions().length
  const busyCount = () => tree().filter((n) => n.status === "busy").length

  return (
    <section style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column" }}>
      <div style={agentsHeader()}>
        <div>
          <div style={agentsTitle()}>Agents</div>
          <div style={agentsHint()}>
            {totalChildren() > 0
              ? `${totalChildren()} sub-agent${totalChildren() === 1 ? "" : "s"} · ${busyCount()} active`
              : "Sub-agents spawned during research appear here"}
          </div>
        </div>
      </div>
      <div class="thesis-scroll" style={{ flex: 1, "min-height": 0, overflow: "auto" }}>
        <Show
          when={tree().length > 0}
          fallback={
            <div style={empty()}>
              <div style={emptyTitle()}>No sub-agents yet</div>
              <p style={emptyHint()}>
                When the research agent delegates work to sub-agents (literature review, critique, exploration, etc.),
                they will appear here with live status.
              </p>
            </div>
          }
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "2px", padding: "8px" }}>
            <For each={tree()}>
              {(node) => (
                <AgentNodeRow node={node} depth={0} onNavigate={(id) => navigate(`/${params.dir}/session/${id}`)} />
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

function AgentNodeRow(props: { node: AgentNode; depth: number; onNavigate: (id: string) => void }): JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={() => props.onNavigate(props.node.id)}
        style={agentRow(props.depth)}
        title={`Click to open session: ${props.node.title}`}
      >
        <span style={statusDot(props.node.status)} />
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            "border-radius": "2px",
            "flex-shrink": 0,
            background: props.node.agentColor ?? "var(--color-text-faint)",
          }}
        />
        <span
          style={{ flex: 1, "min-width": 0, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
        >
          <span style={agentName()}>{props.node.title}</span>
          <span style={agentType()}>{agentLabel(props.node.agentName)}</span>
        </span>
        <span style={agentMeta()}>
          <Show when={props.node.toolSummary}>
            <span style={{ color: "var(--color-accent)", "font-size": "10px" }}>{props.node.toolSummary}</span>
          </Show>
          <Show when={!props.node.toolSummary && props.node.statusText}>
            <span>{props.node.statusText}</span>
          </Show>
          <Show when={props.node.toolCount > 0}>
            <span>{props.node.toolCount}t</span>
          </Show>
          <Show when={props.node.steps > 0}>
            <span>{props.node.steps}s</span>
          </Show>
        </span>
      </button>
      <For each={props.node.children}>
        {(child) => <AgentNodeRow node={child} depth={props.depth + 1} onNavigate={props.onNavigate} />}
      </For>
    </>
  )
}

function agentsHeader(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "flex-start",
    gap: "8px",
    padding: "12px 10px 10px",
    "border-bottom": "1px solid var(--color-border)",
  }
}

function agentsTitle(): JSX.CSSProperties {
  return {
    "font-family": "var(--font-mono)",
    "font-size": "11px",
    "font-weight": 700,
    color: "var(--color-text)",
  }
}

function agentsHint(): JSX.CSSProperties {
  return {
    "margin-top": "3px",
    "font-family": "var(--font-sans)",
    "font-size": "11px",
    "line-height": 1.4,
    color: "var(--color-text-faint)",
  }
}

function agentRow(depth: number): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "align-items": "center",
    gap: "7px",
    width: "100%",
    padding: `7px 10px 7px ${10 + depth * 16}px`,
    "border-radius": "4px",
    "font-size": "12px",
    transition: "background 120ms ease",
  }
}

function agentName(): JSX.CSSProperties {
  return {
    "font-family": FONT_SANS,
    "font-size": "12px",
    color: "var(--color-text)",
    "font-weight": 500,
  }
}

function agentType(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    "margin-left": "6px",
  }
}

function agentMeta(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    "flex-shrink": 0,
    display: "flex",
    "align-items": "center",
    gap: "6px",
  }
}

function empty(): JSX.CSSProperties {
  return {
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    gap: "6px",
    padding: "32px 16px",
    "text-align": "center",
  }
}

function emptyTitle(): JSX.CSSProperties {
  return {
    "font-family": FONT_SANS,
    "font-size": "12px",
    "font-weight": 600,
    color: "var(--color-text-muted)",
  }
}

function emptyHint(): JSX.CSSProperties {
  return {
    margin: 0,
    "font-family": FONT_SANS,
    "font-size": "11px",
    "line-height": 1.5,
    color: "var(--color-text-faint)",
    "max-width": "240px",
  }
}
