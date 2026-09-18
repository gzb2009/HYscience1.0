import { createSignal, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { HomeSkillsBlock } from "./HomeCapabilities"
import { HomeComputeDock } from "./HomeCompute"
import { HomeModelDock } from "./HomeModel"
import { IconSkillsStack } from "./icons"

export function HomeDock(props: {
  embedSkills?: boolean
  skillsOpen?: boolean
  onSkillsClick?: () => void
}): JSX.Element {
  const language = useLanguage()
  const [skillsOpen, setSkillsOpen] = createSignal(false)
  const embed = () => props.embedSkills !== false
  const opened = () => props.skillsOpen ?? skillsOpen()

  function openSkills() {
    if (props.onSkillsClick) {
      props.onSkillsClick()
      return
    }
    setSkillsOpen(true)
  }

  return (
    <>
      <Portal>
        <div class="cs-home-dock" data-testid="home-dock" role="toolbar" aria-label={language.t("home.dock.label")}>
          <button
            type="button"
            class="cs-home-dock-btn"
            data-open={opened() ? "true" : undefined}
            aria-expanded={opened()}
            aria-label={language.t("home.dock.skill")}
            title={language.t("home.dock.skillHint")}
            onClick={openSkills}
          >
            <IconSkillsStack size={20} />
            <span>{language.t("home.dock.skill")}</span>
          </button>
          <HomeModelDock />
          <HomeComputeDock />
        </div>
      </Portal>
      <Show when={embed()}>
        <HomeSkillsBlock
          preview={false}
          open={skillsOpen()}
          onOpenChange={setSkillsOpen}
          title={language.t("home.capabilities.skills.title")}
        />
      </Show>
    </>
  )
}
