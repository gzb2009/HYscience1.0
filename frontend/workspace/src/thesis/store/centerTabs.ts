import { createSignal } from "solid-js"

/**
 * Center-pane tab model. The center area is a tab strip:
 *   - "chat"  — session / work-item view (closable tab)
 *   - "files" — the host file explorer
 *   - one tab per opened document (a real file, rendered inline)
 *
 * Opening a file from the explorer spawns (or focuses) a document tab; the
 * document is addressed by its host directory + relative path so the same
 * renderer path (FileView → sdk.client.file.read) works for any host file.
 */
export interface DocTab {
  id: string
  directory: string
  path: string
  name: string
}

export type CenterTab = "chat" | "files" | (string & {})

const docId = (directory: string, path: string) => `doc:${directory}::${path}`

export type ArtifactsScope = "recent" | "task"

const [active, setActive] = createSignal<CenterTab>("chat")
const [docs, setDocs] = createSignal<DocTab[]>([])
const [chatOpen, setChatOpen] = createSignal(true)
const [filesOpen, setFilesOpen] = createSignal(false)
const [artifactsScope, setArtifactsScope] = createSignal<ArtifactsScope>("recent")

function focusAfterClose(closed: CenterTab) {
  if (chatOpen() && closed !== "chat") {
    setActive("chat")
    return
  }
  if (filesOpen() && closed !== "files") {
    setActive("files")
    return
  }
  const list = docs()
  const doc = list[list.length - 1]
  if (doc && doc.id !== closed) {
    setActive(doc.id)
    return
  }
  if (chatOpen()) setActive("chat")
  else if (filesOpen()) setActive("files")
  else if (list.length) setActive(list[0].id)
}

function openFile(directory: string, path: string) {
  const name = path.split("/").pop() || path
  const id = docId(directory, path)
  setDocs((prev) => (prev.some((d) => d.id === id) ? prev : [...prev, { id, directory, path, name }]))
  setActive(id)
}

function closeDoc(id: string) {
  const list = docs()
  const idx = list.findIndex((d) => d.id === id)
  const next = list.filter((d) => d.id !== id)
  setDocs(next)
  if (active() === id) {
    const neighbour = next[idx - 1] ?? next[idx] ?? next[next.length - 1]
    if (neighbour) setActive(neighbour.id)
    else focusAfterClose(id)
  }
}

function closeChat() {
  setChatOpen(false)
  if (active() === "chat") focusAfterClose("chat")
}

function closeFiles() {
  setFilesOpen(false)
  if (active() === "files") focusAfterClose("files")
}

let scopedProjectKey = ""

function resetForProject(projectKey: string) {
  if (scopedProjectKey === projectKey) return
  scopedProjectKey = projectKey
  setActive("chat")
  setChatOpen(true)
  setFilesOpen(false)
  setDocs([])
}

export const centerTabs = {
  active,
  setActive,
  docs,
  chatOpen,
  filesOpen,
  artifactsScope,
  setArtifactsScope,
  openFile,
  closeDoc,
  closeChat,
  closeFiles,
  resetForProject,
  tabStripVisible: () => chatOpen() || filesOpen() || docs().length > 0,
  showFiles: (opts?: { scope?: ArtifactsScope }) => {
    setFilesOpen(true)
    setActive("files")
    setArtifactsScope(opts?.scope ?? "recent")
  },
  showChat: () => {
    setChatOpen(true)
    setActive("chat")
  },
}
