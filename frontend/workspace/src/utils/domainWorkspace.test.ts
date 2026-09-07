import { describe, expect, test } from "bun:test"
import { domainParentDir, domainResultDir, needsWorkspaceMarker, resolveDomainWorkspace } from "./domainWorkspace"

const root = "/Users/gaozongbao/Desktop/Work"

describe("resolveDomainWorkspace", () => {
  test("nests a new direction under the picked parent", () => {
    expect(resolveDomainWorkspace({ picked: root, domain: "single-cell" })).toBe(`${root}/single-cell`)
  })

  test("keeps a folder that is already the direction workspace", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/imc`, domain: "imc" })).toBe(`${root}/imc`)
  })

  test("moves to a sibling when the pick is another direction folder", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/imc`, domain: "single-cell" })).toBe(`${root}/single-cell`)
  })

  test("reuses a legacy parent project of the same direction", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "imc",
        projects: [{ worktree: root, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe(root)
  })

  test("does not reuse a parent that belongs to another direction", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "single-cell",
        projects: [{ worktree: root, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe(`${root}/single-cell`)
  })

  test("prefers an existing nested workspace over the parent", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "imc",
        projects: [
          { worktree: root, research: { domain: "biology", subdomain: "imc" } },
          { worktree: `${root}/imc`, research: { domain: "biology", subdomain: "imc" } },
        ],
      }),
    ).toBe(`${root}/imc`)
  })

  test("strips a result folder before resolving", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/result`, domain: "spatial" })).toBe(`${root}/spatial`)
  })
})

describe("domain workspace helpers", () => {
  test("domainParentDir peels a direction folder", () => {
    expect(domainParentDir(`${root}/imc`)).toBe(root)
    expect(domainParentDir(root)).toBe(root)
  })

  test("result lives inside the direction workspace", () => {
    expect(domainResultDir(`${root}/single-cell`)).toBe(`${root}/single-cell/result`)
  })

  test("only nested workspaces need a marker", () => {
    expect(needsWorkspaceMarker(root, `${root}/single-cell`)).toBe(true)
    expect(needsWorkspaceMarker(root, root)).toBe(false)
  })
})
