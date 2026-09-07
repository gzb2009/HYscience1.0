import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { DropdownMenu } from "@hysci/ui/dropdown-menu"
import { useLanguage } from "@/context/language"
import { IconChevronDown, IconLayoutGrid, IconSearch } from "@/thesis/shared/Icon"
import {
  HomeSkillCard,
  HomeSkillDetail,
  HomeSkillsAddMenu,
  HomeSkillsOverlay,
  previewRows,
  skillCategories,
  skillDeletable,
  skillsInCategory,
  useHomeSkills,
  type Skill,
} from "./HomeSkills"
import { IconSkillsStack } from "./icons"

const skillColWidth = 128

export function HomeSkillsBlock(props: {
  domainId?: () => string | undefined
  title?: string
  hint?: string
  recommend?: string[]
  requireDomain?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  wide?: boolean
  preview?: boolean
}): JSX.Element {
  const language = useLanguage()
  const skillsStore = useHomeSkills({
    domainId: props.domainId,
    requireDomain: props.requireDomain,
  })

  const [internalOpen, setInternalOpen] = createSignal(false)
  const [skillSearch, setSkillSearch] = createSignal("")
  const [skillCategory, setSkillCategory] = createSignal("all")
  const [categoryOpen, setCategoryOpen] = createSignal(false)
  const [focusSearch, setFocusSearch] = createSignal(false)
  const [overlayView, setOverlayView] = createSignal<"list" | "scratch" | "github">("list")
  const [skillCols, setSkillCols] = createSignal(5)
  const [selected, setSelected] = createSignal<Skill | null>(null)

  const opened = () => props.open ?? internalOpen()

  function setOpened(next: boolean) {
    props.onOpenChange?.(next)
    if (props.open === undefined) setInternalOpen(next)
  }

  let skillGridRef: HTMLDivElement | undefined
  let fileInput: HTMLInputElement | undefined

  onMount(() => {
    const measure = () => {
      if (!skillGridRef) return
      setSkillCols(Math.max(3, Math.floor(skillGridRef.clientWidth / skillColWidth) - 1))
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
  const categoryTrigger = createMemo(() => {
    const item = activeCategory()
    const label = item?.label ?? language.t("home.capabilities.skills.categoryAll")
    const total = item?.count ?? list().length
    return `${label}${language.t("home.capabilities.skills.count", { total: String(total) })}`
  })
  const filtered = createMemo(() => {
    const rec = props.recommend ?? []
    return [...skillsInCategory(list(), skillCategory())].sort((a, b) => {
      const ea = skillsStore.enabled(a.name) ? 1 : 0
      const eb = skillsStore.enabled(b.name) ? 1 : 0
      if (ea !== eb) return eb - ea
      const ra = rec.includes(a.name) ? 1 : 0
      const rb = rec.includes(b.name) ? 1 : 0
      if (ra !== rb) return rb - ra
      return a.name.localeCompare(b.name)
    })
  })
  const shown = createMemo(() => {
    const all = filtered()
    const n = previewRows(skillCols(), all.length)
    return { preview: all.slice(0, n), total: list().length, cols: skillCols() }
  })

  function openSkills(opts?: { search?: boolean; view?: "list" | "scratch" | "github" }) {
    setFocusSearch(!!opts?.search)
    setOverlayView(opts?.view ?? "list")
    setOpened(true)
  }

  function closeSkills() {
    setOpened(false)
    setFocusSearch(false)
    setOverlayView("list")
  }

  return (
    <>
      <Show when={props.preview !== false}>
      <div class={`cs-home-capabilities-skills${props.wide ? " cs-home-capabilities-skills-wide" : ""}`}>
        <div class="cs-cap-head">
          <div class="cs-cap-head-title">
            <IconSkillsStack size={16} />
            <h2 class="cs-cap-head-heading">{props.title ?? language.t("home.capabilities.skills.title")}</h2>
            <DropdownMenu open={categoryOpen()} onOpenChange={setCategoryOpen} modal={false}>
              <DropdownMenu.Trigger
                class="cs-cap-category-btn cs-cap-category-btn-title"
                data-expanded={categoryOpen() ? "true" : "false"}
                title={language.t("home.capabilities.skills.category")}
                aria-label={`${language.t("home.capabilities.skills.category")}: ${categoryTrigger()}`}
              >
                <span>{categoryTrigger()}</span>
                <IconChevronDown size={12} strokeWidth={1.5} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="cs-menu cs-cap-category-menu mt-1">
                  <For each={categories()}>
                    {(item) => (
                      <DropdownMenu.Item class="cs-menu-item" onSelect={() => setSkillCategory(item.id)}>
                        <span>{item.label}</span>
                        <span class="cs-cap-category-count">{item.count}</span>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
          <div class="cs-cap-head-actions">
            <button
              type="button"
              class="cs-cap-ghost-btn"
              title={language.t("home.capabilities.skills.search")}
              aria-label={language.t("home.capabilities.skills.search")}
              onClick={() => openSkills({ search: true })}
            >
              <IconSearch size={14} strokeWidth={1.5} />
            </button>
            <HomeSkillsAddMenu
              onScratch={() => openSkills({ view: "scratch" })}
              onUpload={() => fileInput?.click()}
              onGithub={() => openSkills({ view: "github" })}
            />
            <button
              type="button"
              class="cs-cap-ghost-btn"
              title={language.t("home.capabilities.skills.expand")}
              aria-label={language.t("home.capabilities.skills.expand")}
              onClick={() => openSkills()}
            >
              <IconLayoutGrid size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <Show when={props.hint}>
          <p class="cs-cap-head-hint">{props.hint}</p>
        </Show>

        <input
          ref={fileInput}
          type="file"
          accept=".md,text/markdown"
          class="cs-cap-file-input"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ""
            if (file) void skillsStore.uploadSkill(file)
          }}
        />

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
                    onOpen={() => setSelected(skill)}
                    onDelete={skillDeletable(skill) ? () => void skillsStore.remove(skill.name) : undefined}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
      </Show>

      <HomeSkillsOverlay
        open={opened()}
        onClose={closeSkills}
        store={skillsStore}
        search={skillSearch()}
        onSearch={setSkillSearch}
        category={skillCategory()}
        onCategory={setSkillCategory}
        focusSearch={focusSearch()}
        initialView={overlayView()}
        title={props.title}
        recommend={props.recommend}
      />
      <Show when={selected()}>
        {(skill) => (
          <HomeSkillDetail
            skill={skill()}
            on={skillsStore.enabled(skill().name)}
            onToggle={(v) => void skillsStore.toggle(skill().name, v)}
            onDelete={
              skillDeletable(skill())
                ? () => {
                    void skillsStore.remove(skill().name).then((ok) => {
                      if (ok) setSelected(null)
                    })
                  }
                : undefined
            }
            onClose={() => setSelected(null)}
          />
        )}
      </Show>
    </>
  )
}
