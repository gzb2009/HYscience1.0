import { createMemo, For, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { centerTabs } from "@/thesis/store/centerTabs"
import { ReviewInspector } from "@/thesis/RightPane/ReviewInspector"
import {
  assistantMessagesForLastTurn,
  collectResultFiles,
  customerFacingResultFiles,
} from "@hysci/ui/session-result"

export function EvidenceTab(props: { sessionID?: string }): JSX.Element {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const sessionID = () => props.sessionID ?? params.id
  const files = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const msgs = sync.data.message[id] ?? []
    return customerFacingResultFiles(
      collectResultFiles({
        assistantMessages: assistantMessagesForLastTurn(msgs) as import("@hysci/sdk/v2/client").AssistantMessage[],
        partsByMessage: sync.data.part,
        responseText: "",
      }),
    )
  })

  return (
    <section class="cs-evidence">
      <div class="cs-now-block">
        <h3>{language.t("rightpane.evidence.files")}</h3>
        <Show
          when={files().length > 0}
          fallback={<p class="cs-now-empty">{language.t("rightpane.evidence.filesEmpty")}</p>}
        >
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
      <ReviewInspector sessionID={sessionID()} />
    </section>
  )
}
