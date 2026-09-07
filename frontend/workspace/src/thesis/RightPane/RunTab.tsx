import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { TerminalTab } from "@/thesis/RightPane/TerminalTab"
import { useHomeCompute } from "@/components/home-capabilities/HomeCompute"

export function RunTab(): JSX.Element {
  const language = useLanguage()
  const compute = useHomeCompute()
  const tier = () => compute.info()?.execution ?? "local"
  const label = () => {
    if (tier() === "ssh") return language.t("home.capabilities.compute.sshTitle")
    if (tier() === "cloud") return language.t("home.capabilities.compute.cloudTitle")
    return language.t("home.capabilities.compute.localTitle")
  }

  return (
    <section class="cs-run">
      <div class="cs-run-tier" data-tier={tier()}>
        <strong>{language.t("home.capabilities.compute.title")}</strong>
        <span>{label()}</span>
        <Show when={compute.info.loading}>
          <em>{language.t("home.capabilities.compute.loading")}</em>
        </Show>
      </div>
      <TerminalTab />
    </section>
  )
}
