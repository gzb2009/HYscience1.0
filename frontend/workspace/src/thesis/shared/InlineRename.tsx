import { createEffect, createSignal, Show, type JSX } from "solid-js"

export function InlineRename(props: {
  value: string
  onSave: (next: string) => void | Promise<void>
  class?: string
  inputClass?: string
  placeholder?: string
  title?: string
}): JSX.Element {
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  let inputRef: HTMLInputElement | undefined

  function startEdit(e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    setDraft(props.value)
    setEditing(true)
  }

  createEffect(() => {
    if (!editing() || !inputRef) return
    inputRef.focus()
    inputRef.select()
  })

  async function commit() {
    const next = draft().trim()
    setEditing(false)
    if (!next || next === props.value) return
    await props.onSave(next)
  }

  function cancel() {
    setEditing(false)
  }

  return (
    <Show
      when={editing()}
      fallback={
        <span class={props.class} onDblClick={startEdit} title={props.title}>
          {props.value}
        </span>
      }
    >
      <input
        ref={inputRef}
        type="text"
        class={props.inputClass ?? "cs-inline-rename-input"}
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            void commit()
          }
          if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={() => void commit()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        placeholder={props.placeholder}
      />
    </Show>
  )
}
