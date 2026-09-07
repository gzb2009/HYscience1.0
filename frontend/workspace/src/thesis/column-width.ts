export const CENTER_MIN = 380

export const SIDEBAR_COL = {
  key: "thesis-sidebar-width-v1",
  min: 200,
  max: 480,
  def: 256,
} as const

export const RIGHT_COL = {
  key: "thesis-right-pane-width-v1",
  min: 256,
  max: 640,
  def: 320,
} as const

export function readWidth(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key))
    if (Number.isFinite(value) && value >= min && value <= max) return value
  } catch {}
  return fallback
}

export function persistWidth(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {}
}

export function clampColumn(value: number, min: number, max: number, reserved: number, viewport = 1280) {
  const room = Math.max(min, viewport - reserved - CENTER_MIN)
  return Math.round(Math.max(min, Math.min(max, room, value)))
}

export function siblingWidth(selector: string, fallback: number) {
  const el = document.querySelector(selector)
  return el instanceof HTMLElement ? Math.round(el.getBoundingClientRect().width) : fallback
}

export function rightReserved() {
  if (window.matchMedia("(max-width: 960px)").matches) return 0
  return siblingWidth(".cs-rightpane-fixed, .cs-rightpane-rail", 32)
}

export function leftReserved() {
  return siblingWidth(".cs-sidebar", 256)
}
