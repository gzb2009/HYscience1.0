import { createEffect, createSignal, onMount, Show, type JSX } from "solid-js"
import { Dialog } from "@hysci/ui/dialog"
import { useDialog } from "@hysci/ui/context/dialog"
import { showToast } from "@hysci/ui/toast"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import type { Project } from "@hysci/sdk/v2/client"
import { projectMetaLocal } from "@/thesis/store/projectMetaLocal"
import { loadProjectAgentContext, saveProjectAgentContext } from "@/utils/projectMemory"
import { formatWorkingDirLabel } from "@/utils/projectWorkspace"
import { domainResultDir, resolveDomainWorkspace } from "@/utils/domainWorkspace"
import {
  isResultFolderName,
  migrateResultDirectory,
  normalizeResultFolderName,
  resultFolderName,
} from "@/utils/projectResult"
import { FolderPicker } from "@/thesis/FolderPicker"
import { IconX } from "@/thesis/shared/Icon"
import { projectDomainId, toResearch, type DomainId } from "@/domain/registry"

export type ProjectFormValues = {
  name: string
  description: string
  agentContext: string
  directory?: string
  resultFolderName?: string
  researchDomain: "general" | "biology" | "physics" | "ml"
  researchSubdomain?: string
  researchNotes: string
}

type Mode = "create" | "edit"

export function DialogProjectForm(props: {
  mode: Mode
  project?: Project
  initial?: Partial<ProjectFormValues>
  onCreate?: (values: ProjectFormValues) => void
  onSaved?: () => void
}): JSX.Element {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const sync = useGlobalSync()
  const fetchFn = platform.fetch ?? fetch

  const [name, setName] = createSignal(props.initial?.name ?? "")
  const [directory, setDirectory] = createSignal(props.initial?.directory ?? "")
  const [description, setDescription] = createSignal(props.initial?.description ?? "")
  const [resultName, setResultName] = createSignal(props.initial?.resultFolderName ?? "")
  const [resultTouched, setResultTouched] = createSignal(!!props.initial?.resultFolderName)
  const [agentContext, setAgentContext] = createSignal(props.initial?.agentContext ?? "")
  const [direction, setDirection] = createSignal<DomainId>(
    projectDomainId({
      research: {
        domain: props.initial?.researchDomain,
        subdomain: props.initial?.researchSubdomain,
      },
    }),
  )
  const [researchNotes, setResearchNotes] = createSignal(props.initial?.researchNotes ?? "")
  const [saving, setSaving] = createSignal(false)
  const [loading, setLoading] = createSignal(props.mode === "edit")
  // Folder picker must stay inside this dialog — dialog.show replaces the active dialog.
  const [picking, setPicking] = createSignal(false)

  onMount(async () => {
    if (props.mode !== "edit" || !props.project) return
    if (props.initial === undefined) {
      const local = projectMetaLocal.get(props.project.worktree)
      setDescription(props.project.description ?? local.description ?? "")
      setResultName(
        props.project.resultFolder ??
          (local.resultFolderName?.trim() || resultFolderName(props.project.worktree, props.project.name)),
      )
      setDirection(projectDomainId(props.project))
      setResearchNotes(props.project.research?.notes ?? "")
    }
    if (props.initial?.agentContext !== undefined) {
      setLoading(false)
      return
    }
    try {
      const ctx = await loadProjectAgentContext(sdk.url, props.project.worktree, fetchFn)
      setAgentContext(ctx)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  })

  const workspace = () => {
    const picked = directory().trim()
    if (props.mode === "edit") return props.project?.worktree ?? ""
    if (!picked) return ""
    return resolveDomainWorkspace({
      picked,
      domain: direction(),
      projects: sync.data.project,
    })
  }

  createEffect(() => {
    if (resultTouched()) return
    setResultName(normalizeResultFolderName(name(), props.project?.worktree ?? "Project"))
  })

  function pickDirectory() {
    setPicking(true)
  }

  async function persistEdit() {
    const project = props.project
    if (!project?.worktree) return
    setSaving(true)
    try {
      const nextName = name().trim()
      const nextResultName = normalizeResultFolderName(resultName(), nextName || project.worktree)
      if (!isResultFolderName(nextResultName)) return
      const oldResultName = resultFolderName(project.worktree, project.name)
      if (oldResultName !== nextResultName) {
        await migrateResultDirectory(sdk.url, fetchFn, project.worktree, oldResultName, nextResultName)
      }
      if (project.id && project.id !== "global") {
        await sdk.client.project.update({
          projectID: project.id,
          directory: project.worktree,
          name: nextName || undefined,
          description: description().trim() || undefined,
          resultFolder: nextResultName,
          research: {
            ...toResearch(direction()),
            notes: researchNotes().trim() || undefined,
          },
        } as any)
      }
      sync.project.meta(project.worktree, { name: nextName || undefined })
      projectMetaLocal.patch(project.worktree, {
        description: description().trim(),
        resultFolderName: nextResultName,
        name: nextName || undefined,
      })
      await saveProjectAgentContext(sdk.url, project.worktree, agentContext(), fetchFn)
      props.onSaved?.()
      dialog.close()
    } finally {
      setSaving(false)
    }
  }

  function submit() {
    if (props.mode === "create" && !directory().trim()) {
      showToast({
        variant: "error",
        title: language.t("dialog.project.new.directoryRequired"),
      })
      return
    }
    const packed = toResearch(direction())
    const values: ProjectFormValues = {
      name: name().trim(),
      description: description().trim(),
      agentContext: agentContext().trim(),
      directory: directory().trim() || undefined,
      resultFolderName: normalizeResultFolderName(resultName(), name().trim() || props.project?.worktree || "Project"),
      researchDomain: packed.domain,
      researchSubdomain: packed.subdomain,
      researchNotes: researchNotes().trim(),
    }
    if (props.mode === "create") {
      props.onCreate?.(values)
      dialog.close()
      return
    }
    void persistEdit()
  }

  const title =
    props.mode === "create" ? language.t("dialog.project.new.title") : language.t("dialog.project.edit.title")

  return (
    <Dialog size="large" transition class="cs-project-dialog">
      <div class="cs-project-form">
        <div class="cs-project-form-head">
          <h2 class="cs-project-form-title">{title}</h2>
          <button
            type="button"
            class="cs-project-form-close"
            title={language.t("common.close")}
            onClick={() => dialog.close()}
          >
            <IconX size={16} strokeWidth={1.5} />
          </button>
        </div>

        <Show when={!loading()} fallback={<div class="cs-project-form-loading">{language.t("common.loading")}</div>}>
          <Show when={picking()}>
            <div class="cs-project-form-body">
              <FolderPicker
                embedded
                onSelect={(result) => {
                  const dir = Array.isArray(result) ? result[0] : result
                  if (dir) setDirectory(dir)
                  setPicking(false)
                }}
              />
            </div>
          </Show>
          <Show when={!picking()}>
            <div class="cs-project-form-body thesis-scroll">
              <label class="cs-field">
                <span class="cs-field-label">{language.t("dialog.project.edit.name")}</span>
                <input
                  class="cs-field-input"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder={language.t("dialog.project.new.namePlaceholder")}
                />
              </label>

              <Show when={props.mode === "create"}>
                <div class="cs-field">
                  <span class="cs-field-label">{language.t("dialog.project.new.directory")}</span>
                  <span class="cs-field-hint">{language.t("dialog.project.new.directoryHint")}</span>
                  <div class="cs-field-row">
                    <input
                      class="cs-field-input"
                      value={directory()}
                      readOnly
                      placeholder={language.t("dialog.project.new.directoryPlaceholder")}
                    />
                    <button type="button" class="cs-btn-text cs-field-browse" onClick={pickDirectory}>
                      {language.t("dialog.project.new.browse")}
                    </button>
                  </div>
                  <Show when={directory()}>
                    <span class="cs-field-hint">{formatWorkingDirLabel(directory())}</span>
                  </Show>
                  <Show when={workspace()}>
                    <span class="cs-field-hint">
                      {language.t("dialog.project.new.workspacePreview")}: {formatWorkingDirLabel(workspace())}
                    </span>
                    <span class="cs-field-hint">
                      {language.t("dialog.project.new.resultPreview")}:{" "}
                      {formatWorkingDirLabel(domainResultDir(workspace()))}
                    </span>
                  </Show>
                </div>
              </Show>

              <section class="cs-field">
                <span class="cs-field-label">{language.t("dialog.project.research.label")}</span>
                <span class="cs-field-hint">{language.t("dialog.project.research.hint")}</span>
                <input
                  class="cs-field-input cs-field-input-locked"
                  value={language.t(`domain.${direction()}.title`)}
                  readOnly
                  tabindex={-1}
                />
                <textarea
                  class="cs-field-textarea"
                  rows={3}
                  value={researchNotes()}
                  onInput={(e) => setResearchNotes(e.currentTarget.value)}
                  placeholder={language.t("dialog.project.research.notes")}
                />
              </section>

              <label class="cs-field">
                <span class="cs-field-label">{language.t("dialog.project.new.description")}</span>
                <span class="cs-field-hint">{language.t("dialog.project.new.descriptionHint")}</span>
                <textarea
                  class="cs-field-textarea"
                  rows={3}
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                  placeholder={language.t("dialog.project.new.descriptionPlaceholder")}
                />
              </label>

              <Show when={props.mode === "edit"}>
                <label class="cs-field">
                  <span class="cs-field-label">{language.t("dialog.project.new.resultPreview")}</span>
                  <span class="cs-field-hint">{language.t("dialog.project.new.resultHint")}</span>
                  <input
                    class="cs-field-input cs-field-input-locked"
                    value={formatWorkingDirLabel(domainResultDir(props.project?.worktree ?? workspace()))}
                    readOnly
                    tabindex={-1}
                  />
                </label>
              </Show>

              <Show when={props.mode === "edit" && props.project?.worktree}>
                <label class="cs-field">
                  <span class="cs-field-label">Project root</span>
                  <span class="cs-field-hint">Workbench uses this root as the project boundary.</span>
                  <input class="cs-field-input" value={props.project!.worktree} readOnly />
                </label>
              </Show>

              <label class="cs-field">
                <span class="cs-field-label">{language.t("dialog.project.new.agentContext")}</span>
                <span class="cs-field-hint">{language.t("dialog.project.new.agentContextHint")}</span>
                <textarea
                  class="cs-field-textarea cs-field-textarea-lg"
                  rows={6}
                  value={agentContext()}
                  onInput={(e) => setAgentContext(e.currentTarget.value)}
                  placeholder={language.t("dialog.project.new.agentContextPlaceholder")}
                />
              </label>
            </div>
          </Show>
        </Show>

        <Show when={!picking()}>
          <div class="cs-project-form-foot">
            <button type="button" class="cs-btn-text" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </button>
            <button type="button" class="cs-btn-primary" disabled={saving() || loading()} onClick={submit}>
              {props.mode === "create" ? language.t("dialog.project.new.create") : language.t("common.save")}
            </button>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
