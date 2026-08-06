import { createSignal, createMemo, createEffect, onCleanup, type JSX } from "solid-js"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

// ── Reasoning-effort variant display labels ────────────────────────────
// Matches VARIANT_LABEL in dialog-select-model.tsx; duplicated here so the
// slider stays self-contained.
const VARIANT_LABEL: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
}

interface EffortSliderProps {
  options: string[] // variant keys, e.g. ["minimal","low","medium","high","xhigh","max"]
  value: string // currently selected key
  onPick: (key: string) => void
}

const REDUCE_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

const FILL_COLOR = "var(--color-accent)"
const TRACK_COLOR = "var(--color-border)"
const THUMB_SIZE = 16
const TRACK_HEIGHT = 4
const STOP_SIZE = 6

export function EffortSlider(props: EffortSliderProps): JSX.Element {
  const len = () => props.options.length

  // Index of the currently selected variant.
  const currentIndex = createMemo(() => {
    const idx = props.options.indexOf(props.value)
    return idx >= 0 ? idx : 0
  })

  // Track the drag state so we can disable CSS transitions during drag.
  const [dragging, setDragging] = createSignal(false)

  // Ref to the track element for measurement.
  let trackRef: HTMLDivElement | undefined

  // ── Helpers ──────────────────────────────────────────────────────────
  function labelFor(key: string): string {
    return VARIANT_LABEL[key] ?? key
  }

  function snapIndex(clientX: number): number {
    const el = trackRef
    if (!el) return currentIndex()
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const maxIdx = len() - 1
    return Math.round(ratio * maxIdx)
  }

  function commit(index: number) {
    const key = props.options[index]
    if (key !== undefined) props.onPick(key)
    setDragging(false)
  }

  // ── Pointer event handlers ───────────────────────────────────────────
  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // Jump to the nearest stop immediately.
    const idx = snapIndex(e.clientX)
    if (idx !== currentIndex()) {
      props.onPick(props.options[idx])
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging()) return
    const idx = snapIndex(e.clientX)
    if (idx !== currentIndex()) {
      props.onPick(props.options[idx])
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging()) return
    const idx = snapIndex(e.clientX)
    commit(idx)
  }

  // ── Keyboard handler ─────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    const max = len() - 1
    let next = currentIndex()
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault()
      next = Math.min(max, next + 1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault()
      next = Math.max(0, next - 1)
    } else if (e.key === "Home") {
      e.preventDefault()
      next = 0
    } else if (e.key === "End") {
      e.preventDefault()
      next = max
    } else {
      return
    }
    if (next !== currentIndex()) {
      props.onPick(props.options[next])
    }
  }

  // ── Edge cases ───────────────────────────────────────────────────────
  if (len() === 0) return null as unknown as JSX.Element

  const isSingle = len() === 1

  // Position as a percentage string for the fill and thumb.
  const pct = () => (len() > 1 ? (currentIndex() / (len() - 1)) * 100 : 0)

  return (
    <div
      class="cs-effort-slider"
      role="slider"
      tabindex={isSingle ? undefined : 0}
      aria-valuemin={0}
      aria-valuemax={len() - 1}
      aria-valuenow={currentIndex()}
      aria-valuetext={labelFor(props.options[currentIndex()])}
      aria-label="Reasoning effort"
      onKeyDown={isSingle ? undefined : onKeyDown}
      style={{
        position: "relative",
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "8px 4px",
        "user-select": "none",
        "touch-action": "none",
        outline: "none",
        cursor: isSingle ? "default" : undefined,
      }}
    >
      {/* Track */}
      <div
        ref={trackRef}
        class="cs-effort-slider-track"
        onPointerDown={isSingle ? undefined : onPointerDown}
        onPointerMove={isSingle ? undefined : onPointerMove}
        onPointerUp={isSingle ? undefined : onPointerUp}
        style={{
          position: "relative",
          height: `${THUMB_SIZE}px`,
          display: "flex",
          "align-items": "center",
          cursor: isSingle ? "default" : "pointer",
        }}
      >
        {/* Background bar */}
        <div
          style={{
            position: "absolute",
            left: `${THUMB_SIZE / 2}px`,
            right: `${THUMB_SIZE / 2}px`,
            height: `${TRACK_HEIGHT}px`,
            "border-radius": `${TRACK_HEIGHT / 2}px`,
            background: TRACK_COLOR,
          }}
        />
        {/* Filled bar */}
        <div
          class={`cs-effort-slider-fill${dragging() ? " dragging" : ""}`}
          style={{
            position: "absolute",
            left: `${THUMB_SIZE / 2}px`,
            height: `${TRACK_HEIGHT}px`,
            "border-radius": `${TRACK_HEIGHT / 2}px`,
            background: FILL_COLOR,
            width: isSingle
              ? `calc(100% - ${THUMB_SIZE}px)`
              : `calc(${pct()}% - ${THUMB_SIZE / 2}px + ${THUMB_SIZE / 2}px)`,
            transition: REDUCE_MOTION || dragging() ? "none" : "width 120ms ease",
          }}
        />
        {/* Stop dots + Thumb */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: `${THUMB_SIZE}px`,
            display: "flex",
            "align-items": "center",
          }}
        >
          {/* Stop dots */}
          <div
            class="cs-effort-slider-stops"
            style={{
              position: "absolute",
              left: `${THUMB_SIZE / 2}px`,
              right: `${THUMB_SIZE / 2}px`,
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
            }}
          >
            {props.options.map((key, i) => (
              <div
                class={`cs-effort-slider-stop${i <= currentIndex() ? " active" : ""}`}
                style={{
                  width: `${STOP_SIZE}px`,
                  height: `${STOP_SIZE}px`,
                  "border-radius": "50%",
                  background: i <= currentIndex() ? FILL_COLOR : TRACK_COLOR,
                  transition: REDUCE_MOTION || dragging() ? "none" : "background 120ms ease",
                }}
              />
            ))}
          </div>
          {/* Thumb */}
          <div
            class={`cs-effort-slider-thumb${dragging() ? " dragging" : ""}`}
            style={{
              position: "absolute",
              top: "50%",
              left: isSingle
                ? `${THUMB_SIZE / 2}px`
                : `calc(${pct()}% - ${pct() === 0 ? 0 : pct() === 100 ? THUMB_SIZE : THUMB_SIZE / 2}px + ${THUMB_SIZE / 2}px)`,
              width: `${THUMB_SIZE}px`,
              height: `${THUMB_SIZE}px`,
              "border-radius": "50%",
              background: "var(--color-accent)",
              border: "2px solid var(--color-surface-solid)",
              "box-shadow": "var(--shadow-xs)",
              cursor: isSingle ? "default" : dragging() ? "grabbing" : "grab",
              transform: "translate(-50%, -50%)",
              transition: REDUCE_MOTION || dragging() ? "none" : "left 120ms ease",
              "z-index": 1,
            }}
          />
        </div>
      </div>

      {/* Labels */}
      <div
        class="cs-effort-slider-labels"
        style={{
          display: "flex",
          "justify-content": "space-between",
          padding: `0 ${THUMB_SIZE / 2}px`,
        }}
      >
        {props.options.map((key, i) => {
          const active = i === currentIndex()
          return (
            <span
              class={`cs-effort-slider-label${active ? " active" : ""}`}
              style={{
                "font-family": FONT_SANS,
                "font-size": "10px",
                color: active ? "var(--color-text)" : "var(--color-text-faint)",
                "text-transform": "lowercase",
                "text-align": "center",
                "min-width": 0,
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
                transition: REDUCE_MOTION || dragging() ? "none" : "color 120ms ease",
                cursor: isSingle ? "default" : "pointer",
                "font-weight": active ? 500 : 400,
              }}
              onClick={
                isSingle
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      props.onPick(key)
                    }
              }
            >
              {labelFor(key)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
