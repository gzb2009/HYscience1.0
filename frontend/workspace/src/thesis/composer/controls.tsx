import { type JSX, Show, For } from "solid-js"
import { Portal } from "solid-js/web"
import { FONT_MONO } from "@/styles/tokens"
import { IconChevronDown, IconPaperclip } from "@/thesis/shared/Icon"
import { EffortSlider } from "@/thesis/EffortSlider"
import { centerTabs } from "@/thesis/store/centerTabs"
import { CONTEXT_DIR, type Attachment } from "./model-utils"

// Faint caption preceding a segmented control ("effort" / "speed" / "context").
export const CONTROL_LABEL: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "10px",
  color: "var(--color-text-faint)",
  "text-transform": "lowercase",
}

// Cursor-style segmented control: a quiet row of peers where the selected one is
// marked by a faint tint + hairline border at a consistent weight — never bold.
// Used on the active model row for the effort keys, the fast/normal speed toggle,
// and the context tier.
export function Segmented(props: {
  options: { id: string; label: string }[]
  value: string
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <span style={{ display: "inline-flex", gap: "2px" }} onClick={(e) => e.stopPropagation()}>
      <For each={props.options}>
        {(o) => {
          const on = () => props.value === o.id
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                props.onPick(o.id)
              }}
              style={{
                all: "unset",
                cursor: "pointer",
                "font-family": FONT_MONO,
                "font-size": "11px",
                "font-weight": 400,
                "text-transform": "lowercase",
                color: on() ? "var(--color-text)" : "var(--color-text-muted)",
                background: on() ? "var(--color-accent-subtle)" : "transparent",
                border: on() ? "1px solid var(--color-border)" : "1px solid transparent",
                "border-radius": "4px",
                padding: "1px 7px",
                "line-height": 1.5,
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => {
                if (!on()) e.currentTarget.style.background = "var(--color-bg-elevated)"
              }}
              onMouseLeave={(e) => {
                if (!on()) e.currentTarget.style.background = "transparent"
              }}
            >
              {o.label}
            </button>
          )
        }}
      </For>
    </span>
  )
}

export function AttachmentChip(props: { att: Attachment; onRemove: () => void }): JSX.Element {
  const isImage = () => props.att.mime.startsWith("image/")
  const sizeLabel = () => {
    const s = props.att.size
    if (s < 1024) return `${s}B`
    if (s < 1024 * 1024) return `${(s / 1024).toFixed(0)}KB`
    return `${(s / (1024 * 1024)).toFixed(1)}MB`
  }
  const statusLabel = () => {
    if (props.att.status === "saving") return "saving…"
    if (props.att.status === "failed") return "not saved"
    if (props.att.path) return props.att.path
    return CONTEXT_DIR + "/"
  }
  return (
    <div
      title={`${props.att.filename} · ${sizeLabel()} · ${statusLabel()}`}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "6px",
        padding: "3px 6px 3px 4px",
        "border-radius": "4px",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
        "font-family": FONT_MONO,
        "font-size": "11px",
        color: "var(--color-text)",
        "max-width": "280px",
        opacity: props.att.status === "saving" ? 0.7 : 1,
      }}
    >
      <Show when={isImage()} fallback={<IconPaperclip size={11} strokeWidth={1.5} />}>
        <img
          src={props.att.dataUrl}
          alt={props.att.filename}
          style={{
            width: "18px",
            height: "18px",
            "object-fit": "cover",
            "border-radius": "4px",
          }}
        />
      </Show>
      <span
        style={{
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          flex: 1,
          "min-width": 0,
        }}
      >
        {props.att.filename}
      </span>
      <span style={{ color: "var(--color-text-faint)", "font-size": "10px" }}>
        {props.att.status === "saving" ? "…" : props.att.status === "failed" ? "!" : sizeLabel()}
      </span>
      <button
        type="button"
        title="remove"
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "0 4px",
          color: "var(--color-text-faint)",
          "font-size": "11px",
          "line-height": 1,
        }}
        onMouseEnter={(el) => (el.currentTarget.style.color = "var(--color-error)")}
        onMouseLeave={(el) => (el.currentTarget.style.color = "var(--color-text-faint)")}
      >
        ×
      </button>
    </div>
  )
}

// ── Floating controls (model + effort chips, below the composer) ──
// Rendered inline inside cs-composer-inner, below the input box. Only the
// effort slider popover is portaled.
export function FloatingControls(props: {
  modelOpen: () => boolean
  setModelOpen: (v: boolean) => void
  selectedLabel: () => { name: string; providerID: string } | undefined
  selectedSource: () => { color: string; opacity: number; title: string } | undefined
  modelBtnRef: (el: HTMLButtonElement) => void
  effortOpen: () => boolean
  setEffortOpen: (v: boolean) => void
  variantKeys: () => string[]
  effort: () => string | undefined
  setEffort: (v: string | undefined) => void
  effortBtnRef: (el: HTMLButtonElement) => void
  effortAnchor: () => { left: number; bottom: number; width: number; up: boolean } | undefined
  composeWrapRef: HTMLDivElement | undefined
}): JSX.Element {
  const effortLabel = () => {
    const key = props.effort()
    if (!key) return undefined
    const labels: Record<string, string> = {
      none: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    }
    return labels[key] ?? key
  }

  return (
    <div
      class="cs-floating-controls"
      style={{
        display: "flex",
        "align-items": "flex-end",
        gap: "8px",
        "margin-top": "8px",
        "pointer-events": "none",
      }}
    >
      {/* Effort chip */}
      <Show when={props.variantKeys().length > 0}>
        <button
          ref={props.effortBtnRef}
          type="button"
          class="cs-floating-chip"
          data-action="model-variant-cycle"
          onClick={() => props.setEffortOpen(!props.effortOpen())}
          title={`reasoning effort: ${effortLabel() ?? "none"}`}
        >
          <span
            style={{
              "font-family": FONT_MONO,
              "font-size": "11px",
              "text-transform": "lowercase",
            }}
          >
            {effortLabel() ?? "effort"}
          </span>
          <IconChevronDown size={8} strokeWidth={1.5} />
        </button>
      </Show>

      {/* Model chip */}
      <button
        ref={props.modelBtnRef}
        type="button"
        class="cs-floating-chip"
        onClick={() => props.setModelOpen(!props.modelOpen())}
        title={
          props.selectedLabel()
            ? `${props.selectedLabel()!.name}${props.selectedSource() ? ` — ${props.selectedSource()!.title}` : ""}`
            : "select model"
        }
      >
        <Show when={props.selectedSource()}>
          {(dot) => (
            <span
              style={{
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                "flex-shrink": 0,
                background: dot().color,
                opacity: dot().opacity,
              }}
            />
          )}
        </Show>
        <span
          style={{
            "font-family": FONT_MONO,
            "font-size": "11px",
            "max-width": "180px",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.selectedLabel()?.name ?? "select model"}
        </span>
        <IconChevronDown size={8} strokeWidth={1.5} />
      </button>

      {/* Effort slider popover */}
      <Show when={props.effortOpen() && centerTabs.active() === "chat"}>
        <Portal>
          <div onClick={() => props.setEffortOpen(false)} style={{ position: "fixed", inset: 0, "z-index": 190 }} />
          <Show when={props.effortAnchor()}>
            {(a) => (
              <div
                class="thesis-fade-in cs-effort-popover"
                role="dialog"
                aria-label="Reasoning effort"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  left: `${a().left}px`,
                  bottom: `${a().bottom}px`,
                  width: `${a().width}px`,
                }}
              >
                <span class="cs-effort-popover-label">effort</span>
                <EffortSlider
                  options={props.variantKeys()}
                  value={props.effort() ?? props.variantKeys()[0]}
                  onPick={(key) => {
                    props.setEffort(key)
                    props.setEffortOpen(false)
                  }}
                />
              </div>
            )}
          </Show>
        </Portal>
      </Show>
    </div>
  )
}
