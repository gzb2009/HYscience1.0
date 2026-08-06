import { createSignal, Show, type JSX } from "solid-js"
import { uiStore } from "@/thesis/store/ui"
import { TerminalTab } from "@/thesis/RightPane/TerminalTab"
import { IconChevronLeft, IconChevronRight, IconTerminal } from "@/thesis/shared/Icon"

const WIDTH_KEY = "thesis-right-pane-width-v1"
const MIN_WIDTH = 256
const MAX_WIDTH = 480
const RAIL_WIDTH = 32

function savedWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH) return value
  } catch {}
  return 320
}

export function RightPane(props: { sessionID?: string }): JSX.Element {
  const [width, setWidth] = createSignal(savedWidth())
  let drag: { x: number; width: number } | undefined

  function pointerDown(event: PointerEvent) {
    drag = { x: event.clientX, width: width() }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    document.body.style.cursor = "ew-resize"
  }

  function pointerMove(event: PointerEvent) {
    if (!drag) return
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.width + drag.x - event.clientX)))
  }

  function pointerUp(event: PointerEvent) {
    if (!drag) return
    drag = undefined
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    document.body.style.cursor = ""
    try {
      localStorage.setItem(WIDTH_KEY, String(width()))
    } catch {}
  }

  return (
    <Show
      when={uiStore.rightPaneOpen()}
      fallback={
        <aside class="cs-rightpane-rail" aria-label="Terminal" style={rail()}>
          <button
            type="button"
            title="展开终端"
            aria-label="展开终端"
            onClick={() => uiStore.setRightPaneOpen(true)}
            style={railButton()}
          >
            <IconChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            title="终端"
            aria-label="打开终端"
            onClick={() => uiStore.setRightPaneOpen(true)}
            style={railButton()}
          >
            <IconTerminal size={15} strokeWidth={1.5} />
          </button>
        </aside>
      }
    >
      <aside class="cs-rightpane-fixed" aria-label="Terminal" style={pane(width())}>
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          style={resizeHandle()}
        />
        <header style={header()}>
          <span style={title()}>
            <IconTerminal size={13} strokeWidth={1.6} />
            终端
          </span>
          <button
            type="button"
            title="收起"
            aria-label="收起终端"
            onClick={() => uiStore.setRightPaneOpen(false)}
            style={railButton()}
          >
            <IconChevronRight size={14} strokeWidth={1.5} />
          </button>
        </header>
        <div style={{ flex: 1, "min-height": 0, display: "flex" }}>
          <TerminalTab />
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
    "min-width": `${MIN_WIDTH}px`,
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

function resizeHandle(): JSX.CSSProperties {
  return {
    position: "absolute",
    left: "0",
    top: 0,
    width: "4px",
    height: "100%",
    cursor: "ew-resize",
    "z-index": 2,
    "touch-action": "none",
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

function title(): JSX.CSSProperties {
  return {
    display: "inline-flex",
    "align-items": "center",
    gap: "6px",
    "font-family": "var(--font-sans)",
    "font-size": "11px",
    "font-weight": 600,
    color: "var(--color-text)",
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
