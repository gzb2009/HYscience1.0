import { describe, expect, test } from "bun:test"
import { formatHostFilePath, resolveHostFileRef } from "./projectWorkspace"

const home = "/Users/gaozongbao"
const worktree = "/Users/gaozongbao/Desktop/HYscience1.0"

describe("resolveHostFileRef", () => {
  test("expands tilde paths under the worktree", () => {
    expect(resolveHostFileRef("/Users/gaozongbao/Desktop", "~/Desktop/单细胞测序报告模板.md", home)).toEqual({
      directory: "/Users/gaozongbao/Desktop",
      path: "单细胞测序报告模板.md",
    })
  })

  test("strips an absolute path inside the worktree", () => {
    expect(resolveHostFileRef(worktree, `${worktree}/results/report.md`, home)).toEqual({
      directory: worktree,
      path: "results/report.md",
    })
  })

  test("uses parent directory for files outside the worktree", () => {
    expect(resolveHostFileRef(worktree, "/Users/gaozongbao/Desktop/单细胞测序报告模板.md", home)).toEqual({
      directory: "/Users/gaozongbao/Desktop",
      path: "单细胞测序报告模板.md",
    })
  })

  test("collapses duplicated path segments", () => {
    expect(resolveHostFileRef(worktree, "results/results/reference_heatmap_liver.png", home)).toEqual({
      directory: worktree,
      path: "results/reference_heatmap_liver.png",
    })
  })

  test("keeps project-relative paths unchanged", () => {
    expect(resolveHostFileRef(worktree, "figures/umap.png", home)).toEqual({
      directory: worktree,
      path: "figures/umap.png",
    })
  })
})

describe("formatHostFilePath", () => {
  test("formats joined paths with home shorthand", () => {
    expect(formatHostFilePath("/Users/gaozongbao/Desktop", "单细胞测序报告模板.md")).toBe(
      "~/Desktop/单细胞测序报告模板.md",
    )
  })
})
