import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "./icon"
import { useI18n } from "../context/i18n"
import { optionRecommended } from "./session-result"

export type ChoiceOption = {
  label: string
  description?: string
}

function descriptionLines(text?: string) {
  if (!text?.trim()) return []
  return text.split("\n").map((line) => {
    const value = line.trim()
    if (/^(?:pros|优点)[:：]/i.test(value)) return { tone: "pro" as const, text: value }
    if (/^(?:cons|缺点)[:：]/i.test(value)) return { tone: "con" as const, text: value }
    return { tone: "body" as const, text: value }
  })
}

function sameAnswers(current: string | undefined, next: string[]) {
  const left = (current ?? "")
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join("、")
  const right = [...next]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join("、")
  return left.length > 0 && left === right
}

export function ChoiceCard(props: {
  question: string
  options: ChoiceOption[]
  recommendation?: string
  reason?: string
  answer?: string
  multiple?: boolean
  review?: boolean
  onPick: (answers: string[]) => void
  onSkip?: () => void
  onAgentDecide?: () => void
}) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(!props.review)
  const [custom, setCustom] = createSignal("")
  const [picked, setPicked] = createSignal<string[]>(
    props.answer
      ? props.answer
          .split(/[、,]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  )

  const title = createMemo(() => props.question)
  const chosen = createMemo(() => props.answer || picked().join("、"))
  const recLabel = createMemo(() => i18n.t("ui.question.recommended"))

  const commit = (answers: string[]) => {
    if (props.review && sameAnswers(props.answer, answers)) {
      setOpen(false)
      return
    }
    setPicked(answers)
    props.onPick(answers)
    if (props.review) setOpen(false)
  }

  const pick = (label: string) => {
    if (props.multiple) {
      const next = picked().includes(label) ? picked().filter((item) => item !== label) : [...picked(), label]
      setPicked(next)
      return
    }
    commit([label])
  }

  const submitCustom = () => {
    const value = custom().trim()
    if (!value) return
    commit([value])
    setCustom("")
  }

  return (
    <div
      data-component="choice-card"
      data-open={open() ? "true" : undefined}
      data-review={props.review ? "true" : undefined}
    >
      <Show
        when={open()}
        fallback={
          <div data-slot="choice-collapsed">
            <div data-slot="choice-collapsed-copy">
              <div data-slot="choice-question">{title()}</div>
              <Show when={chosen()}>
                <div data-slot="choice-answer">{chosen()}</div>
              </Show>
            </div>
            <button
              type="button"
              data-slot="choice-edit"
              aria-label={i18n.t("ui.question.action.edit")}
              title={i18n.t("ui.question.action.edit")}
              onClick={() => setOpen(true)}
            >
              <Icon name="pencil-line" size="small" />
            </button>
          </div>
        }
      >
        <div data-slot="choice-sheet">
          <Show when={props.review}>
            <div data-slot="choice-sheet-bar">
              <span data-slot="choice-sheet-hint">{i18n.t("ui.question.revise.hint")}</span>
              <button
                type="button"
                data-slot="choice-sheet-close"
                aria-label={i18n.t("ui.common.close")}
                onClick={() => setOpen(false)}
              >
                <Icon name="close-small" size="small" />
              </button>
            </div>
          </Show>
          <div data-slot="choice-sheet-title">
            {title()}
            <Show when={props.reason}>
              <span data-slot="choice-reason">（{props.reason}）</span>
            </Show>
            <Show when={props.multiple}>
              <span data-slot="choice-multi">{i18n.t("ui.question.multiHint")}</span>
            </Show>
          </div>
          <div data-slot="choice-options">
            <For each={props.options}>
              {(opt, index) => {
                const recommended = () => optionRecommended(opt.label, props.recommendation)
                const active = () => picked().includes(opt.label)
                const tagged = () => /\(\s*Recommended\s*\)|（推荐）|\(推荐\)/.test(opt.label)
                return (
                  <button
                    type="button"
                    data-slot="choice-option"
                    data-recommended={recommended() ? "true" : undefined}
                    data-active={active() ? "true" : undefined}
                    onClick={() => pick(opt.label)}
                  >
                    <span data-slot="choice-index">{index() + 1}</span>
                    <span data-slot="choice-option-body">
                      <span data-slot="choice-option-label">
                        {opt.label}
                        <Show when={recommended() && !tagged()}>
                          <span data-slot="choice-rec"> ({recLabel()})</span>
                        </Show>
                      </span>
                      <For each={descriptionLines(opt.description)}>
                        {(line) => (
                          <span data-slot="choice-option-note" data-tone={line.tone}>
                            {line.text}
                          </span>
                        )}
                      </For>
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
          <button
            type="button"
            data-slot="choice-utility"
            onClick={() => {
              if (props.review) {
                commit([i18n.t("ui.question.skip.default")])
                return
              }
              ;(props.onAgentDecide ?? props.onSkip)?.()
            }}
          >
            <Icon name="sliders" size="small" />
            <span>{i18n.t("ui.question.action.agentDecide")}</span>
          </button>
          <form
            data-slot="choice-custom"
            onSubmit={(event) => {
              event.preventDefault()
              submitCustom()
            }}
          >
            <Icon name="pencil-line" size="small" />
            <input
              type="text"
              placeholder={i18n.t("ui.question.custom.placeholder")}
              value={custom()}
              onInput={(event) => setCustom(event.currentTarget.value)}
            />
            <Show when={props.multiple}>
              <button
                type="button"
                data-slot="choice-continue"
                disabled={picked().length === 0}
                onClick={() => {
                  if (picked().length === 0) return
                  commit(picked())
                }}
              >
                {i18n.t("ui.common.submit")}
              </button>
            </Show>
            <button
              type="button"
              data-slot="choice-skip"
              onClick={() => {
                props.onSkip?.()
                if (props.review) setOpen(false)
              }}
            >
              {i18n.t("ui.question.action.skip")}
            </button>
          </form>
        </div>
      </Show>
    </div>
  )
}
