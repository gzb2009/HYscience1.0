import type { Project } from "@hysci/sdk/v2/client"
import { projectMetaLocal } from "@/thesis/store/projectMetaLocal"

export function projectLabel(project: Pick<Project, "name" | "worktree">): string {
  const local = projectMetaLocal.get(project.worktree).name?.trim()
  if (local) return local
  if (project.name?.trim()) return project.name.trim()
  const segs = project.worktree.split("/").filter(Boolean)
  return segs[segs.length - 1] ?? project.worktree
}
