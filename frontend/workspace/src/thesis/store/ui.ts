import { createSignal } from "solid-js"
import {
  RIGHT_COL,
  SIDEBAR_COL,
  clampColumn,
  leftReserved,
  persistWidth,
  readWidth,
  rightReserved,
} from "@/thesis/column-width"

export type RightPaneTab = "now" | "evidence" | "run" | "agents"
export type ImagePreview = { directory: string; path: string; name: string; mime?: string }
export type ReviewSelection = { sessionID: string; messageID: string }

const PANE_OPEN_KEY = "thesis-rightpane-open-v3"

function readPaneOpen(): boolean {
  try {
    const raw = localStorage.getItem(PANE_OPEN_KEY)
    return raw === null ? false : raw !== "0"
  } catch {
    return false
  }
}

const [helpOpen, setHelpOpen] = createSignal(false)
const [paletteOpen, setPaletteOpen] = createSignal(false)
const [rightPaneTab, setRightPaneTab] = createSignal<RightPaneTab>("now")
const [rightPaneOpen, setRightPaneOpenRaw] = createSignal(readPaneOpen())
const [sidebarWidth, setSidebarWidthRaw] = createSignal(
  readWidth(SIDEBAR_COL.key, SIDEBAR_COL.def, SIDEBAR_COL.min, SIDEBAR_COL.max),
)
const [rightPaneWidth, setRightPaneWidthRaw] = createSignal(
  readWidth(RIGHT_COL.key, RIGHT_COL.def, RIGHT_COL.min, RIGHT_COL.max),
)

function applySidebarWidth(value: number, persist: boolean) {
  const next = clampColumn(value, SIDEBAR_COL.min, SIDEBAR_COL.max, rightReserved(), window.innerWidth)
  setSidebarWidthRaw(next)
  if (persist) persistWidth(SIDEBAR_COL.key, next)
}

function applyRightPaneWidth(value: number, persist: boolean) {
  const next = clampColumn(value, RIGHT_COL.min, RIGHT_COL.max, leftReserved(), window.innerWidth)
  setRightPaneWidthRaw(next)
  if (persist) persistWidth(RIGHT_COL.key, next)
}

function resetSidebarWidth() {
  applySidebarWidth(SIDEBAR_COL.def, true)
}

function resetRightPaneWidth() {
  applyRightPaneWidth(RIGHT_COL.def, true)
}
const [imagePreview, setImagePreviewRaw] = createSignal<ImagePreview>()
const [prefill, setPrefill] = createSignal<string | undefined>(undefined)
const [prefillSend, setPrefillSend] = createSignal(false)
const [reviewSelection, setReviewSelection] = createSignal<ReviewSelection>()

function setRightPaneOpen(v: boolean) {
  try {
    localStorage.setItem(PANE_OPEN_KEY, v ? "1" : "0")
  } catch {}
  setRightPaneOpenRaw(v)
}

function setImagePreview(value: ImagePreview | undefined) {
  setImagePreviewRaw(value)
}

function inspectReview(sessionID: string, messageID: string) {
  setReviewSelection({ sessionID, messageID })
  setRightPaneTab("evidence")
  setRightPaneOpen(true)
}

export const uiStore = {
  helpOpen,
  setHelpOpen,
  paletteOpen,
  setPaletteOpen,
  rightPaneTab,
  setRightPaneTab,
  rightPaneOpen,
  setRightPaneOpen,
  sidebarWidth,
  setSidebarWidth: (value: number) => applySidebarWidth(value, false),
  commitSidebarWidth: (value: number) => applySidebarWidth(value, true),
  resetSidebarWidth,
  rightPaneWidth,
  setRightPaneWidth: (value: number) => applyRightPaneWidth(value, false),
  commitRightPaneWidth: (value: number) => applyRightPaneWidth(value, true),
  resetRightPaneWidth,
  imagePreview,
  setImagePreview,
  prefill,
  setPrefill,
  prefillSend,
  setPrefillSend,
  reviewSelection,
  setReviewSelection,
  inspectReview,
}
