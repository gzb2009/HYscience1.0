import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import type { DomainSwitch } from "./switch"

export function DomainSwitchCard(props: { hit: DomainSwitch }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const copy =
    props.hit.kind === "execute"
      ? language.t("domain.drift.execute", {
          current: props.hit.currentTitle,
          suggest: props.hit.suggestTitle,
        })
      : language.t("domain.drift.ask", {
          current: props.hit.currentTitle,
          suggest: props.hit.suggestTitle,
        })
  return (
    <aside class="cs-domain-switch" data-kind={props.hit.kind}>
      <p>{copy}</p>
      <div class="cs-domain-switch-actions">
        <button type="button" class="cs-btn-primary" onClick={() => navigate("/domains")}>
          {language.t("domain.drift.switch")}
        </button>
        <span class="cs-domain-switch-stay">{language.t("domain.drift.stay")}</span>
      </div>
    </aside>
  )
}
