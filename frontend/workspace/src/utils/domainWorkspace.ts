import { isDomainId, type DomainId } from "@/domain/registry"
import { ensureDirectory, projectRoot, RESULT_DIR, UPLOAD_DIR, writeTextFile } from "@/utils/projectResult"

export const WORKSPACE_MARKER = ".hyscience/workspace.json"

type ProjectRef = {
  worktree?: string
  research?: { domain?: string; subdomain?: string }
}

function normalize(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function basename(value: string) {
  const parts = normalize(value).split("/").filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

function dirname(value: string) {
  const normalized = normalize(value)
  const index = normalized.lastIndexOf("/")
  if (index <= 0) return normalized.startsWith("/") ? "/" : "."
  return normalized.slice(0, index)
}

function samePath(a: string, b: string) {
  return normalize(a) === normalize(b)
}

function findByWorktree(projects: ProjectRef[], worktree: string) {
  return projects.find((project) => project.worktree && samePath(project.worktree, worktree))
}

function takenWorktrees(projects: ProjectRef[]) {
  return new Set(projects.flatMap((project) => (project.worktree ? [normalize(project.worktree)] : [])))
}

/** Parent folder that may hold several project workspaces. */
export function domainParentDir(picked: string) {
  const root = projectRoot(normalize(picked))
  if (isDomainId(basename(root))) return dirname(root)
  return root
}

export function domainFolderName(domain: DomainId) {
  return domain
}

export function folderSlug(name: string | undefined, domain: DomainId) {
  const raw = (name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return raw || domain
}

function containerDir(picked: string, projects: ProjectRef[]) {
  const root = projectRoot(normalize(picked))
  if (isDomainId(basename(root))) return dirname(root)
  if (findByWorktree(projects, root)) return dirname(root)
  return root
}

function uniqueChild(parent: string, slug: string, projects: ProjectRef[]) {
  const taken = takenWorktrees(projects)
  const child = (name: string) => normalize(`${parent}/${name}`)
  if (!taken.has(child(slug))) return child(slug)
  for (let index = 2; index < 80; index++) {
    const next = child(`${slug}-${index}`)
    if (!taken.has(next)) return next
  }
  return child(`${slug}-${Date.now()}`)
}

function reopenExisting(input: { picked: string; domain: DomainId; name?: string; projects: ProjectRef[] }) {
  if (!findByWorktree(input.projects, input.picked)) return
  if (basename(input.picked) !== folderSlug(input.name, input.domain)) return
  return input.picked
}

/** Isolated worktree for one named project. Result lives at `<workspace>/result`. */
export function resolveDomainWorkspace(input: {
  picked: string
  domain: DomainId
  name?: string
  projects?: ProjectRef[]
}) {
  const picked = projectRoot(normalize(input.picked))
  if (!picked) return ""
  const projects = input.projects ?? []
  const reopen = reopenExisting({ ...input, picked, projects })
  if (reopen) return reopen
  return uniqueChild(containerDir(picked, projects), folderSlug(input.name, input.domain), projects)
}

export function domainResultDir(workspace: string) {
  return `${normalize(workspace)}/${RESULT_DIR}`
}

export function workspaceMarkerPath(folder: string) {
  return `${folder}/${WORKSPACE_MARKER}`
}

export function needsWorkspaceMarker(picked: string, workspace: string) {
  return !!workspace && !samePath(projectRoot(picked), workspace)
}

export async function provisionDomainWorkspace(input: {
  baseUrl: string
  fetchFn: typeof fetch
  picked: string
  workspace: string
  domain: DomainId
}) {
  const workspace = normalize(input.workspace)
  if (needsWorkspaceMarker(input.picked, workspace)) {
    const parent = dirname(workspace)
    const folder = basename(workspace)
    await ensureDirectory(input.baseUrl, input.fetchFn, parent, folder)
    await ensureDirectory(input.baseUrl, input.fetchFn, parent, `${folder}/.hyscience`)
    await writeTextFile(
      input.baseUrl,
      input.fetchFn,
      parent,
      workspaceMarkerPath(folder),
      JSON.stringify({ domain: input.domain }, null, 2),
    )
  }
  await ensureDirectory(input.baseUrl, input.fetchFn, workspace, RESULT_DIR)
  await ensureDirectory(input.baseUrl, input.fetchFn, workspace, UPLOAD_DIR)
  return workspace
}
