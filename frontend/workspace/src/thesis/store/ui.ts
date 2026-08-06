import { createSignal } from "solid-js"

export type RightPaneTab = "terminal" | "review"
export type ImagePreview = { directory: string; path: string; name: string; mime?: string }
export type ReviewSelection = { sessionID: string; messageID: string }

const PANE_OPEN_KEY = "thesis-rightpane-open-v3"
const HIDDEN_TABS_KEY = "thesis-rightpane-hidden-tabs-v2"
const PANE_PINNED_KEY = "thesis-rightpane-pinned-v1"

function readPaneOpen(): boolean {
  try {
    const raw = localStorage.getItem(PANE_OPEN_KEY)
    return raw === null ? false : raw !== "0"
  } catch {
    return false
  }
}

function readPanePinned(): boolean {
  try {
    const raw = localStorage.getItem(PANE_PINNED_KEY)
    return raw === null ? true : raw !== "0"
  } catch {
    return true
  }
}

function readHiddenTabs(): RightPaneTab[] {
  try {
    const raw = localStorage.getItem(HIDDEN_TABS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const [helpOpen, setHelpOpen] = createSignal(false)
const [paletteOpen, setPaletteOpen] = createSignal(false)
const [rightPaneTab, setRightPaneTab] = createSignal<RightPaneTab>("terminal")
const [rightPaneOpen, setRightPaneOpenRaw] = createSignal(readPaneOpen())
const [rightPanePinned, setRightPanePinnedRaw] = createSignal(readPanePinned())
const [hiddenTabs, setHiddenTabs] = createSignal<RightPaneTab[]>(readHiddenTabs())
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

function setRightPanePinned(v: boolean) {
  try {
    localStorage.setItem(PANE_PINNED_KEY, v ? "1" : "0")
  } catch {}
  setRightPanePinnedRaw(v)
}

function setImagePreview(value: ImagePreview | undefined) {
  setImagePreviewRaw(value)
}

function toggleTabHidden(tab: RightPaneTab) {
  setHiddenTabs((prev) => {
    const next = prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]
    try {
      localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(next))
    } catch {}
    return next
  })
}

function isTabHidden(tab: RightPaneTab) {
  return hiddenTabs().includes(tab)
}

function inspectReview(sessionID: string, messageID: string) {
  setReviewSelection({ sessionID, messageID })
  setRightPaneTab("review")
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
  rightPanePinned,
  setRightPanePinned,
  imagePreview,
  setImagePreview,
  hiddenTabs,
  toggleTabHidden,
  isTabHidden,
  prefill,
  setPrefill,
  prefillSend,
  setPrefillSend,
  reviewSelection,
  setReviewSelection,
  inspectReview,
}
