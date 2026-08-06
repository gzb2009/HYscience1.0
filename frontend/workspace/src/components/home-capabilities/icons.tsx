import type { JSX } from "solid-js"

interface SvgProps {
  size?: number
  class?: string
}

const base = (props: SvgProps) => ({
  width: props.size ?? 16,
  height: props.size ?? 16,
  class: props.class,
  "aria-hidden": true as const,
})

export function IconSkillsStack(props: SvgProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...base(props)}>
      <rect x="5" y="4" width="11" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5" />
      <rect x="8" y="7" width="11" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="var(--color-surface-solid, #fff)" />
    </svg>
  )
}

export function IconComputeChip(props: SvgProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...base(props)}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M10 4v2M14 4v2M10 18v2M14 18v2M4 10h2M4 14h2M18 10h2M18 14h2"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function SkillCardArt(props: SvgProps): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" fill="none" width={props.size ?? 28} height={props.size ?? 28} class={props.class} aria-hidden="true">
      <rect x="6" y="5" width="14" height="18" rx="2" stroke="var(--color-text-faint)" stroke-width="1.3" />
      <rect x="10" y="9" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.3" fill="var(--color-surface-solid, #fff)" />
      <path d="M13 14h8M13 17h8M13 20h5" stroke="var(--color-text-muted)" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  )
}

export function ComputeGraphLocal(): JSX.Element {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none" aria-hidden="true">
      <rect x="14" y="12" width="36" height="24" rx="2" stroke="currentColor" stroke-width="1.4" />
      <rect x="20" y="18" width="24" height="12" rx="1" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1" />
      <path d="M24 8v4M32 8v4M40 8v4M24 36v4M32 36v4M40 36v4" stroke="var(--color-text-muted)" stroke-width="1.2" stroke-linecap="round" />
      <circle cx="8" cy="26" r="2.5" fill="currentColor" />
      <circle cx="56" cy="26" r="2.5" fill="var(--color-text-faint)" />
      <path d="M10.5 26h3.5M50 26h3.5" stroke="var(--color-text-muted)" stroke-width="1" stroke-dasharray="2 2" />
    </svg>
  )
}

export function ComputeGraphSsh(): JSX.Element {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none" aria-hidden="true">
      <rect x="4" y="16" width="14" height="20" rx="1.5" stroke="currentColor" stroke-width="1.3" />
      <rect x="22" y="10" width="20" height="32" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity="0.06" />
      <rect x="26" y="16" width="12" height="7" rx="1" fill="currentColor" fill-opacity="0.2" />
      <rect x="26" y="27" width="12" height="7" rx="1" fill="currentColor" fill-opacity="0.1" />
      <rect x="46" y="16" width="14" height="20" rx="1.5" stroke="currentColor" stroke-width="1.3" />
      <path d="M18 26h4M42 26h4" stroke="var(--color-text-muted)" stroke-width="1" stroke-linecap="round" />
    </svg>
  )
}

export function ComputeGraphCloud(): JSX.Element {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none" aria-hidden="true">
      <path
        d="M18 32c0-6.6 5.4-12 12-12 2.2 0 4.2.6 6 1.6 1.5-2.8 4.5-4.6 7.8-4.6 4.8 0 8.7 3.9 8.7 8.7 0 .5 0 1-.1 1.5"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
      <ellipse cx="32" cy="30" rx="20" ry="10" stroke="currentColor" stroke-width="1.4" fill="currentColor" fill-opacity="0.05" />
      <circle cx="24" cy="28" r="3" fill="currentColor" fill-opacity="0.35" />
      <circle cx="32" cy="26" r="3.5" fill="currentColor" />
      <circle cx="40" cy="28" r="3" fill="currentColor" fill-opacity="0.35" />
    </svg>
  )
}

export const computeGraphs = {
  local: ComputeGraphLocal,
  ssh: ComputeGraphSsh,
  cloud: ComputeGraphCloud,
} as const

export type ComputeKind = keyof typeof computeGraphs
