import { createMemo, For, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { projectDomainId, type DomainId } from "@/domain/registry"
import { centerTabs } from "@/thesis/store/centerTabs"
import { assistantMessagesForLastTurn, collectResultFiles, customerFacingResultFiles } from "@hysci/ui/session-result"
import type { ToolPart } from "@hysci/sdk/v2/client"

const LIT = /websearch|webfetch|pubmed|literature|research-lookup|biorxiv|openalex|skill/i
const COMPUTE = /bash|notebook|rkernel|remote|python/i
const WRITE = /write|edit|multiedit/i

const TITLE: Record<
  DomainId,
  | "domain.imc.title"
  | "domain.single-cell.title"
  | "domain.spatial.title"
  | "domain.genomics.title"
  | "domain.general.title"
> = {
  imc: "domain.imc.title",
  "single-cell": "domain.single-cell.title",
  spatial: "domain.spatial.title",
  genomics: "domain.genomics.title",
  general: "domain.general.title",
}

function title(id: DomainId, t: ReturnType<typeof useLanguage>["t"]) {
  return t(TITLE[id])
}

export function NowTab(): JSX.Element {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const domain = createMemo(() => projectDomainId(sync.project))
  const locked = () => domain() !== "general"

  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const lastAssistant = createMemo(() => {
    const list = messages()
    for (let i = list.length - 1; i >= 0; i--) if (list[i].role === "assistant") return list[i]
  })

  const tools = createMemo((): ToolPart[] => {
    const msg = lastAssistant()
    if (!msg) return []
    return (sync.data.part[msg.id] ?? []).filter((part): part is ToolPart => part.type === "tool")
  })

  const activity = createMemo(() => {
    const running = tools().find((part) => part.state.status === "running")
    const part = running ?? tools()[tools().length - 1]
    if (!part) return language.t("rightpane.now.idle")
    const title = "title" in part.state ? part.state.title : undefined
    return title || part.tool
  })

  const stage = createMemo(() => {
    const names = tools()
      .map((part) => part.tool)
      .join(" ")
    if (LIT.test(names)) return language.t("rightpane.now.stageLit")
    if (COMPUTE.test(names)) return language.t("rightpane.now.stageCompute")
    if (WRITE.test(names)) return language.t("rightpane.now.stageWrite")
    return language.t("rightpane.now.stageTalk")
  })

  const files = createMemo(() => {
    const msgs = messages()
    return customerFacingResultFiles(
      collectResultFiles({
        assistantMessages: assistantMessagesForLastTurn(msgs) as import("@hysci/sdk/v2/client").AssistantMessage[],
        partsByMessage: sync.data.part,
        responseText: "",
      }),
    ).slice(0, 6)
  })

  return (
    <section class="cs-now">
      <div class="cs-now-chip" data-locked={locked() ? "true" : undefined}>
        <strong>{title(domain(), language.t)}</strong>
        <span>{locked() ? language.t("rightpane.now.locked") : language.t("rightpane.now.open")}</span>
      </div>
      <Show when={locked()}>
        <p class="cs-now-hint">{language.t("rightpane.now.switchHint")}</p>
      </Show>
      <dl class="cs-now-meta">
        <div>
          <dt>{language.t("rightpane.now.stage")}</dt>
          <dd>{stage()}</dd>
        </div>
        <div>
          <dt>{language.t("rightpane.now.doing")}</dt>
          <dd>{activity()}</dd>
        </div>
      </dl>
      <div class="cs-now-block">
        <h3>{language.t("rightpane.now.files")}</h3>
        <Show when={files().length > 0} fallback={<p class="cs-now-empty">{language.t("rightpane.now.filesEmpty")}</p>}>
          <ul>
            <For each={files()}>
              {(file) => (
                <li>
                  <button type="button" onClick={() => centerTabs.openFile(sdk.directory, file.path)}>
                    {file.name}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  )
}
