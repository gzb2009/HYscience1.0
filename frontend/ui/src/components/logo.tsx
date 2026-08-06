import { AgentIcon } from "./agent-icon"

export const Mark = (props: { class?: string; animated?: boolean }) => {
  return <AgentIcon data-component="logo-mark" class={props.class} size={16} animated={props.animated} />
}

export const Splash = (props: { class?: string; animated?: boolean }) => {
  return <AgentIcon data-component="logo-splash" class={props.class} size={80} animated={props.animated} />
}

export const Logo = (props: { class?: string; animated?: boolean }) => {
  return (
    <span
      classList={{ [props.class ?? ""]: !!props.class }}
      style={{ display: "inline-flex", "align-items": "center", gap: "10px" }}
    >
      <AgentIcon size={28} animated={props.animated} />
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 24" fill="none" aria-hidden="true">
        <text
          x="0"
          y="18"
          fill="var(--text-strong, currentColor)"
          style="font-family: ui-serif, Georgia, serif; font-size: 18px; font-weight: 600; letter-spacing: -0.02em;"
        >
          HYscience
        </text>
      </svg>
    </span>
  )
}
