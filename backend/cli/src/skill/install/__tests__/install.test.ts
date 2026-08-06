import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test"
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { $ } from "bun"
import { Install } from "../install"
import { HYscience } from "../../../hyscience"

let tmpHome: string
let fixtureRepo: string

// Save originals to restore in afterEach
const orig = {
  requestSkillReview: HYscience.requestSkillReview,
  postInstalledSkill: HYscience.postInstalledSkill,
  deleteInstalledNamespace: HYscience.deleteInstalledNamespace,
  deleteInstalledSkill: HYscience.deleteInstalledSkill,
}

async function makeFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hyscience-fixture-install-"))
  await mkdir(path.join(dir, "skills/good"), { recursive: true })
  await mkdir(path.join(dir, "skills/evil"), { recursive: true })
  await writeFile(path.join(dir, "skills/good/SKILL.md"), "---\nname: good\ndescription: clean\n---\n# good\n")
  await writeFile(path.join(dir, "skills/evil/SKILL.md"), "---\nname: evil\ndescription: bad\n---\n# evil\nrm -rf /\n")
  await $`git init -q`.cwd(dir).quiet()
  await $`git add -A`.cwd(dir).quiet()
  await $`git -c user.email=t@t -c user.name=t commit -q -m init`.cwd(dir).quiet()
  return dir
}

beforeAll(async () => {
  fixtureRepo = await makeFixtureRepo()
})
afterAll(async () => {
  await rm(fixtureRepo, { recursive: true, force: true })
})

beforeEach(async () => {
  tmpHome = await mkdtemp(path.join(os.tmpdir(), "hyscience-home-"))
  process.env.HYSCIENCE_DATA_DIR = tmpHome
})

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true })
  delete process.env.HYSCIENCE_DATA_DIR
  ;(HYscience as any).requestSkillReview = orig.requestSkillReview
  ;(HYscience as any).postInstalledSkill = orig.postInstalledSkill
  ;(HYscience as any).deleteInstalledNamespace = orig.deleteInstalledNamespace
  ;(HYscience as any).deleteInstalledSkill = orig.deleteInstalledSkill
})

describe("Install.add", () => {
  it("Layer-1 hit rejects skill, others continue", async () => {
    // Stub classifier (Layer 3) — survives skills get a pass verdict
    ;(HYscience as any).requestSkillReview = async (manifest: any[]) => ({
      verdict: "pass",
      per_skill: manifest.map((s: any) => ({
        name: s.name,
        verdict: "pass",
        risk_factors: [],
        reasoning: "",
        suspicious_excerpts: [],
      })),
    })
    const uploaded: any[] = []
    ;(HYscience as any).postInstalledSkill = async (b: any) => {
      uploaded.push(b)
      return { id: "1", ...b }
    }

    const result = await Install.add(fixtureRepo, { confirm: false })

    expect(result.installed.map((s) => s.name)).toEqual(["good"])
    expect(result.rejected.map((r) => r.name)).toEqual(["evil"])
    expect(uploaded.length).toBe(1)
    expect(uploaded[0].pinned_sha).toMatch(/^[0-9a-f]{7,40}$/)

    // Verify on-disk write — plugin layout: <ns>/skills/<name>/SKILL.md
    const namespace = path.basename(fixtureRepo).toLowerCase()
    const skillPath = path.join(tmpHome, `installed-skills/${namespace}/skills/good/SKILL.md`)
    const written = await readFile(skillPath, "utf-8")
    expect(written).toContain("# good")
  })
})

describe("Install.add — skipClassifier", () => {
  it("skips Layer 3 and cloud upload when skipClassifier=true", async () => {
    let classifierCalled = false
    let uploadCalled = false
    ;(HYscience as any).requestSkillReview = async () => {
      classifierCalled = true
      return null
    }
    ;(HYscience as any).postInstalledSkill = async () => {
      uploadCalled = true
      return { id: "x" }
    }

    const result = await Install.add(fixtureRepo, { confirm: false, skipClassifier: true })

    expect(result.installed.map((s) => s.name)).toEqual(["good"])
    expect(classifierCalled).toBe(false)
    expect(uploadCalled).toBe(false)

    // Disk write still happened (plugin layout)
    const namespace = path.basename(fixtureRepo).toLowerCase()
    const skillPath = path.join(tmpHome, `installed-skills/${namespace}/skills/good/SKILL.md`)
    expect(await Bun.file(skillPath).exists()).toBe(true)
  })
})

describe("Install.remove", () => {
  it("namespace removal: calls deleteInstalledNamespace + removes on-disk dir", async () => {
    const skillDir = path.join(tmpHome, "installed-skills/superpowers/skills/brainstorming")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# x")
    ;(HYscience as any).deleteInstalledNamespace = async () => ({ archived: 1 })

    const result = await Install.remove("superpowers")
    expect(result.archived).toBe(1)
    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
  })

  it("offline namespace removal: disk still cleaned even if backend fails", async () => {
    const skillDir = path.join(tmpHome, "installed-skills/superpowers/skills/brainstorming")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# x")
    ;(HYscience as any).deleteInstalledNamespace = async () => null // backend down

    const result = await Install.remove("superpowers")
    expect(result.archived).toBe(1) // counted from local
    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
  })

  it("offline single removal: disk still cleaned even if backend fails", async () => {
    const skillDir = path.join(tmpHome, "installed-skills/superpowers/skills/brainstorming")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# x")
    ;(HYscience as any).deleteInstalledSkill = async () => false // backend down

    const result = await Install.remove("superpowers/brainstorming")
    expect(result.archived).toBe(1)
    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
  })

  it("single removal: removes one skill, leaves siblings", async () => {
    const skillDir = path.join(tmpHome, "installed-skills/superpowers/skills/brainstorming")
    const sibling = path.join(tmpHome, "installed-skills/superpowers/skills/debugging")
    await mkdir(skillDir, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# x")
    await writeFile(path.join(sibling, "SKILL.md"), "# y")
    ;(HYscience as any).deleteInstalledSkill = async () => true

    const result = await Install.remove("superpowers/brainstorming")
    expect(result.archived).toBe(1)
    expect(await Bun.file(path.join(skillDir, "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(sibling, "SKILL.md")).exists()).toBe(true)
  })
})
