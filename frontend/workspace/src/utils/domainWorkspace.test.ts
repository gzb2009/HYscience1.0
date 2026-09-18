import { describe, expect, test } from "bun:test"
import {
  domainParentDir,
  domainResultDir,
  folderSlug,
  needsWorkspaceMarker,
  resolveDomainWorkspace,
} from "./domainWorkspace"

const root = "/Users/gaozongbao/Desktop/Work"

describe("resolveDomainWorkspace", () => {
  test("nests a named project under the picked parent", () => {
    expect(resolveDomainWorkspace({ picked: root, domain: "imc", name: "前列腺癌 TLS" })).toBe(`${root}/前列腺癌 TLS`)
  })

  test("nests a new direction under the picked parent when unnamed", () => {
    expect(resolveDomainWorkspace({ picked: root, domain: "single-cell" })).toBe(`${root}/single-cell`)
  })

  test("keeps a folder that is already the direction workspace", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/imc`, domain: "imc" })).toBe(`${root}/imc`)
  })

  test("moves to a sibling when the pick is another direction folder", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/imc`, domain: "single-cell" })).toBe(`${root}/single-cell`)
  })

  test("does not overwrite a parent project of the same direction", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "imc",
        name: "肝癌 panel",
        projects: [{ worktree: root, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe("/Users/gaozongbao/Desktop/肝癌 panel")
  })

  test("does not reuse a parent that belongs to another direction", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "single-cell",
        projects: [{ worktree: root, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe("/Users/gaozongbao/Desktop/single-cell")
  })

  test("creates a sibling when the nested workspace already exists", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "imc",
        projects: [
          { worktree: root, research: { domain: "biology", subdomain: "imc" } },
          { worktree: `${root}/imc`, research: { domain: "biology", subdomain: "imc" } },
        ],
      }),
    ).toBe("/Users/gaozongbao/Desktop/imc")
  })

  test("suffixes when the project name is already taken", () => {
    expect(
      resolveDomainWorkspace({
        picked: root,
        domain: "imc",
        name: "前列腺癌 TLS",
        projects: [{ worktree: `${root}/前列腺癌 TLS`, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe(`${root}/前列腺癌 TLS-2`)
  })

  test("reopens only when the picked folder is that project and the name matches", () => {
    expect(
      resolveDomainWorkspace({
        picked: `${root}/前列腺癌 TLS`,
        domain: "imc",
        name: "前列腺癌 TLS",
        projects: [{ worktree: `${root}/前列腺癌 TLS`, research: { domain: "biology", subdomain: "imc" } }],
      }),
    ).toBe(`${root}/前列腺癌 TLS`)
  })

  test("strips a result folder before resolving", () => {
    expect(resolveDomainWorkspace({ picked: `${root}/result`, domain: "spatial" })).toBe(`${root}/spatial`)
  })
})

describe("domain workspace helpers", () => {
  test("folderSlug prefers the project name", () => {
    expect(folderSlug("前列腺癌 TLS", "imc")).toBe("前列腺癌 TLS")
    expect(folderSlug("  ", "imc")).toBe("imc")
  })

  test("domainParentDir peels a direction folder", () => {
    expect(domainParentDir(`${root}/imc`)).toBe(root)
    expect(domainParentDir(root)).toBe(root)
  })

  test("result lives inside the project workspace", () => {
    expect(domainResultDir(`${root}/single-cell`)).toBe(`${root}/single-cell/result`)
  })

  test("only nested workspaces need a marker", () => {
    expect(needsWorkspaceMarker(root, `${root}/single-cell`)).toBe(true)
    expect(needsWorkspaceMarker(root, root)).toBe(false)
  })
})
