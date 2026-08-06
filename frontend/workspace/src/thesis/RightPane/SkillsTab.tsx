import { createSignal, createMemo, For, Show, type JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { uiStore } from "@/thesis/store/ui"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconSearch, IconChevronDown, IconChevronRight, IconArrowRight } from "@/thesis/shared/Icon"

interface SkillRow {
  name: string
  description: string
  location: string
  category?: string
  tags?: string[]
  entry?: boolean
}

function originOf(location: string): string {
  if (location.includes("installed-skills")) return "installed"
  if (location.includes("learned-skills")) return "learned"
  return "core"
}

function originLabel(origin: string): string {
  switch (origin) {
    case "core":
      return "Built-in"
    case "installed":
      return "Installed"
    case "learned":
      return "Learned"
    default:
      return origin
  }
}

export function SkillsTab(): JSX.Element {
  const sync = useSync()
  const [query, setQuery] = createSignal("")

  const groups = createMemo(() => {
    const all = ((sync.data.skill ?? []) as SkillRow[]).filter((s) => s.entry !== false)
    const q = query().trim().toLowerCase()
    const filtered = q
      ? all.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description ?? "").toLowerCase().includes(q) ||
            (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
        )
      : all

    const map: Record<string, SkillRow[]> = {}
    for (const s of filtered) {
      const origin = originOf(s.location)
      if (!map[origin]) map[origin] = []
      map[origin].push(s)
    }
    // Order: core, installed, learned
    const entries = Object.entries(map).sort((a, b) => {
      const order = ["core", "installed", "learned"]
      return order.indexOf(a[0]) - order.indexOf(b[0])
    })
    return entries.map(([origin, skills]) => ({
      origin,
      label: originLabel(origin),
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  })

  const totalCount = () => {
    let c = 0
    for (const g of groups()) c += g.skills.length
    return c
  }

  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})

  return (
    <section style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column" }}>
      <div style={skillsHeader()}>
        <div style={skillsTitle()}>Skills</div>
        <div style={skillsHint()}>{totalCount()} available</div>
      </div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "8px 10px",
          "border-bottom": "1px solid var(--color-border)",
          "flex-shrink": 0,
        }}
      >
        <div style={searchBox()}>
          <IconSearch size={13} strokeWidth={1.5} />
          <input
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search skills..."
            style={searchInput()}
          />
        </div>
      </div>
      <div class="thesis-scroll" style={{ flex: 1, "min-height": 0, overflow: "auto" }}>
        <Show
          when={groups().length > 0}
          fallback={
            <div style={empty()}>
              <p style={emptyText()}>{query() ? "No matching skills" : "No skills loaded"}</p>
            </div>
          }
        >
          <div style={{ padding: "6px 0" }}>
            <For each={groups()}>
              {(group) => (
                <div>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [group.origin]: !prev[group.origin] }))}
                    style={groupHeader()}
                  >
                    <span style={{ display: "inline-flex", width: "12px" }}>
                      <Show when={collapsed()[group.origin]} fallback={<IconChevronDown size={11} strokeWidth={1.6} />}>
                        <IconChevronRight size={11} strokeWidth={1.6} />
                      </Show>
                    </span>
                    <span style={groupLabel()}>{group.label}</span>
                    <span style={groupCount()}>{group.skills.length}</span>
                  </button>
                  <Show when={!collapsed()[group.origin]}>
                    <div style={{ padding: "0 4px" }}>
                      <For each={group.skills}>
                        {(skill) => (
                          <button
                            type="button"
                            style={skillRow()}
                            onClick={() => {
                              uiStore.setPrefill(`/${skill.name} `)
                              uiStore.setPrefillSend(false)
                            }}
                            onDblClick={() => {
                              uiStore.setPrefill(`/${skill.name} `)
                              uiStore.setPrefillSend(true)
                            }}
                            title={`Click to insert /${skill.name}\nDouble-click to insert and send`}
                          >
                            <span style={skillName()}>{skill.name}</span>
                            <span style={skillDesc()}>{skill.description || ""}</span>
                            <span style={{ flex: 1 }} />
                            <span style={skillAction()} title="insert and send">
                              <IconArrowRight size={12} strokeWidth={1.5} />
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div style={skillsFooter()}>Click to insert · Double-click to insert and send</div>
    </section>
  )
}

function skillsHeader(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "flex-start",
    gap: "8px",
    padding: "12px 10px 10px",
    "border-bottom": "1px solid var(--color-border)",
  }
}

function skillsTitle(): JSX.CSSProperties {
  return {
    "font-family": "var(--font-mono)",
    "font-size": "11px",
    "font-weight": 700,
    color: "var(--color-text)",
  }
}

function skillsHint(): JSX.CSSProperties {
  return {
    "font-family": "var(--font-sans)",
    "font-size": "11px",
    color: "var(--color-text-faint)",
  }
}

function searchBox(): JSX.CSSProperties {
  return {
    flex: 1,
    display: "flex",
    "align-items": "center",
    gap: "6px",
    height: "28px",
    padding: "0 8px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid)",
  }
}

function searchInput(): JSX.CSSProperties {
  return {
    all: "unset",
    flex: 1,
    "min-width": 0,
    "font-family": FONT_SANS,
    "font-size": "12px",
    color: "var(--color-text)",
  }
}

function groupHeader(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "align-items": "center",
    gap: "6px",
    width: "100%",
    padding: "7px 10px",
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    "text-transform": "uppercase",
    "letter-spacing": "0.04em",
  }
}

function groupLabel(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "10px",
    "text-transform": "uppercase",
    "letter-spacing": "0.04em",
    color: "var(--color-text-faint)",
  }
}

function groupCount(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
    opacity: 0.6,
  }
}

function skillRow(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    "box-sizing": "border-box",
    display: "flex",
    "align-items": "center",
    gap: "8px",
    width: "100%",
    padding: "6px 10px",
    "border-radius": "4px",
    transition: "background 120ms ease",
  }
}

function skillName(): JSX.CSSProperties {
  return {
    "font-family": FONT_MONO,
    "font-size": "11px",
    color: "var(--color-text)",
    "flex-shrink": 0,
  }
}

function skillDesc(): JSX.CSSProperties {
  return {
    "font-family": FONT_SANS,
    "font-size": "11px",
    color: "var(--color-text-muted)",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    "min-width": 0,
  }
}

function skillAction(): JSX.CSSProperties {
  return {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "20px",
    height: "20px",
    "border-radius": "3px",
    color: "var(--color-text-faint)",
    "flex-shrink": 0,
    opacity: 0,
  }
}

function empty(): JSX.CSSProperties {
  return {
    display: "grid",
    "place-items": "center",
    padding: "32px 16px",
  }
}

function emptyText(): JSX.CSSProperties {
  return {
    margin: 0,
    "font-family": FONT_SANS,
    "font-size": "12px",
    color: "var(--color-text-faint)",
  }
}

function skillsFooter(): JSX.CSSProperties {
  return {
    padding: "7px 10px",
    "border-top": "1px solid var(--color-border)",
    "font-family": FONT_MONO,
    "font-size": "10px",
    color: "var(--color-text-faint)",
  }
}
