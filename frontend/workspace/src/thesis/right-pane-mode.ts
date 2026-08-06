export const MIN_CHAT_WIDTH = 640
export const RAIL_WIDTH = 32

export type PaneMode = "fixed"

/** Right pane is always an inset column in the session flex layout (no overlay drawer). */
export function rightPaneMode(_available: number, _width: number, _pinned: boolean, _open: boolean): PaneMode {
  return "fixed"
}
