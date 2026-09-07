import { For, Show, createResource, createSignal, onCleanup, onMount, type JSX, type ResourceReturn } from "solid-js"
import { Portal } from "solid-js/web"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { showToast } from "@hysci/ui/toast"
import { IconSettings, IconX } from "@/thesis/shared/Icon"
import { settingsApi } from "@/components/settings/api"
import { IconComputer, computeGraphs, type ComputeKind } from "./icons"

interface SshHost {
  id: string
  label: string
  host: string
  user?: string
  port?: number
}

interface Provider {
  id: string
  name: string
  connected: boolean
}

export interface LocalMachine {
  hostname: string
  platform: string
  release: string
  arch: string
  cpus: number
  cpu: string
  memoryTotal: number
  memoryFree: number
}

export interface ComputeInfo {
  execution?: "local" | "ssh" | "cloud"
  providers: Provider[]
  ssh_hosts: SshHost[]
  local?: LocalMachine
}

type LanguageT = ReturnType<typeof useLanguage>["t"]

function formatGib(bytes: number) {
  const n = bytes / 1024 ** 3
  return n >= 10 ? `${Math.round(n)} GB` : `${n.toFixed(1)} GB`
}

function platformLabel(platform: string) {
  if (platform === "darwin") return "macOS"
  if (platform === "win32") return "Windows"
  if (platform === "linux") return "Linux"
  return platform
}

function shortCpu(model: string) {
  const cleaned = model
    .replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > 36 ? `${cleaned.slice(0, 34)}…` : cleaned
}

function localRows(machine: LocalMachine, t: LanguageT) {
  return [
    { label: t("home.capabilities.compute.localHost"), value: machine.hostname },
    {
      label: t("home.capabilities.compute.localOs"),
      value: `${platformLabel(machine.platform)} · ${machine.arch}`,
    },
    {
      label: t("home.capabilities.compute.localCpu"),
      value: `${shortCpu(machine.cpu)} · ${t("home.capabilities.compute.localCores", { count: String(machine.cpus) })}`,
    },
    {
      label: t("home.capabilities.compute.localMemory"),
      value: `${formatGib(machine.memoryTotal)} · ${t("home.capabilities.compute.localMemoryFree", {
        free: formatGib(machine.memoryFree),
      })}`,
    },
  ]
}

export type HomeComputeStore = {
  info: ResourceReturn<ComputeInfo | undefined>[0]
  busy: () => boolean
  run: (fn: () => Promise<ComputeInfo>, failure: string) => Promise<void>
  call: <T>(path: string, init?: RequestInit) => Promise<T>
  setExecution: (execution: ComputeKind) => Promise<void>
  refetch: () => void
}

const tiers: ComputeKind[] = ["local", "ssh", "cloud"]

export function useHomeCompute(): HomeComputeStore {
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const fetchFn = () => platform.fetch ?? fetch
  const call = <T,>(path: string, init?: RequestInit) =>
    settingsApi<T>(sdk.url, fetchFn(), `/settings/compute${path}`, init)

  const [info, { mutate, refetch }] = createResource(() => call<ComputeInfo>(""))
  const [busy, setBusy] = createSignal(false)

  const run = async (fn: () => Promise<ComputeInfo>, failure: string) => {
    setBusy(true)
    try {
      mutate(await fn())
    } catch (err) {
      showToast({ title: failure, description: err instanceof Error ? err.message : String(err) })
      refetch()
    }
    setBusy(false)
  }

  const setExecution = (execution: ComputeKind) =>
    run(
      () => call<ComputeInfo>("/execution", { method: "PUT", body: JSON.stringify({ execution }) }),
      "Failed to set execution tier",
    )

  return { info, busy, run, call, setExecution, refetch }
}

export function computeSubtitle(kind: ComputeKind, info: ComputeInfo | undefined, t: LanguageT): string {
  if (kind === "local") {
    const machine = info?.local
    if (!machine) return t("home.capabilities.compute.localSub")
    return `${shortCpu(machine.cpu)} · ${formatGib(machine.memoryTotal)}`
  }
  if (kind === "ssh") {
    const host = info?.ssh_hosts[0]
    if (!host) return t("home.capabilities.compute.sshEmpty")
    const addr = `${host.user ? `${host.user}@` : ""}${host.host}${host.port ? `:${host.port}` : ""}`
    return `${host.label} · ${addr}`
  }
  const connected = info?.providers.filter((p) => p.connected) ?? []
  if (connected.length === 0) return t("home.capabilities.compute.cloudEmpty")
  return connected.map((p) => p.name).join(" · ")
}

export function HomeComputeItem(props: {
  kind: ComputeKind
  title: string
  scene: string
  subtitle: string
  active: boolean
  onSelect: () => void
  onSettings: () => void
}): JSX.Element {
  const Graph = computeGraphs[props.kind]
  return (
    <article
      class="cs-cap-compute-item"
      classList={{ "cs-cap-compute-item-active": props.active }}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          props.onSelect()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div class="cs-cap-compute-graph">
        <Graph />
      </div>
      <div class="cs-cap-compute-info">
        <strong>{props.title}</strong>
        <span class="cs-cap-compute-scene">{props.scene}</span>
        <span class="cs-cap-compute-sub">{props.subtitle}</span>
      </div>
      <div class="cs-cap-compute-side">
        <span class="cs-cap-compute-dot" classList={{ "cs-cap-compute-dot-off": !props.active }} />
        <button
          type="button"
          class="cs-cap-compute-settings-btn"
          title={props.title}
          onClick={(e) => {
            e.stopPropagation()
            props.onSettings()
          }}
        >
          <IconSettings size={13} strokeWidth={1.5} />
        </button>
      </div>
    </article>
  )
}

export function HomeComputeDrawer(props: {
  open: boolean
  kind: ComputeKind | undefined
  compute: HomeComputeStore
  onClose: () => void
}): JSX.Element {
  const language = useLanguage()
  const [hLabel, setHLabel] = createSignal("")
  const [hHost, setHHost] = createSignal("")
  const [hUser, setHUser] = createSignal("")
  const [hPort, setHPort] = createSignal("")
  const [keyValue, setKeyValue] = createSignal("")
  const [connecting, setConnecting] = createSignal<string>()

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) props.onClose()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const title = () => {
    const kind = props.kind
    if (kind === "local") return language.t("home.capabilities.compute.localTitle")
    if (kind === "ssh") return language.t("home.capabilities.compute.sshTitle")
    if (kind === "cloud") return language.t("home.capabilities.compute.cloudTitle")
    return ""
  }

  const saveHost = async () => {
    if (!hLabel().trim() || !hHost().trim()) return
    await props.compute.run(
      () =>
        props.compute.call<ComputeInfo>("/ssh", {
          method: "POST",
          body: JSON.stringify({
            label: hLabel().trim(),
            host: hHost().trim(),
            user: hUser().trim() || undefined,
            port: hPort().trim() ? Number(hPort().trim()) : undefined,
          }),
        }),
      "Failed to add SSH host",
    )
    setHLabel("")
    setHHost("")
    setHUser("")
    setHPort("")
  }

  const connectProvider = async (id: string) => {
    if (!keyValue().trim()) return
    await props.compute.run(
      () =>
        props.compute.call<ComputeInfo>(`/provider/${id}`, {
          method: "POST",
          body: JSON.stringify({ key: keyValue().trim() }),
        }),
      "Failed to connect provider",
    )
    setKeyValue("")
    setConnecting(undefined)
  }

  return (
    <Show when={props.open && props.kind}>
      {(kind) => (
        <Portal>
          <div class="thesis-overlay" onClick={props.onClose} />
          <aside class="thesis-drawer-right cs-cap-drawer" onClick={(e) => e.stopPropagation()}>
            <header class="cs-cap-drawer-head">
              <h3>{title()}</h3>
              <button
                type="button"
                class="cs-cap-icon-btn"
                onClick={props.onClose}
                aria-label={language.t("common.close")}
              >
                <IconX size={16} strokeWidth={1.5} />
              </button>
            </header>
            <div class="cs-cap-drawer-body">
              <Show when={kind() === "local"}>
                <p class="cs-cap-drawer-hint">{language.t("home.capabilities.compute.localHint")}</p>
                <Show
                  when={props.compute.info()?.local}
                  fallback={<p class="cs-cap-drawer-hint">{language.t("home.capabilities.compute.localLoading")}</p>}
                >
                  {(machine) => (
                    <div class="cs-cap-drawer-section">
                      <span class="cs-cap-drawer-label">{language.t("home.capabilities.compute.localMachine")}</span>
                      <dl class="cs-cap-drawer-stats">
                        <For each={localRows(machine(), language.t)}>
                          {(row) => (
                            <div class="cs-cap-drawer-stat">
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          )}
                        </For>
                      </dl>
                      <p class="cs-cap-drawer-note">
                        {(props.compute.info()?.execution ?? "local") === "local"
                          ? language.t("home.capabilities.compute.localActive")
                          : language.t("home.capabilities.compute.localInactive")}
                      </p>
                    </div>
                  )}
                </Show>
              </Show>

              <Show when={kind() === "ssh"}>
                <Show when={(props.compute.info()?.ssh_hosts.length ?? 0) > 0}>
                  <div class="cs-cap-drawer-section">
                    <span class="cs-cap-drawer-label">{language.t("home.capabilities.compute.hosts")}</span>
                    <For each={props.compute.info()?.ssh_hosts}>
                      {(h) => (
                        <div class="cs-cap-drawer-row">
                          <div>
                            <strong>{h.label}</strong>
                            <span>
                              {h.user ? `${h.user}@` : ""}
                              {h.host}
                              {h.port ? `:${h.port}` : ""}
                            </span>
                          </div>
                          <button
                            type="button"
                            class="cs-cap-drawer-link"
                            disabled={props.compute.busy()}
                            onClick={() =>
                              props.compute.run(
                                () => props.compute.call<ComputeInfo>(`/ssh/${h.id}`, { method: "DELETE" }),
                                "Failed to remove host",
                              )
                            }
                          >
                            {language.t("home.capabilities.remove")}
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <div class="cs-cap-drawer-section">
                  <span class="cs-cap-drawer-label">{language.t("home.capabilities.compute.addHost")}</span>
                  <label>{language.t("home.capabilities.compute.hostLabel")}</label>
                  <input value={hLabel()} onInput={(e) => setHLabel(e.currentTarget.value)} placeholder="lab-gpu-01" />
                  <label>{language.t("home.capabilities.compute.hostAddress")}</label>
                  <input value={hHost()} onInput={(e) => setHHost(e.currentTarget.value)} placeholder="10.0.0.4" />
                  <label>{language.t("home.capabilities.compute.hostUser")}</label>
                  <input value={hUser()} onInput={(e) => setHUser(e.currentTarget.value)} placeholder="research" />
                  <label>{language.t("home.capabilities.compute.hostPort")}</label>
                  <input value={hPort()} onInput={(e) => setHPort(e.currentTarget.value)} placeholder="22" />
                  <button
                    type="button"
                    class="cs-cap-drawer-action"
                    disabled={props.compute.busy()}
                    onClick={() => void saveHost()}
                  >
                    {language.t("home.capabilities.compute.saveHost")}
                  </button>
                </div>
              </Show>

              <Show when={kind() === "cloud"}>
                <div class="cs-cap-drawer-section">
                  <span class="cs-cap-drawer-label">{language.t("home.capabilities.compute.providers")}</span>
                  <For each={props.compute.info()?.providers}>
                    {(p) => (
                      <div class="cs-cap-drawer-provider">
                        <div class="cs-cap-drawer-row">
                          <div>
                            <strong>{p.name}</strong>
                            <span>
                              {p.connected
                                ? language.t("home.capabilities.compute.connected")
                                : language.t("home.capabilities.compute.notConnected")}
                            </span>
                          </div>
                          <Show when={p.connected}>
                            <button
                              type="button"
                              class="cs-cap-drawer-link"
                              disabled={props.compute.busy()}
                              onClick={() =>
                                props.compute.run(
                                  () => props.compute.call<ComputeInfo>(`/provider/${p.id}`, { method: "DELETE" }),
                                  "Failed to remove provider",
                                )
                              }
                            >
                              {language.t("home.capabilities.remove")}
                            </button>
                          </Show>
                        </div>
                        <Show when={!p.connected && connecting() === p.id}>
                          <input
                            type="password"
                            value={keyValue()}
                            onInput={(e) => setKeyValue(e.currentTarget.value)}
                            placeholder="API key"
                          />
                          <button
                            type="button"
                            class="cs-cap-drawer-action"
                            disabled={props.compute.busy() || !keyValue().trim()}
                            onClick={() => void connectProvider(p.id)}
                          >
                            {language.t("home.capabilities.compute.connect")}
                          </button>
                        </Show>
                        <Show when={!p.connected && connecting() !== p.id}>
                          <button type="button" class="cs-cap-drawer-link" onClick={() => setConnecting(p.id)}>
                            {language.t("home.capabilities.compute.connect")}
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </aside>
        </Portal>
      )}
    </Show>
  )
}

export function HomeComputeDock(): JSX.Element {
  const language = useLanguage()
  const compute = useHomeCompute()
  const [open, setOpen] = createSignal(false)
  const [drawerKind, setDrawerKind] = createSignal<ComputeKind>()
  let root: HTMLDivElement | undefined

  onMount(() => {
    const onDoc = (event: MouseEvent) => {
      if (!open() || drawerKind()) return
      if (root?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open() && !drawerKind()) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    })
  })

  const active = () => compute.info()?.execution ?? "local"
  const activeTitle = () =>
    active() === "local"
      ? language.t("home.capabilities.compute.localTitle")
      : active() === "ssh"
        ? language.t("home.capabilities.compute.sshTitle")
        : language.t("home.capabilities.compute.cloudTitle")

  return (
    <>
      <div class="cs-home-dock-slot" ref={root}>
        <Show when={open()}>
          <div class="cs-compute-dock-pop" role="dialog" aria-label={language.t("home.capabilities.compute.title")}>
            <header class="cs-compute-dock-head">
              <div>
                <h2>{language.t("home.capabilities.compute.title")}</h2>
                <p>{language.t("home.capabilities.compute.dockLead")}</p>
              </div>
              <span class="cs-compute-dock-tier">{activeTitle()}</span>
            </header>
            <Show
              when={!compute.info.loading}
              fallback={<div class="cs-cap-empty">{language.t("home.capabilities.compute.loading")}</div>}
            >
              <div class="cs-cap-compute-stack">
                <For each={tiers}>
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
                      active={active() === kind}
                      onSelect={() => void compute.setExecution(kind)}
                      onSettings={() => {
                        setOpen(false)
                        setDrawerKind(kind)
                      }}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <button
          type="button"
          class="cs-home-dock-btn"
          data-open={open() ? "true" : undefined}
          data-tier={active()}
          aria-expanded={open()}
          aria-label={`${language.t("home.dock.computer")} · ${activeTitle()}`}
          title={`${language.t("home.dock.computer")} · ${activeTitle()}`}
          onClick={() => setOpen((value) => !value)}
        >
          <IconComputer size={20} />
          <span>{language.t("home.dock.computer")}</span>
          <span class="cs-compute-dock-dot" data-tier={active()} />
        </button>
      </div>
      <HomeComputeDrawer
        open={!!drawerKind()}
        kind={drawerKind()}
        compute={compute}
        onClose={() => setDrawerKind(undefined)}
      />
    </>
  )
}
