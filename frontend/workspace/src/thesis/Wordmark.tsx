import { type JSX, Show } from "solid-js"
import { AgentIcon } from "@/thesis/shared/AgentIcon"
import { FONT_SERIF } from "@/styles/tokens"

interface WordmarkProps {
  size?: "sm" | "md" | "lg"
  /** Label only (no logo) for tight spaces. */
  textOnly?: boolean
  /** Small Beta label under the wordmark (Claude Science–style header). */
  showBeta?: boolean
  onClick?: () => void
}

export function Wordmark(props: WordmarkProps): JSX.Element {
  const size = () => props.size ?? "md"
  const px = () =>
    size() === "lg" ? { logo: 30, text: 28 } : size() === "sm" ? { logo: 22, text: 18 } : { logo: 26, text: 22 }
  return (
    <button
      onClick={props.onClick}
      class="thesis-wordmark"
      style={{
        all: "unset",
        cursor: props.onClick ? "pointer" : "default",
        display: "inline-flex",
        "align-items": props.showBeta ? "flex-start" : "center",
        gap: size() === "sm" ? "8px" : "10px",
      }}
    >
      <Show when={!props.textOnly}>
        <AgentIcon
          size={px().logo}
          style={{
            "--agent-icon-ink": "var(--color-text)",
            "--agent-icon-paper": "var(--color-surface-solid, var(--color-bg))",
            "flex-shrink": 0,
          }}
        />
      </Show>
      <span
        style={{
          display: "inline-flex",
          "flex-direction": "column",
          "align-items": "flex-start",
          gap: props.showBeta ? "1px" : "0",
        }}
      >
        <span
          style={{
            "font-family": FONT_SERIF,
            "font-size": `${px().text}px`,
            "font-weight": 600,
            "letter-spacing": "-0.02em",
            color: "var(--color-text)",
            "white-space": "nowrap",
            "line-height": 1.1,
          }}
        >
          HYscience
        </span>
        <Show when={props.showBeta}>
          <span class="cs-beta">Beta</span>
        </Show>
      </span>
    </button>
  )
}
