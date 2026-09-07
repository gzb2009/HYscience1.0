import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { Switch } from "@hysci/ui/switch"
import { DropdownMenu } from "@hysci/ui/dropdown-menu"
import { useDialog } from "@hysci/ui/context/dialog"
import { showToast } from "@hysci/ui/toast"
import { Markdown } from "@hysci/ui/markdown"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { currentDirectory } from "@/utils/base64"
import { confirmDialog } from "@/thesis/dialogs"
import {
  IconChevronDown,
  IconGitBranch,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@/thesis/shared/Icon"
import { SkillCardArt } from "./icons"
import { buildDomainOverlay, domainAllows, type DomainId } from "@/domain/registry"
import { invalidateSkillCatalog, loadSkillCatalog } from "@/utils/skillCatalog"

export interface Skill {
  name: string
  description?: string
  location: string
  category?: string
}

type SkillView = "list" | "scratch" | "github"

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

function frontmatterName(content: string): string | undefined {
  const match = content.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)
  if (!match) return undefined
  const line = match[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l))
  return line
    ?.split(":")
    .slice(1)
    .join(":")
    .trim()
    .replace(/^["']|["']$/g, "")
}

async function installFromGit(
  fetchFn: typeof fetch,
  baseUrl: string,
  directory: string,
  url: string,
): Promise<{ installed: unknown[]; rejected: unknown[] }> {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/settings/skills/install?directory=${encodeURIComponent(directory)}`
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `Request failed (${res.status})`)
  }
  return res.json() as Promise<{ installed: unknown[]; rejected: unknown[] }>
}

type DomainSkillMap = Record<string, Record<string, "allow" | "deny">>

export function useHomeSkills(opts?: { domainId?: () => string | undefined; requireDomain?: boolean }) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()

  const [skills, skillsCtl] = createResource(() => loadSkillCatalog(sdk) as Promise<Skill[]>)

  async function refresh() {
    invalidateSkillCatalog()
    await skillsCtl.refetch()
  }

  const [overrides, setOverrides] = createSignal<Record<string, "allow" | "deny">>({})
  const [busy, setBusy] = createSignal(false)

  const skillPerm = createMemo<Record<string, "allow" | "deny">>(() => {
    const perm = sync.data.config.permission
    if (!perm || typeof perm === "string") return {}
    const skill = (perm as Record<string, unknown>).skill
    if (!skill || typeof skill === "string") return {}
    return skill as Record<string, "allow" | "deny">
  })

  const domainMap = createMemo<DomainSkillMap>(() => {
    return ((sync.data.config as { domainSkill?: DomainSkillMap }).domainSkill ?? {}) as DomainSkillMap
  })

  createEffect(() => {
    opts?.domainId?.()
    setOverrides({})
  })

  const enabled = (name: string) => {
    const local = overrides()[name]
    if (local) return local === "allow"
    const id = opts?.domainId?.()
    if (id) {
      const configured = domainMap()[id]
      if (configured && Object.keys(configured).length > 0) {
        const overlay = configured[name]
        if (overlay === "deny") return false
        if (overlay === "allow") return true
        return skillPerm()[name] !== "deny"
      }
      return domainAllows(id as DomainId, name)
    }
    return skillPerm()[name] !== "deny"
  }

  async function toggle(name: string, next: boolean) {
    const id = opts?.domainId?.()
    if (opts?.requireDomain && !id) {
      showToast({
        variant: "error",
        title: language.t("domain.guide.skillsPick"),
      })
      return
    }
    const value = next ? ("allow" as const) : ("deny" as const)
    setOverrides((cur) => ({ ...cur, [name]: value }))
    try {
      if (id) {
        const current = domainMap()[id]
        const base =
          current && Object.keys(current).length > 0
            ? current
            : buildDomainOverlay(
                id as DomainId,
                (skills() ?? []).map((item) => item.name),
              )
        const nextAll = { ...domainMap(), [id]: { ...base, [name]: value } }
        const res = await sdk.client.global.config.update({ config: { domainSkill: nextAll } as never })
        if (res.error) throw new Error(String(res.error))
        sync.set("config", "domainSkill" as never, nextAll)
      } else {
        const map: Record<string, "allow" | "deny"> = { ...skillPerm(), ...overrides(), [name]: value }
        const res = await sdk.client.global.config.update({ config: { permission: { skill: map } } })
        if (res.error) throw new Error(String(res.error))
        const perm = sync.data.config.permission
        const base = perm && typeof perm === "object" ? perm : {}
        sync.set("config", "permission", { ...base, skill: map })
      }
      setOverrides((cur) => {
        const copy = { ...cur }
        delete copy[name]
        return copy
      })
    } catch (err) {
      setOverrides((cur) => {
        const copy = { ...cur }
        delete copy[name]
        return copy
      })
      showToast({
        variant: "error",
        title: "Failed to update skill",
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function remove(name: string) {
    const ok = await confirmDialog(dialog, {
      title: language.t("home.capabilities.skills.deleteConfirmTitle"),
      message: language.t("home.capabilities.skills.deleteConfirm", { name }),
      confirmLabel: language.t("home.capabilities.skills.delete"),
      danger: true,
    })
    if (!ok) return false
    try {
      const res = await sdk.client.app.skill.delete({ name })
      if (res.error) throw new Error(String(res.error))
      await refresh()
      showToast({ variant: "success", title: language.t("home.capabilities.skills.deleted", { name }) })
      return true
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("home.capabilities.skills.deleteFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  async function writeSkill(name: string, description: string, body: string) {
    setBusy(true)
    try {
      const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
      await sdk.client.app.skill.write({ name, content })
      await refresh()
      showToast({ variant: "success", title: language.t("home.capabilities.skills.created", { name }) })
      return true
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("home.capabilities.skills.createFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function uploadSkill(file: File) {
    setBusy(true)
    try {
      const content = await file.text()
      const name = frontmatterName(content)
      if (!name) {
        throw new Error(language.t("home.capabilities.skills.uploadInvalid"))
      }
      await sdk.client.app.skill.write({ name, content })
      await refresh()
      showToast({ variant: "success", title: language.t("home.capabilities.skills.uploaded", { name }) })
      return true
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("home.capabilities.skills.uploadFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function installGithub(url: string) {
    setBusy(true)
    try {
      const res = await installFromGit(platform.fetch ?? fetch, sdk.url, currentDirectory(), url)
      await refresh()
      const n = res.installed.length
      const r = res.rejected.length
      showToast({
        variant: n > 0 ? "success" : "error",
        title:
          n > 0
            ? language.t("home.capabilities.skills.installed", { count: String(n) })
            : language.t("home.capabilities.skills.installNone"),
        description: r > 0 ? language.t("home.capabilities.skills.installRejected", { count: String(r) }) : undefined,
      })
      return n > 0
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("home.capabilities.skills.installFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    skills,
    skillsCtl,
    enabled,
    toggle,
    remove,
    busy,
    writeSkill,
    uploadSkill,
    installGithub,
  }
}

export type HomeSkillsStore = ReturnType<typeof useHomeSkills>

export function HomeSkillCard(props: {
  skill: Skill
  on: boolean
  onToggle: (next: boolean) => void
  onOpen?: () => void
  onDelete?: () => void
  large?: boolean
}): JSX.Element {
  const language = useLanguage()
  const deletable = () => skillDeletable(props.skill) && !!props.onDelete
  const category = () =>
    props.skill.category === "uncategorized" || !props.skill.category
      ? language.t("home.capabilities.skills.uncategorized")
      : props.skill.category

  return (
    <article
      class="cs-cap-skill-card"
      classList={{
        "cs-cap-skill-card-off": !props.on,
        "cs-cap-skill-card-large": !!props.large,
        "cs-cap-skill-card-clickable": !!props.onOpen,
      }}
      role={props.onOpen ? "button" : undefined}
      tabindex={props.onOpen ? 0 : undefined}
      onClick={() => props.onOpen?.()}
      onKeyDown={(e) => {
        if (!props.onOpen) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          props.onOpen?.()
        }
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
      <span class="cs-cap-skill-card-cat">{category()}</span>
      <Show when={props.skill.description}>
        <div class="cs-cap-skill-card-desc">{props.skill.description}</div>
      </Show>
      <div class="cs-cap-skill-card-foot" onClick={(e) => e.stopPropagation()}>
        <span class="cs-cap-skill-card-hint">{language.t("home.capabilities.skills.viewHint")}</span>
        <Switch checked={props.on} onChange={props.onToggle} hideLabel>
          {props.skill.name}
        </Switch>
      </div>
    </article>
  )
}

function skillBody(content: string) {
  const match = content.match(/^---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]?/)
  if (!match) return content
  return content.slice(match[0].length).trimStart()
}

export function HomeSkillDetail(props: {
  skill: Skill | undefined
  on: boolean
  onClose: () => void
  onToggle: (next: boolean) => void
  onDelete?: () => void
}): JSX.Element {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const deletable = () => !!props.skill && skillDeletable(props.skill) && !!props.onDelete
  const category = () => {
    if (!props.skill?.category || props.skill.category === "uncategorized") {
      return language.t("home.capabilities.skills.uncategorized")
    }
    return props.skill.category
  }

  const [doc] = createResource(
    () => props.skill?.name,
    async (name) => {
      const dir = currentDirectory()
      const query = dir ? `?directory=${encodeURIComponent(dir)}` : ""
      const url = `${sdk.url.replace(/\/$/, "")}/skill/${encodeURIComponent(name)}${query}`
      const res = await (platform.fetch ?? fetch)(url)
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || language.t("home.capabilities.skills.readFailed"))
      }
      return (await res.json()) as Skill & { content: string }
    },
  )

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.skill) {
        e.stopImmediatePropagation()
        props.onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Show when={props.skill}>
      {(skill) => (
        <Portal>
          <div class="thesis-overlay" onClick={props.onClose} />
          <div
            class="cs-cap-fullscreen cs-cap-fullscreen-skills cs-cap-skill-reader"
            onClick={(e) => e.stopPropagation()}
          >
            <header class="cs-cap-fullscreen-head">
              <div class="cs-cap-skill-reader-title">
                <SkillCardArt size={28} />
                <div>
                  <h1>{skill().name}</h1>
                  <div class="cs-cap-skill-reader-meta">
                    <span class="cs-cap-skill-card-cat">{category()}</span>
                    <span class="cs-cap-skill-detail-state">
                      {props.on
                        ? language.t("home.capabilities.skills.enabled")
                        : language.t("home.capabilities.skills.disabled")}
                    </span>
                  </div>
                </div>
              </div>
              <div class="cs-cap-skill-reader-actions">
                <label class="cs-cap-skill-detail-toggle">
                  <span>{language.t("home.capabilities.skills.enable")}</span>
                  <Switch checked={props.on} onChange={props.onToggle} hideLabel>
                    {skill().name}
                  </Switch>
                </label>
                <Show when={deletable()}>
                  <button
                    type="button"
                    class="cs-btn-text cs-cap-skill-detail-delete"
                    onClick={() => props.onDelete?.()}
                  >
                    <IconTrash size={13} strokeWidth={1.5} />
                    {language.t("home.capabilities.skills.delete")}
                  </button>
                </Show>
                <button
                  type="button"
                  class="cs-cap-icon-btn"
                  onClick={props.onClose}
                  aria-label={language.t("common.close")}
                >
                  <IconX size={16} strokeWidth={1.5} />
                </button>
              </div>
            </header>

            <Show when={skill().description}>
              <p class="cs-cap-skill-reader-desc">{skill().description}</p>
            </Show>

            <div class="cs-cap-fullscreen-body cs-cap-skill-reader-body">
              <Show when={doc.loading}>
                <div class="cs-cap-empty">{language.t("home.capabilities.skills.reading")}</div>
              </Show>
              <Show when={doc.error}>
                <div class="cs-cap-empty">{language.t("home.capabilities.skills.readFailed")}</div>
              </Show>
              <Show when={!doc.loading && !doc.error && doc()}>
                {(detail) => <Markdown class="thesis-md cs-cap-skill-reader-md" text={skillBody(detail().content)} />}
              </Show>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}

export function HomeSkillsAddMenu(props: {
  onScratch: () => void
  onUpload: () => void
  onGithub: () => void
}): JSX.Element {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger
        class="cs-cap-add-btn"
        data-expanded={open() ? "true" : "false"}
        title={language.t("home.capabilities.skills.add")}
        aria-label={language.t("home.capabilities.skills.add")}
      >
        <IconPlus size={12} strokeWidth={1.75} />
        <span>{language.t("home.capabilities.skills.add")}</span>
        <IconChevronDown size={12} strokeWidth={1.5} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="cs-menu mt-1 cs-cap-add-menu">
          <DropdownMenu.Item class="cs-menu-item cs-cap-add-item" onSelect={props.onScratch}>
            <IconPencil size={14} strokeWidth={1.5} />
            <span class="cs-cap-add-copy">
              <strong>{language.t("home.capabilities.skills.addScratch")}</strong>
              <small>{language.t("home.capabilities.skills.addScratchHint")}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item class="cs-menu-item cs-cap-add-item" onSelect={props.onUpload}>
            <IconUpload size={14} strokeWidth={1.5} />
            <span class="cs-cap-add-copy">
              <strong>{language.t("home.capabilities.skills.addUpload")}</strong>
              <small>{language.t("home.capabilities.skills.addUploadHint")}</small>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item class="cs-menu-item cs-cap-add-item" onSelect={props.onGithub}>
            <IconGitBranch size={14} strokeWidth={1.5} />
            <span class="cs-cap-add-copy">
              <strong>{language.t("home.capabilities.skills.addGithub")}</strong>
              <small>{language.t("home.capabilities.skills.addGithubHint")}</small>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function ScratchForm(props: {
  busy: boolean
  onCancel: () => void
  onCreate: (name: string, description: string, body: string) => void
}): JSX.Element {
  const language = useLanguage()
  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [body, setBody] = createSignal("")
  const valid = () => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name().trim()) && description().trim().length > 0

  return (
    <div class="cs-cap-skill-form">
      <h3>{language.t("home.capabilities.skills.scratchTitle")}</h3>
      <label class="cs-field">
        <span class="cs-field-label">{language.t("home.capabilities.skills.scratchName")}</span>
        <input
          class="cs-field-input"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder={language.t("home.capabilities.skills.scratchNamePh")}
        />
      </label>
      <label class="cs-field">
        <span class="cs-field-label">{language.t("home.capabilities.skills.scratchDesc")}</span>
        <input
          class="cs-field-input"
          value={description()}
          onInput={(e) => setDescription(e.currentTarget.value)}
          placeholder={language.t("home.capabilities.skills.scratchDescPh")}
        />
      </label>
      <label class="cs-field">
        <span class="cs-field-label">{language.t("home.capabilities.skills.scratchBody")}</span>
        <textarea
          class="cs-field-textarea cs-field-textarea-lg"
          rows={8}
          value={body()}
          onInput={(e) => setBody(e.currentTarget.value)}
          placeholder={language.t("home.capabilities.skills.scratchBodyPh")}
        />
      </label>
      <div class="cs-cap-skill-form-actions">
        <button type="button" class="cs-btn-text" disabled={props.busy} onClick={props.onCancel}>
          {language.t("common.cancel")}
        </button>
        <button
          type="button"
          class="cs-btn-primary"
          disabled={props.busy || !valid()}
          onClick={() => props.onCreate(name().trim(), description().trim(), body())}
        >
          {props.busy ? language.t("home.capabilities.skills.creating") : language.t("home.capabilities.skills.create")}
        </button>
      </div>
    </div>
  )
}

function GithubForm(props: { busy: boolean; onCancel: () => void; onInstall: (url: string) => void }): JSX.Element {
  const language = useLanguage()
  const [url, setUrl] = createSignal("")

  return (
    <div class="cs-cap-skill-form">
      <h3>{language.t("home.capabilities.skills.githubTitle")}</h3>
      <label class="cs-field">
        <span class="cs-field-label">{language.t("home.capabilities.skills.githubUrl")}</span>
        <input
          class="cs-field-input"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          placeholder="https://github.com/owner/repo"
        />
      </label>
      <p class="cs-field-hint">{language.t("home.capabilities.skills.githubHint")}</p>
      <div class="cs-cap-skill-form-actions">
        <button type="button" class="cs-btn-text" disabled={props.busy} onClick={props.onCancel}>
          {language.t("common.cancel")}
        </button>
        <button
          type="button"
          class="cs-btn-primary"
          disabled={props.busy || !url().trim()}
          onClick={() => props.onInstall(url().trim())}
        >
          {props.busy
            ? language.t("home.capabilities.skills.installing")
            : language.t("home.capabilities.skills.install")}
        </button>
      </div>
    </div>
  )
}

export function HomeSkillsOverlay(props: {
  open: boolean
  onClose: () => void
  store: HomeSkillsStore
  search: string
  onSearch: (value: string) => void
  category: string
  onCategory: (value: string) => void
  focusSearch?: boolean
  initialView?: SkillView
  title?: string
  recommend?: string[]
}): JSX.Element {
  const language = useLanguage()
  const [view, setView] = createSignal<SkillView>("list")
  const [categoryOpen, setCategoryOpen] = createSignal(false)
  const [selected, setSelected] = createSignal<Skill | null>(null)
  const [mounted, setMounted] = createSignal(false)
  let searchRef: HTMLInputElement | undefined
  let fileInput: HTMLInputElement | undefined

  const categories = createMemo(() =>
    skillCategories(
      props.store.skills() ?? [],
      language.t("home.capabilities.skills.categoryAll"),
      language.t("home.capabilities.skills.uncategorized"),
    ),
  )
  const activeCategory = createMemo(() => categories().find((item) => item.id === props.category) ?? categories()[0])

  const filtered = createMemo(() => {
    const q = props.search.trim().toLowerCase()
    const base = skillsInCategory(props.store.skills() ?? [], props.category).filter(
      (s) => !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q),
    )
    const rec = props.recommend ?? []
    return [...base].sort((a, b) => {
      const ea = props.store.enabled(a.name) ? 1 : 0
      const eb = props.store.enabled(b.name) ? 1 : 0
      if (ea !== eb) return eb - ea
      const ra = rec.includes(a.name) ? 1 : 0
      const rb = rec.includes(b.name) ? 1 : 0
      if (ra !== rb) return rb - ra
      return a.name.localeCompare(b.name)
    })
  })

  createEffect(() => {
    if (!props.open) {
      setSelected(null)
      return
    }
    setMounted(true)
    setView(props.initialView ?? "list")
  })

  createEffect(() => {
    if (!props.open || !props.focusSearch || view() !== "list") return
    queueMicrotask(() => searchRef?.focus())
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !props.open) return
      if (selected()) {
        setSelected(null)
        return
      }
      if (view() !== "list") {
        setView("list")
        return
      }
      props.onClose()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={mounted()}>
      <Portal>
        <div
          class="thesis-overlay"
          data-closed={props.open ? undefined : ""}
          aria-hidden={!props.open}
          onClick={props.onClose}
        />
        <div
          class="cs-cap-fullscreen cs-cap-fullscreen-skills"
          data-closed={props.open ? undefined : ""}
          aria-hidden={!props.open}
          onClick={(e) => e.stopPropagation()}
        >
          <header class="cs-cap-fullscreen-head">
            <h1>{props.title ?? language.t("home.capabilities.skills.title")}</h1>
            <button
              type="button"
              class="cs-cap-icon-btn"
              onClick={props.onClose}
              aria-label={language.t("common.close")}
            >
              <IconX size={16} strokeWidth={1.5} />
            </button>
          </header>

          <Show when={view() === "list"}>
            <div class="cs-cap-fullscreen-toolbar">
              <DropdownMenu open={categoryOpen()} onOpenChange={setCategoryOpen} modal={false}>
                <DropdownMenu.Trigger
                  class="cs-cap-category-btn cs-cap-category-btn-solid"
                  data-expanded={categoryOpen() ? "true" : "false"}
                >
                  <span>
                    {activeCategory()?.label ?? language.t("home.capabilities.skills.categoryAll")}
                    <Show when={activeCategory()?.count !== undefined}> ({activeCategory()?.count})</Show>
                  </span>
                  <IconChevronDown size={12} strokeWidth={1.5} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="cs-menu cs-cap-category-menu mt-1">
                    <For each={categories()}>
                      {(item) => (
                        <DropdownMenu.Item class="cs-menu-item" onSelect={() => props.onCategory(item.id)}>
                          <span>{item.label}</span>
                          <span class="cs-cap-category-count">{item.count}</span>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>

              <label class="cs-cap-search-field">
                <IconSearch size={13} strokeWidth={1.5} />
                <input
                  ref={searchRef}
                  type="search"
                  value={props.search}
                  onInput={(e) => props.onSearch(e.currentTarget.value)}
                  placeholder={language.t("home.capabilities.skills.search")}
                />
              </label>

              <HomeSkillsAddMenu
                onScratch={() => setView("scratch")}
                onUpload={() => fileInput?.click()}
                onGithub={() => setView("github")}
              />
            </div>
          </Show>

          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown"
            class="cs-cap-file-input"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ""
              if (!file) return
              void props.store.uploadSkill(file).then((ok) => {
                if (ok) setView("list")
              })
            }}
          />

          <div class="cs-cap-fullscreen-body">
            <Show when={view() === "scratch"}>
              <ScratchForm
                busy={props.store.busy()}
                onCancel={() => setView("list")}
                onCreate={(name, description, body) => {
                  void props.store.writeSkill(name, description, body).then((ok) => {
                    if (ok) setView("list")
                  })
                }}
              />
            </Show>

            <Show when={view() === "github"}>
              <GithubForm
                busy={props.store.busy()}
                onCancel={() => setView("list")}
                onInstall={(url) => {
                  void props.store.installGithub(url).then((ok) => {
                    if (ok) setView("list")
                  })
                }}
              />
            </Show>

            <Show when={view() === "list"}>
              <Show
                when={!props.store.skills.loading}
                fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.loading")}</div>}
              >
                <Show
                  when={filtered().length > 0}
                  fallback={<div class="cs-cap-empty">{language.t("home.capabilities.skills.empty")}</div>}
                >
                  <div class="cs-cap-skill-section-label">
                    Skills <span>{filtered().length}</span>
                  </div>
                  <div class="cs-cap-skill-grid cs-cap-skill-grid-full">
                    <For each={filtered()}>
                      {(skill) => (
                        <HomeSkillCard
                          skill={skill}
                          large
                          on={props.store.enabled(skill.name)}
                          onToggle={(v) => void props.store.toggle(skill.name, v)}
                          onOpen={() => setSelected(skill)}
                          onDelete={skillDeletable(skill) ? () => void props.store.remove(skill.name) : undefined}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>

          <Show when={selected()}>
            {(skill) => (
              <HomeSkillDetail
                skill={skill()}
                on={props.store.enabled(skill().name)}
                onToggle={(v) => void props.store.toggle(skill().name, v)}
                onDelete={
                  skillDeletable(skill())
                    ? () => {
                        void props.store.remove(skill().name).then((ok) => {
                          if (ok) setSelected(null)
                        })
                      }
                    : undefined
                }
                onClose={() => setSelected(null)}
              />
            )}
          </Show>
        </div>
      </Portal>
    </Show>
  )
}

export function previewRows(cols: number, total: number) {
  const cap = Math.max(cols * 2, cols)
  return Math.min(total, cap)
}
