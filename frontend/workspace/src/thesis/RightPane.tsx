import { createMemo, For, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { uiStore, type RightPaneTab } from "@/thesis/store/ui"
import { ColumnHandle } from "@/thesis/ColumnHandle"
import { RIGHT_COL, leftReserved } from "@/thesis/column-width"
import { NowTab } from "@/thesis/RightPane/NowTab"
import { EvidenceTab } from "@/thesis/RightPane/EvidenceTab"
import { RunTab } from "@/thesis/RightPane/RunTab"
import { AgentsTab } from "@/thesis/RightPane/AgentsTab"
import {
  IconActivity,
  IconBookOpen,
  IconChevronLeft,
  IconChevronRight,
  IconGitBranch,
  IconTerminal,
} from "@/thesis/shared/Icon"

const RAIL_WIDTH = 32

export function RightPane(props: { sessionID?: string }): JSX.Element {
  const params = useParams()
  const sync = useSync()
  const language = useLanguage()
  const sessionID = () => props.sessionID ?? params.id
  const hasAgents = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    const nested = (parentID: string | undefined): boolean => {
      if (!parentID) return false
      if (parentID === id) return true
      return nested(sync.data.session.find((row) => row.id === parentID)?.parentID)
    }
    return sync.data.session.some((item) => nested(item.parentID))
  })

  const tabs = createMemo(() => {
    const list: { id: RightPaneTab; label: string; icon: JSX.Element }[] = [
      { id: "now", label: language.t("rightpane.tab.now"), icon: <IconActivity size={13} strokeWidth={1.6} /> },
      {
        id: "evidence",
        label: language.t("rightpane.tab.evidence"),
        icon: <IconBookOpen size={13} strokeWidth={1.6} />,
      },
      { id: "run", label: language.t("rightpane.tab.run"), icon: <IconTerminal size={13} strokeWidth={1.6} /> },
    ]
    if (hasAgents()) {
      list.push({
        id: "agents",
        label: language.t("rightpane.tab.agents"),
        icon: <IconGitBranch size={13} strokeWidth={1.6} />,
      })
    }
    return list
  })

  function open(tab: RightPaneTab) {
    uiStore.setRightPaneTab(tab)
    uiStore.setRightPaneOpen(true)
  }

  return (
    <Show
      when={uiStore.rightPaneOpen()}
      fallback={
        <aside class="cs-rightpane-rail" aria-label={language.t("rightpane.label")} style={rail()}>
          <button
            type="button"
            title={language.t("rightpane.expand")}
            aria-label={language.t("rightpane.expand")}
            onClick={() => uiStore.setRightPaneOpen(true)}
            style={railButton()}
          >
            <IconChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <For each={tabs()}>
            {(tab) => (
              <button
                type="button"
                title={tab.label}
                aria-label={tab.label}
                onClick={() => open(tab.id)}
                style={railButton()}
                data-active={uiStore.rightPaneTab() === tab.id ? "true" : undefined}
              >
                {tab.icon}
              </button>
            )}
          </For>
        </aside>
      }
    >
      <aside
        class="cs-rightpane-fixed"
        aria-label={language.t("rightpane.label")}
        style={pane(uiStore.rightPaneWidth())}
      >
        <ColumnHandle
          edge="start"
          value={uiStore.rightPaneWidth()}
          min={RIGHT_COL.min}
          max={RIGHT_COL.max}
          reserved={leftReserved}
          label={language.t("layout.resizeInspector")}
          hint={language.t("layout.resizeHint")}
          onInput={uiStore.setRightPaneWidth}
          onCommit={uiStore.commitRightPaneWidth}
          onReset={uiStore.resetRightPaneWidth}
        />
        <header style={header()}>
          <nav class="cs-rightpane-tabs" aria-label={language.t("rightpane.label")}>
            <For each={tabs()}>
              {(tab) => (
                <button
                  type="button"
                  data-active={uiStore.rightPaneTab() === tab.id ? "true" : undefined}
                  onClick={() => uiStore.setRightPaneTab(tab.id)}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              )}
            </For>
          </nav>
          <button
            type="button"
            title={language.t("rightpane.collapse")}
            aria-label={language.t("rightpane.collapse")}
            onClick={() => uiStore.setRightPaneOpen(false)}
            style={railButton()}
          >
            <IconChevronRight size={14} strokeWidth={1.5} />
          </button>
        </header>
        <div style={{ flex: 1, "min-height": 0, display: "flex" }}>
          <Show when={uiStore.rightPaneTab() === "now"}>
            <NowTab />
          </Show>
          <Show when={uiStore.rightPaneTab() === "evidence"}>
            <EvidenceTab sessionID={sessionID()} />
          </Show>
          <Show when={uiStore.rightPaneTab() === "run"}>
            <RunTab />
          </Show>
          <Show when={uiStore.rightPaneTab() === "agents" && hasAgents()}>
            <AgentsTab />
          </Show>
        </div>
      </aside>
    </Show>
  )
}

function pane(width: number): JSX.CSSProperties {
  return {
    flex: `0 0 ${width}px`,
    width: `${width}px`,
    display: "flex",
    "flex-direction": "column",
    position: "relative",
    "min-width": `${RIGHT_COL.min}px`,
    "border-left": "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
  }
}

function rail(): JSX.CSSProperties {
  return {
    flex: `0 0 ${RAIL_WIDTH}px`,
    width: `${RAIL_WIDTH}px`,
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    gap: "4px",
    padding: "10px 0",
    "border-left": "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
  }
}

function header(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "8px",
    padding: "8px 12px",
  }
}

function railButton(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    display: "inline-grid",
    "place-items": "center",
    width: "26px",
    height: "26px",
    "border-radius": "4px",
    color: "var(--color-text-faint)",
  }
}
