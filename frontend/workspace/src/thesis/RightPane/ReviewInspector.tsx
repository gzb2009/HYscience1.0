import { createMemo, For, Show, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { uiStore } from "@/thesis/store/ui"
import { IconAlertCircle, IconBrain, IconCheckCircle, IconChevronRight, IconClock } from "@/thesis/shared/Icon"
import { reviewHistory, reviewState, selectedReview } from "@/utils/review"

export function ReviewInspector(props: { sessionID?: string }): JSX.Element {
  const sync = useSync()
  const navigate = useNavigate()
  const params = useParams()
  const records = createMemo(() => reviewHistory(props.sessionID ? (sync.data.review[props.sessionID] ?? []) : []))
  const selected = createMemo(() => selectedReview(records(), props.sessionID, uiStore.reviewSelection()))
  const color = createMemo(
    () => sync.data.agent.find((agent) => agent.name === selected()?.reviewer)?.color ?? "var(--color-text-faint)",
  )
  const duration = () => {
    const record = selected()
    if (!record) return ""
    const value = Math.max(0, record.time.completed - record.time.started)
    return value < 1_000 ? `${value}ms` : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
  }
  const tokenTotal = () => {
    const tokens = selected()?.tokens
    if (!tokens) return
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  }

  return (
    <section class="cs-review-inspector">
      <Show
        when={records().length > 0}
        fallback={
          <div class="cs-review-inspector-empty">
            <IconBrain size={20} strokeWidth={1.5} />
            <strong>No reviews yet</strong>
            <span>Structured reviewer results for this session will appear here.</span>
          </div>
        }
      >
        <div class="cs-review-history thesis-scroll" aria-label="Review history">
          <For each={records()}>
            {(record) => {
              const state = () => reviewState(record)
              return (
                <button
                  type="button"
                  class="cs-review-history-row"
                  data-selected={selected()?.messageID === record.messageID ? "true" : undefined}
                  data-tone={state().tone}
                  onClick={() =>
                    uiStore.setReviewSelection({ sessionID: record.sessionID, messageID: record.messageID })
                  }
                >
                  <span class="cs-review-history-dot" />
                  <span class="cs-review-history-label">{record.verdict}</span>
                  <span class="cs-review-history-meta">
                    {new Date(record.time.completed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              )
            }}
          </For>
        </div>

        <Show when={selected()}>
          {(record) => {
            const state = () => reviewState(record())
            return (
              <div class="cs-review-inspector-body thesis-scroll">
                <div class="cs-review-inspector-verdict" data-tone={state().tone}>
                  <span class="cs-review-inspector-verdict-icon">
                    <Show
                      when={record().verdict === "CLEAN"}
                      fallback={<IconAlertCircle size={18} strokeWidth={1.8} />}
                    >
                      <IconCheckCircle size={18} strokeWidth={1.8} />
                    </Show>
                  </span>
                  <div>
                    <strong>{state().blocked ? "Response blocked" : record().verdict}</strong>
                    <span>{record().mode} policy</span>
                  </div>
                </div>

                <Show when={record().summary ?? record().error}>
                  <p class="cs-review-inspector-summary">{record().summary ?? record().error}</p>
                </Show>

                <section class="cs-review-inspector-section">
                  <h3>Reviewer</h3>
                  <div class="cs-review-agent">
                    <span class="cs-review-agent-color" style={{ background: color() }} />
                    <div>
                      <strong>{record().reviewer}</strong>
                      <span>reviewing {record().agent}</span>
                    </div>
                    <Show when={record().reviewerSessionID}>
                      <button
                        type="button"
                        onClick={() => navigate(`/${params.dir}/session/${record().reviewerSessionID}`)}
                      >
                        Open session
                        <IconChevronRight size={12} strokeWidth={1.8} />
                      </button>
                    </Show>
                  </div>
                </section>

                <section class="cs-review-inspector-section">
                  <h3>Findings · {record().findings.length}</h3>
                  <Show
                    when={record().findings.length > 0}
                    fallback={<div class="cs-review-inspector-clear">No blocking findings.</div>}
                  >
                    <div class="cs-review-findings">
                      <For each={record().findings}>
                        {(finding, index) => (
                          <article class="cs-review-finding" data-severity={finding.severity}>
                            <header>
                              <span>{String(index() + 1).padStart(2, "0")}</span>
                              <strong>{finding.severity}</strong>
                            </header>
                            <p>{finding.message}</p>
                            <Show when={(finding.evidence ?? []).length > 0}>
                              <ul>
                                <For each={finding.evidence ?? []}>{(evidence) => <li>{evidence}</li>}</For>
                              </ul>
                            </Show>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>

                <section class="cs-review-inspector-section">
                  <h3>Run details</h3>
                  <dl class="cs-review-run-details">
                    <div>
                      <dt>Model</dt>
                      <dd>
                        {record().model.providerID}/{record().model.modelID}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <IconClock size={11} strokeWidth={1.7} />
                        Duration
                      </dt>
                      <dd>{duration()}</dd>
                    </div>
                    <Show when={tokenTotal() !== undefined}>
                      <div>
                        <dt>Tokens</dt>
                        <dd>{tokenTotal()?.toLocaleString()}</dd>
                      </div>
                    </Show>
                    <Show when={record().cost !== undefined}>
                      <div>
                        <dt>Cost</dt>
                        <dd>${record().cost?.toFixed(4)}</dd>
                      </div>
                    </Show>
                  </dl>
                </section>
              </div>
            )
          }}
        </Show>
      </Show>
    </section>
  )
}
