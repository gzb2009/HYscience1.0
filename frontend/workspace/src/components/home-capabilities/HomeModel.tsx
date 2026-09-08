import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { showToast } from "@hysci/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useProviders } from "@/hooks/use-providers"
import { domainById } from "@/domain/registry"
import { lastSelectedDomain } from "@/domain/store"
import { IconX } from "@/thesis/shared/Icon"
import { IconModel } from "./icons"

const BYOK = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", placeholder: "sk-…" },
  { id: "google", label: "Google", placeholder: "AIza…" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-…" },
  { id: "groq", label: "Groq", placeholder: "gsk-…" },
  { id: "mistral", label: "Mistral", placeholder: "…" },
  { id: "xai", label: "xAI", placeholder: "xai-…" },
  { id: "deepseek", label: "DeepSeek", placeholder: "sk-…" },
] as const

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(BYOK.map((p) => [p.id, p.label]))

function providerName(id: string) {
  return PROVIDER_LABEL[id] ?? id
}

function modelLabel(value: string | undefined, options: Array<{ value: string; label: string }>) {
  if (!value) return ""
  return options.find((o) => o.value === value)?.label ?? value
}

type KeySource = "env" | "config" | "custom" | "api"

function keySource(p: { id: string }): KeySource {
  return (p as { source?: KeySource }).source ?? "api"
}

function removable(p: { id: string }) {
  return keySource(p) === "api"
}

const SOURCE_KEY = {
  env: "home.capabilities.model.source.env",
  config: "home.capabilities.model.source.config",
  custom: "home.capabilities.model.source.custom",
} as const

function lockedKey(p: { id: string }) {
  const source = keySource(p)
  return SOURCE_KEY[source === "api" ? "config" : source]
}

export function HomeModelDock(): JSX.Element {
  const language = useLanguage()
  const params = useParams()
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const models = useModels()
  const providers = useProviders()
  const [open, setOpen] = createSignal(false)
  const [drawer, setDrawer] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [keyProvider, setKeyProvider] = createSignal<(typeof BYOK)[number]["id"]>(BYOK[0].id)
  const [keyValue, setKeyValue] = createSignal("")
  let root: HTMLDivElement | undefined

  onMount(() => {
    const onDoc = (event: MouseEvent) => {
      if (!open() || drawer()) return
      if (root?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open() && !drawer()) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    })
  })

  const options = createMemo(() =>
    models
      .list()
      .map((m) => ({ value: `${m.provider.id}/${m.id}`, label: `${m.name} · ${m.provider.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  )
  const connected = createMemo(() => providers.connected().filter((p) => p.id !== "hysci" || options().length > 0))
  const defaultModel = () => sync.data.config.model
  const subagentModel = () => sync.data.config.small_model
  const domain = createMemo(() => domainById(params.id) ?? domainById(lastSelectedDomain()) ?? domainById("general"))
  const ready = () => connected().length > 0 && options().length > 0

  const setDefaultModel = (value: string) => {
    if (!value) return
    void sync.updateConfig({ model: value })
  }
  const setSubagentModel = (value: string) => {
    if (!value) return
    void sync.updateConfig({ small_model: value })
  }

  const saveKey = async () => {
    const key = keyValue().trim()
    if (!key || busy()) return
    setBusy(true)
    try {
      await sdk.client.auth.set({ providerID: keyProvider(), auth: { type: "api", key } })
      await sdk.client.global.sync()
      setKeyValue("")
      setDrawer(false)
    } catch (err) {
      showToast({
        title: language.t("home.capabilities.model.saveFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async (providerID: string) => {
    if (!window.confirm(language.t("home.capabilities.model.removeConfirm", { name: providerName(providerID) }))) return
    setBusy(true)
    try {
      await sdk.client.auth.remove({ providerID })
      await sdk.client.global.sync()
    } catch (err) {
      showToast({
        title: language.t("home.capabilities.model.removeFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="cs-home-dock-slot" ref={root}>
        <Show when={open()}>
          <div class="cs-compute-dock-pop cs-model-dock-pop" role="dialog" aria-label={language.t("home.dock.model")}>
            <header class="cs-compute-dock-head">
              <div>
                <h2>{language.t("home.capabilities.model.title")}</h2>
                <p>{language.t("home.capabilities.model.dockLead")}</p>
              </div>
              <span class="cs-compute-dock-tier">
                {ready()
                  ? language.t("home.capabilities.model.ready", { count: String(options().length) })
                  : language.t("home.capabilities.model.needKey")}
              </span>
            </header>

            <section class="cs-model-dock-section">
              <span class="cs-model-dock-label">{language.t("home.capabilities.model.agent")}</span>
              <div class="cs-model-dock-agent">
                <strong>research</strong>
                <span>
                  {language.t("home.capabilities.model.agentHint", {
                    domain: language.t(`domain.${domain()!.id}.title`),
                  })}
                </span>
              </div>
            </section>

            <section class="cs-model-dock-section">
              <label class="cs-model-dock-label" for="cs-model-default">
                {language.t("home.capabilities.model.default")}
              </label>
              <select
                id="cs-model-default"
                class="cs-model-dock-select"
                value={defaultModel() ?? ""}
                disabled={options().length === 0}
                onChange={(e) => setDefaultModel(e.currentTarget.value)}
              >
                <Show when={!defaultModel()}>
                  <option value="">{language.t("home.capabilities.model.auto")}</option>
                </Show>
                <For each={options()}>{(o) => <option value={o.value}>{o.label}</option>}</For>
              </select>
              <span class="cs-model-dock-note">
                {defaultModel()
                  ? modelLabel(defaultModel(), options())
                  : language.t("home.capabilities.model.autoHint")}
              </span>
            </section>

            <section class="cs-model-dock-section">
              <label class="cs-model-dock-label" for="cs-model-small">
                {language.t("home.capabilities.model.subagent")}
              </label>
              <select
                id="cs-model-small"
                class="cs-model-dock-select"
                value={subagentModel() ?? ""}
                disabled={options().length === 0}
                onChange={(e) => setSubagentModel(e.currentTarget.value)}
              >
                <Show when={!subagentModel()}>
                  <option value="">{language.t("home.capabilities.model.auto")}</option>
                </Show>
                <For each={options()}>{(o) => <option value={o.value}>{o.label}</option>}</For>
              </select>
              <span class="cs-model-dock-note">{language.t("home.capabilities.model.subagentHint")}</span>
            </section>

            <section class="cs-model-dock-section">
              <div class="cs-model-dock-row-head">
                <span class="cs-model-dock-label">{language.t("home.capabilities.model.providers")}</span>
                <button
                  type="button"
                  class="cs-cap-drawer-link"
                  onClick={() => {
                    setOpen(false)
                    setDrawer(true)
                  }}
                >
                  {language.t("home.capabilities.model.addKey")}
                </button>
              </div>
              <Show
                when={connected().length > 0}
                fallback={<p class="cs-model-dock-note">{language.t("home.capabilities.model.noProvider")}</p>}
              >
                <For each={connected()}>
                  {(p) => (
                    <div class="cs-model-dock-provider">
                      <div>
                        <strong>{p.name}</strong>
                        <span>
                          {language.t("home.capabilities.model.modelsCount", {
                            count: String(Object.keys(p.models ?? {}).length),
                          })}
                        </span>
                      </div>
                      <Show when={p.id !== "hysci"}>
                        <Show
                          when={removable(p)}
                          fallback={
                            <span
                              class="cs-model-dock-note"
                              title={language.t("home.capabilities.model.lockedHint", {
                                source: language.t(lockedKey(p)),
                              })}
                            >
                              {language.t(lockedKey(p))}
                            </span>
                          }
                        >
                          <button
                            type="button"
                            class="cs-cap-drawer-link"
                            disabled={busy()}
                            onClick={() => void removeKey(p.id)}
                          >
                            {language.t("home.capabilities.remove")}
                          </button>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </section>
          </div>
        </Show>
        <button
          type="button"
          class="cs-home-dock-btn"
          data-open={open() ? "true" : undefined}
          data-ready={ready() ? "true" : undefined}
          aria-expanded={open()}
          aria-label={language.t("home.dock.model")}
          title={language.t("home.dock.modelHint")}
          onClick={() => setOpen((value) => !value)}
        >
          <IconModel size={20} />
          <span>{language.t("home.dock.model")}</span>
          <span class="cs-compute-dock-dot" data-tier={ready() ? "local" : "off"} />
        </button>
      </div>

      <Show when={drawer()}>
        <Portal>
          <div class="thesis-overlay" onClick={() => setDrawer(false)} />
          <aside class="thesis-drawer-right cs-cap-drawer" onClick={(e) => e.stopPropagation()}>
            <header class="cs-cap-drawer-head">
              <h3>{language.t("home.capabilities.model.addKey")}</h3>
              <button
                type="button"
                class="cs-cap-icon-btn"
                onClick={() => setDrawer(false)}
                aria-label={language.t("common.close")}
              >
                <IconX size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div class="cs-cap-drawer-body">
              <p class="cs-cap-drawer-hint">{language.t("home.capabilities.model.keyHint")}</p>
              <div class="cs-cap-drawer-section">
                <label>{language.t("home.capabilities.model.provider")}</label>
                <select value={keyProvider()} onChange={(e) => setKeyProvider(e.currentTarget.value as (typeof BYOK)[number]["id"])}>
                  <For each={BYOK}>{(p) => <option value={p.id}>{p.label}</option>}</For>
                </select>
                <label>{language.t("home.capabilities.model.apiKey")}</label>
                <input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  value={keyValue()}
                  onInput={(e) => setKeyValue(e.currentTarget.value)}
                  placeholder={BYOK.find((p) => p.id === keyProvider())?.placeholder}
                />
                <button
                  type="button"
                  class="cs-cap-drawer-action"
                  disabled={busy() || !keyValue().trim()}
                  onClick={() => void saveKey()}
                >
                  {language.t("home.capabilities.model.saveKey")}
                </button>
              </div>
            </div>
          </aside>
        </Portal>
      </Show>
    </>
  )
}
