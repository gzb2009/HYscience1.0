import { splitProps, type ComponentProps } from "solid-js"

export type AgentIconProps = Omit<ComponentProps<"svg">, "width" | "height"> & {
  animated?: boolean
  size?: number
}

export function AgentIcon(props: AgentIconProps) {
  const [local, rest] = splitProps(props, ["animated", "size", "class", "classList", "style"])
  const size = () => local.size ?? 24
  return (
    <svg
      {...rest}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      data-component="agent-icon"
      data-animated={local.animated ? "" : undefined}
      class={local.class}
      classList={local.classList}
      style={local.style}
      aria-hidden="true"
    >
      <g data-slot="agent-icon-ring">
        <circle cx="12" cy="12" r="10" fill="var(--agent-icon-paper)" stroke="var(--agent-icon-ink)" stroke-width="0.8" />
        <path
          d="M12 2A10 10 0 0 0 12 22C15 22 15 18.6 12 17C10 16.1 10 7.9 12 7C15 5.4 15 2 12 2Z"
          fill="var(--agent-icon-ink)"
        />
      </g>
      <circle cx="12" cy="12" r="7" fill="var(--agent-icon-paper)" stroke="var(--agent-icon-ink)" stroke-width="0.8" />
      <path
        data-slot="agent-icon-code"
        d="m10 9-3.2 3 3.2 3M14 9l3.2 3-3.2 3M13.1 8.2l-2.2 7.6"
        stroke="var(--agent-icon-ink)"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function AgentStreamIcon(props: AgentIconProps) {
  return <AgentIcon {...props} animated={true} />
}
