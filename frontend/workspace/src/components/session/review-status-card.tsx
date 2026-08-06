import type { ReviewRecord } from "@hysci/sdk/v2/client"
import { Show, type JSX } from "solid-js"
import { reviewState } from "@/utils/review"
import { IconAlertCircle, IconBrain, IconCheckCircle, IconChevronRight } from "@/thesis/shared/Icon"

export function ReviewStatusCard(props: { record: ReviewRecord; onInspect: () => void }): JSX.Element {
  const state = () => reviewState(props.record)
  const title = () => {
    if (state().blocked) return "Response blocked by review"
    if (props.record.verdict === "FLAGGED") return "Review flagged this response"
    if (props.record.verdict === "ERROR") return "Review could not be completed"
    return "Reviewed · clean"
  }
  const summary = () => props.record.summary ?? props.record.error ?? props.record.findings[0]?.message

  return (
    <div
      class="cs-review-status"
      data-tone={state().tone}
      role={state().blocked ? "alert" : undefined}
      data-message-id={props.record.messageID}
    >
      <span class="cs-review-status-icon" aria-hidden="true">
        <Show when={props.record.verdict === "CLEAN"} fallback={<IconAlertCircle size={15} strokeWidth={1.8} />}>
          <IconCheckCircle size={15} strokeWidth={1.8} />
        </Show>
      </span>
      <div class="cs-review-status-copy">
        <span class="cs-review-status-title">{title()}</span>
        <Show when={summary() && props.record.verdict !== "CLEAN"}>
          <span class="cs-review-status-summary">{summary()}</span>
        </Show>
        <span class="cs-review-status-meta">
          <IconBrain size={11} strokeWidth={1.7} />
          {props.record.reviewer}
          <Show when={props.record.findings.length > 0}>
            <span>
              · {props.record.findings.length} finding{props.record.findings.length === 1 ? "" : "s"}
            </span>
          </Show>
          <Show when={state().blocked}>
            <span>· enforce</span>
          </Show>
        </span>
      </div>
      <button type="button" class="cs-review-status-action" onClick={props.onInspect}>
        Inspect
        <IconChevronRight size={12} strokeWidth={1.8} />
      </button>
    </div>
  )
}
