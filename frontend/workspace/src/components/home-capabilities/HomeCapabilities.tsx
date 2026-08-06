import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { DropdownMenu } from "@hysci/ui/dropdown-menu"
import { useLanguage } from "@/context/language"
import { IconChevronDown, IconLayoutGrid, IconSearch } from "@/thesis/shared/Icon"
import type { ComputeKind } from "./icons"
import { HomeComputeDrawer, HomeComputeItem, computeSubtitle, computeTiers, useHomeCompute } from "./HomeCompute"
import {
  HomeSkillCard,
  HomeSkillsOverlay,
  previewRows,
  skillCategories,
  skillDeletable,
  skillsInCategory,
  useHomeSkills,
} from "./HomeSkills"
import { IconComputeChip, IconSkillsStack } from "./icons"

const skillColWidth = 108

export function HomeCapabilities(): JSX.Element {
  const language = useLanguage()
  const skillsStore = useHomeSkills()
  const compute = useHomeCompute()

  const [skillsOpen, setSkillsOpen] = createSignal(false)
  const [skillSearch, setSkillSearch] = createSignal("")
  const [skillCategory, setSkillCategory] = createSignal("all")
  const [categoryOpen, setCategoryOpen] = createSignal(false)
  const [focusSearch, setFocusSearch] = createSignal(false)
  const [drawerKind, setDrawerKind] = createSignal<ComputeKind>()
  const [skillCols, setSkillCols] = createSignal(6)

  let skillGridRef: HTMLDivElement | undefined

  onMount(() => {
    const measure = () => {
      if (!skillGridRef) return
      setSkillCols(Math.max(4, Math.floor(skillGridRef.clientWidth / skillColWidth)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (skillGridRef) ro.observe(skillGridRef)
    onCleanup(() => ro.disconnect())
  })

  const list = createMemo(() => skillsStore.skills() ?? [])
  const categories = createMemo(() =>
    skillCategories(
      list(),
      language.t("home.capabilities.skills.categoryAll"),
      language.t("home.capabilities.skills.uncategorized"),
    ),
  )
  const activeCategory = createMemo(() => categories().find((item) => item.id === skillCategory()) ?? categories()[0])
  const filtered = createMemo(() => skillsInCategory(list(), skillCategory()))
  const shown = createMemo(() => {
    const all = filtered()
    const n = previewRows(skillCols(), all.length)
    return { preview: all.slice(0, n), total: list().length, cols: skillCols() }
  })

  function openSkills(search = false) {
    setFocusSearch(search)
    setSkillsOpen(true)
  }

  function closeSkills() {
    setSkillsOpen(false)
    setFocusSearch(false)
  }

  return (
    <>
      <section class="cs-home-capabilities" aria-label={language.t("home.capabilities.label")}>
        <div class="cs-home-capabilities-grid">
          <div class="cs-home-capabilities-skills">
            <div class="cs-cap-head">
              <h2 class="cs-cap-head-title">
                <IconSkillsStack size={16} />
                {language.t("home.capabilities.skills.title")}
                <span class="cs-cap-head-meta">
                  {language.t("home.capabilities.skills.count", {
                    total: String(shown().total),
                  })}
                </span>
              </h2>
              <div class="cs-cap-head-actions">
                <DropdownMenu open={categoryOpen()} onOpenChange={setCategoryOpen} modal={false}>
                  <DropdownMenu.Trigger
                    class="cs-cap-category-btn"
                    data-expanded={categoryOpen() ? "true" : "false"}
                    title={language.t("home.capabilities.skills.category")}
                    aria-label={language.t("home.capabilities.skills.category")}
                  >
                    <span>{activeCategory()?.label ?? language.t("home.capabilities.skills.categoryAll")}</span>
                    <IconChevronDown size={12} strokeWidth={1.5} />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="cs-menu mt-1">
                      <For each={categories()}>
                        {(item) => (
                          <DropdownMenu.Item
                            class="cs-menu-item"
                            onSelect={() => setSkillCategory(item.id)}
                          >
                            <span>{item.label}</span>
                            <span class="cs-cap-category-count">{item.count}</span>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
                <button
                  type="button"
                  class="cs-cap-ghost-btn"
                  title={language.t("home.capabilities.skills.search")}
                  aria-label={language.t("home.capabilities.skills.search")}
                  onClick={() => openSkills(true)}
                >
                  <IconSearch size={14} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  class="cs-cap-ghost-btn"
                  title={language.t("home.capabilities.skills.expand")}
                  aria-label={language.t("home.capabilities.skills.expand")}
                  onClick={() => openSkills(false)}
                >
                  <IconLayoutGrid size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <Show
              when={!skillsStore.skills.loading}
              fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.loading")}</div>}
            >
              <Show
                when={filtered().length > 0}
                fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.empty")}</div>}
              >
                <div
                  ref={skillGridRef}
                  class="cs-cap-skill-grid cs-cap-skill-grid-preview"
                  style={{ "--cap-skill-cols": String(shown().cols) }}
                >
                  <For each={shown().preview}>
                    {(skill) => (
                      <HomeSkillCard
                        skill={skill}
                        on={skillsStore.enabled(skill.name)}
                        onToggle={(v) => void skillsStore.toggle(skill.name, v)}
                        onDelete={
                          skillDeletable(skill) ? () => void skillsStore.remove(skill.name) : undefined
                        }
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>

          <div class="cs-home-capabilities-compute">
            <h2 class="cs-cap-head-title cs-cap-compute-title">
              <IconComputeChip size={16} />
              {language.t("home.capabilities.compute.title")}
            </h2>

            <Show
              when={!compute.info.loading}
              fallback={<div class="cs-cap-empty">{language.t("home.capabilities.compute.loading")}</div>}
            >
              <div class="cs-cap-compute-stack">
                <For each={computeTiers}>
                  {(kind) => (
                    <HomeComputeItem
                      kind={kind}
                      title={
                        kind === "local"
                          ? language.t("home.capabilities.compute.localTitle")
                          : kind === "ssh"
                            ? language.t("home.capabilities.compute.sshTitle")
                            : language.t("home.capabilities.compute.cloudTitle")
                      }
                      scene={
                        kind === "local"
                          ? language.t("home.capabilities.compute.localScene")
                          : kind === "ssh"
                            ? language.t("home.capabilities.compute.sshScene")
                            : language.t("home.capabilities.compute.cloudScene")
                      }
                      subtitle={computeSubtitle(kind, compute.info(), language.t)}
                      active={(compute.info()?.execution ?? "local") === kind}
                      onSelect={() => void compute.setExecution(kind)}
                      onSettings={() => setDrawerKind(kind)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </section>

      <HomeSkillsOverlay
        open={skillsOpen()}
        onClose={closeSkills}
        store={skillsStore}
        search={skillSearch()}
        onSearch={setSkillSearch}
        category={skillCategory()}
        focusSearch={focusSearch()}
      />
      <HomeComputeDrawer
        open={!!drawerKind()}
        kind={drawerKind()}
        compute={compute}
        onClose={() => setDrawerKind(undefined)}
      />
    </>
  )
}
