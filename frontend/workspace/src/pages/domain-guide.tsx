import { For, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@hysci/ui/context/dialog"
import { DialogSettings } from "@/components/dialog-settings"
import { DisconnectedPanel } from "@/thesis/DisconnectedPanel"
import { CommandPalette } from "@/thesis/CommandPalette"
import { HelpOverlay } from "@/thesis/HelpOverlay"
import { HomeParticles } from "@/thesis/HomeParticles"
import { ToastContainer } from "@/thesis/Toast"
import { uiStore } from "@/thesis/store/ui"
import { AgentIcon } from "@/thesis/shared/AgentIcon"
import { DOMAINS, buildDomainSkillPreset, type DomainId } from "@/domain/registry"
import { rememberDomain } from "@/domain/store"
import { HomeUserMenu } from "@/components/home-user-menu"
import { HomeSkillsBlock } from "@/components/home-capabilities/HomeCapabilities"
import { HomeDock } from "@/components/home-capabilities/HomeDock"
import { loadSkillCatalog } from "@/utils/skillCatalog"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

export default function DomainGuide(): JSX.Element {
  const language = useLanguage()
  const navigate = useNavigate()
  const dialog = useDialog()
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const [skillDomain, setSkillDomain] = createSignal<DomainId>()
  const [skillsOpen, setSkillsOpen] = createSignal(false)
  const [seeded, setSeeded] = createSignal(false)

  createEffect(() => {
    if (seeded()) return
    setSeeded(true)
    const existing =
      (sync.data.config as { domainSkill?: Record<string, Record<string, "allow" | "deny">> }).domainSkill ?? {}
    void loadSkillCatalog(sdk).then(async (list) => {
      const names = list.map((item) => item.name)
      if (names.length === 0) return
      const preset = buildDomainSkillPreset(names)
      const next = { ...preset, ...existing }
      let changed = false
      for (const item of DOMAINS) {
        const map = { ...(next[item.id] ?? preset[item.id]) }
        if (!existing[item.id]) changed = true
        if (map["grill-me"] !== "allow") {
          map["grill-me"] = "allow"
          changed = true
        }
        next[item.id] = map
      }
      if (!changed) return
      const update = await sdk.client.global.config.update({ config: { domainSkill: next } as never })
      if (update.error) return
      sync.set("config", "domainSkill" as never, next)
    })
  })

  const skillTitle = createMemo(() => {
    const id = skillDomain()
    if (!id) return language.t("home.capabilities.skills.title")
    return language.t("domain.guide.skillsTitle", { domain: language.t(`domain.${id}.title`) })
  })
  const recommend = createMemo(() => DOMAINS.find((item) => item.id === skillDomain())?.skills ?? [])

  function enter(id: DomainId) {
    rememberDomain(id)
    navigate(`/domain/${id}`)
  }

  function configure(id: DomainId) {
    setSkillDomain(id)
    setSkillsOpen(true)
  }

  return (
    <div class="thesis-root cs-home">
      <ToastContainer />
      <HelpOverlay open={uiStore.helpOpen()} onClose={() => uiStore.setHelpOpen(false)} />
      <CommandPalette open={uiStore.paletteOpen()} onClose={() => uiStore.setPaletteOpen(false)} />
      <DisconnectedPanel />

      <main class="thesis-scroll cs-home-main">
        <HomeParticles />
        <div class="cs-workbench-inner">
          <div class="cs-workbench-header">
            <div class="cs-workbench-brand-block">
              <AgentIcon
                class="cs-workbench-mark"
                size={72}
                style={{
                  "--agent-icon-ink": "var(--color-text)",
                  "--agent-icon-paper": "var(--color-surface-solid, var(--color-bg))",
                }}
              />
              <div class="cs-workbench-copy">
                <h1 class="cs-workbench-brand">HYscience</h1>
                <p class="cs-workbench-tagline">{language.t("domain.guide.lead")}</p>
              </div>
            </div>
            <div class="cs-workbench-actions">
              <HomeUserMenu onSettings={() => dialog.show(() => <DialogSettings />)} />
            </div>
          </div>

          <section class="cs-domain-guide">
            <h2 class="cs-domain-guide-title">{language.t("domain.guide.title")}</h2>
            <div class="cs-domain-guide-grid">
              <For each={DOMAINS}>
                {(item) => (
                  <article class="cs-domain-card" data-active={skillDomain() === item.id ? "true" : undefined}>
                    <h3 class="cs-domain-card-title">{language.t(`domain.${item.id}.title`)}</h3>
                    <ul class="cs-domain-card-points">
                      <li>{language.t(`domain.${item.id}.point1`)}</li>
                      <li>{language.t(`domain.${item.id}.point2`)}</li>
                      <li>{language.t(`domain.${item.id}.point3`)}</li>
                    </ul>
                    <div class="cs-domain-card-actions">
                      <button type="button" class="cs-btn-primary" onClick={() => enter(item.id)}>
                        {language.t("domain.guide.enter")}
                      </button>
                      <button type="button" class="cs-btn-ghost" onClick={() => configure(item.id)}>
                        {language.t("domain.guide.skills")}
                      </button>
                    </div>
                  </article>
                )}
              </For>
            </div>

            <HomeSkillsBlock
              preview={false}
              domainId={() => skillDomain()}
              title={skillTitle()}
              recommend={recommend()}
              open={skillsOpen()}
              onOpenChange={setSkillsOpen}
            />
          </section>
        </div>
      </main>
      <HomeDock
        embedSkills={false}
        skillsOpen={skillsOpen()}
        onSkillsClick={() => {
          setSkillDomain(undefined)
          setSkillsOpen(true)
        }}
      />
    </div>
  )
}
