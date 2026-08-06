import { For, Show, createEffect, createMemo, createResource, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Switch } from "@hysci/ui/switch"
import type { Config } from "@hysci/sdk/v2/client"
import { showToast } from "@hysci/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { IconTrash, IconX } from "@/thesis/shared/Icon"
import { SkillCardArt } from "./icons"

export interface Skill {
  name: string
  description?: string
  location: string
  category?: string
}

export function skillCategoryId(skill: Skill) {
  return skill.category ?? "uncategorized"
}

export function skillCategories(skills: Skill[], allLabel: string, uncategorizedLabel: string) {
  const counts = new Map<string, number>()
  for (const skill of skills) {
    const id = skillCategoryId(skill)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [
    { id: "all", label: allLabel, count: skills.length },
    ...[...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, count]) => ({
        id,
        label: id === "uncategorized" ? uncategorizedLabel : id,
        count,
      })),
  ]
}

export function skillsInCategory(skills: Skill[], category: string) {
  if (category === "all") return skills
  return skills.filter((skill) => skillCategoryId(skill) === category)
}

export function skillDeletable(skill: Skill) {
  return skill.location.includes("user-skills")
}

export function useHomeSkills() {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const language = useLanguage()

  const [skills, skillsCtl] = createResource(async () => {
    const res = await sdk.client.app.skills()
    return ((res.data ?? []) as Skill[]).slice().sort((a, b) => a.name.localeCompare(b.name))
  })

  const skillPerm = createMemo<Record<string, "allow" | "deny">>(() => {
    const perm = sync.data.config.permission
    if (!perm || typeof perm === "string") return {}
    const skill = (perm as Record<string, unknown>).skill
    if (!skill || typeof skill === "string") return {}
    return skill as Record<string, "allow" | "deny">
  })

  const enabled = (name: string) => skillPerm()[name] !== "deny"

  async function toggle(name: string, next: boolean) {
    const prev = skillPerm()
    const map: Record<string, "allow" | "deny"> = { ...prev, [name]: next ? "allow" : "deny" }
    const perm = sync.data.config.permission
    const base = perm && typeof perm === "object" ? perm : {}
    sync.set("config", "permission", { ...base, skill: map })
    try {
      const res = await sdk.client.global.config.update({ config: { permission: { skill: map } } } as Config)
      if (res.error) throw new Error(String(res.error))
    } catch (err) {
      sync.set("config", "permission", { ...base, skill: prev })
      showToast({
        variant: "error",
        title: "Failed to update skill",
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function remove(name: string) {
    if (!window.confirm(language.t("home.capabilities.skills.deleteConfirm", { name }))) return
    try {
      const res = await sdk.client.app.skill.delete({ name })
      if (res.error) throw new Error(String(res.error))
      await skillsCtl.refetch()
      showToast({ variant: "success", title: language.t("home.capabilities.skills.deleted", { name }) })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("home.capabilities.skills.deleteFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { skills, skillsCtl, enabled, toggle, remove }
}

export type HomeSkillsStore = ReturnType<typeof useHomeSkills>

export function HomeSkillCard(props: {
  skill: Skill
  on: boolean
  onToggle: (next: boolean) => void
  onDelete?: () => void
  large?: boolean
}): JSX.Element {
  const language = useLanguage()
  const deletable = () => skillDeletable(props.skill) && !!props.onDelete

  return (
    <article
      class="cs-cap-skill-card"
      classList={{
        "cs-cap-skill-card-off": !props.on,
        "cs-cap-skill-card-large": !!props.large,
      }}
    >
      <div class="cs-cap-skill-card-top">
        <div class="cs-cap-skill-card-art">
          <SkillCardArt size={props.large ? 32 : 28} />
        </div>
        <Show when={deletable()}>
          <button
            type="button"
            class="cs-cap-skill-delete"
            title={language.t("home.capabilities.skills.delete")}
            aria-label={language.t("home.capabilities.skills.delete")}
            onClick={(e) => {
              e.stopPropagation()
              props.onDelete?.()
            }}
          >
            <IconTrash size={12} strokeWidth={1.5} />
          </button>
        </Show>
      </div>
      <div class="cs-cap-skill-card-name">{props.skill.name}</div>
      <Show when={props.skill.description}>
        <div class="cs-cap-skill-card-desc">{props.skill.description}</div>
      </Show>
      <div class="cs-cap-skill-card-foot">
        <Switch checked={props.on} onChange={props.onToggle} hideLabel>
          {props.skill.name}
        </Switch>
      </div>
    </article>
  )
}

export function HomeSkillsOverlay(props: {
  open: boolean
  onClose: () => void
  store: HomeSkillsStore
  search: string
  onSearch: (value: string) => void
  category: string
  focusSearch?: boolean
}): JSX.Element {
  const language = useLanguage()
  let searchRef: HTMLInputElement | undefined

  const filtered = createMemo(() => {
    const q = props.search.trim().toLowerCase()
    const base = skillsInCategory(props.store.skills() ?? [], props.category)
    return base.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q),
    )
  })

  createEffect(() => {
    if (!props.open || !props.focusSearch) return
    queueMicrotask(() => searchRef?.focus())
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) props.onClose()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div class="thesis-overlay" onClick={props.onClose} />
        <div class="cs-cap-fullscreen cs-cap-fullscreen-skills" onClick={(e) => e.stopPropagation()}>
          <header class="cs-cap-fullscreen-head">
            <h1>{language.t("home.capabilities.skills.title")}</h1>
            <button type="button" class="cs-cap-icon-btn" onClick={props.onClose} aria-label={language.t("common.close")}>
              <IconX size={16} strokeWidth={1.5} />
            </button>
          </header>
          <div class="cs-cap-fullscreen-toolbar">
            <input
              ref={searchRef}
              type="search"
              value={props.search}
              onInput={(e) => props.onSearch(e.currentTarget.value)}
              placeholder={language.t("home.capabilities.skills.search")}
            />
          </div>
          <div class="cs-cap-fullscreen-body">
            <Show
              when={!props.store.skills.loading}
              fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.loading")}</div>}
            >
              <Show
                when={filtered().length > 0}
                fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.empty")}</div>}
              >
                <div class="cs-cap-skill-grid cs-cap-skill-grid-full">
                  <For each={filtered()}>
                    {(skill) => (
                      <HomeSkillCard
                        skill={skill}
                        large
                        on={props.store.enabled(skill.name)}
                        onToggle={(v) => void props.store.toggle(skill.name, v)}
                        onDelete={
                          skillDeletable(skill) ? () => void props.store.remove(skill.name) : undefined
                        }
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export function previewRows(cols: number, total: number) {
  const cap = Math.max(cols * 2, cols)
  return Math.min(total, cap)
}
