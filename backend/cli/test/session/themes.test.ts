import { describe, expect, test } from "bun:test"
import path from "path"
import { readdir } from "fs/promises"
import { BIOLOGY_THEMES, DIRECTIONS, PRIMARY_THEMES, SHARED_SKILLS, THEMES, themeAllows } from "@hysci/util/themes"
import { DIRECTION_TITLE, FILES, FOREIGN, KEYWORDS } from "../../src/session/biology-lexicon"
import { BiologyProfile } from "../../src/session/biology-profile"
import { DomainScope } from "../../src/session/domain-scope"
import { SUBDOMAINS } from "../../src/session/task-profile"
import { SessionReview } from "../../src/session/review"
import { ThemeSlots } from "../../src/session/theme-slots"
import { domainSkillAllowed } from "../../src/skill/domain-preset"

// The theme manifest is the only place a theme may be added. Every layer that
// used to keep its own list must now agree with it, or this file fails.

const root = path.resolve(import.meta.dir, "../..")

async function skillNames() {
  const out = new Set<string>()
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (await Bun.file(path.join(full, "SKILL.md")).exists()) out.add(entry.name)
      await walk(full)
    }
  }
  await walk(path.join(root, "skills"))
  return out
}

describe("theme manifest", () => {
  test("ids are unique and general is primary", () => {
    const ids = THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(PRIMARY_THEMES.some((theme) => theme.id === "general")).toBe(true)
  })

  test("biology layers agree with the manifest", () => {
    expect([...SUBDOMAINS.biology].sort()).toEqual([...BIOLOGY_THEMES].sort())
    for (const id of BIOLOGY_THEMES) {
      expect(BiologyProfile.fragment(id)).toContain(`<biology-task-profile name="${id}">`)
      expect(KEYWORDS[id]).toBeInstanceOf(RegExp)
      expect(FILES[id]).toBeInstanceOf(RegExp)
    }
    for (const id of DIRECTIONS) {
      expect(DomainScope.id(id)).toBe(id)
      expect(FOREIGN[id]).toBeInstanceOf(RegExp)
      expect(DIRECTION_TITLE[id]).toBeTruthy()
    }
    for (const id of BIOLOGY_THEMES) {
      if ((DIRECTIONS as string[]).includes(id)) continue
      expect(DomainScope.id(id)).toBeUndefined()
    }
  })

  test("every profile fills the six-slot shape and leaves the compute gate to biology-core", async () => {
    const core = await Bun.file(path.join(root, "src/agent/prompt/biology-core-v2.txt")).text()
    expect(core).toContain("## Compute gate (every theme)")
    expect(core).toContain("provenance_record")
    for (const id of BIOLOGY_THEMES) {
      const text = BiologyProfile.fragment(id)
      for (const slot of ["## Ask first", "## Data forms", "## Hard constraints", "## Deliverable", "## Review"]) {
        expect(text, `${id} lacks ${slot}`).toContain(slot)
      }
      expect(text, `${id} repeats the compute gate`).not.toMatch(/BLOCKING before COMPUTE|Load skills first/)
      expect(BiologyProfile.review(id)?.split("\n").length ?? 0).toBeGreaterThanOrEqual(3)
      // Each theme stays a fragment, not a second system prompt.
      if (id !== "single-cell") expect(text.length).toBeLessThan(3_500)
    }
    expect(SessionReview.checklist("imc")).toContain("isotope")
    expect(SessionReview.checklist("general")).toBe("")
    for (const id of BIOLOGY_THEMES) {
      const section = BiologyProfile.fragment(id).split("## Data forms")[0]
      for (const slot of ThemeSlots.spec(id)?.ask ?? []) {
        expect(section, `${id} Ask first missing slot id "${slot.id}"`).toContain(slot.id)
      }
    }
  })

  test("every profile file on disk belongs to a manifest theme", async () => {
    const files = (await readdir(path.join(root, "src/agent/prompt/biology-profiles"))).filter((name) =>
      name.endsWith(".txt"),
    )
    expect(files.map((name) => name.replace(/\.txt$/, "")).sort()).toEqual([...BIOLOGY_THEMES].sort())
  })

  test("every theme skill and shared skill exists under skills/", async () => {
    const names = await skillNames()
    const missing = new Set<string>()
    for (const theme of THEMES) for (const skill of theme.skills) if (!names.has(skill)) missing.add(skill)
    for (const skill of SHARED_SKILLS) if (!names.has(skill)) missing.add(skill)
    expect([...missing]).toEqual([])
  })

  test("skill gate is the manifest gate", () => {
    expect(domainSkillAllowed("imc", "pcf-analysis")).toBe(true)
    expect(domainSkillAllowed("imc", "pysam")).toBe(false)
    expect(domainSkillAllowed("imc", "literature-review")).toBe(true)
    expect(domainSkillAllowed(undefined, "biopython")).toBe(themeAllows("general", "biopython"))
    expect(domainSkillAllowed("nonsense", "matplotlib")).toBe(true)
  })
})

test("workspace zh titles match the manifest", async () => {
  const zh = await Bun.file(path.join(root, "../../frontend/workspace/src/i18n/zh.ts")).text()
  for (const theme of PRIMARY_THEMES) {
    const match = zh.match(new RegExp(`"domain\\.${theme.id}\\.title": "([^"]+)"`))
    expect(match?.[1], `zh title for ${theme.id}`).toBe(theme.title)
  }
})
