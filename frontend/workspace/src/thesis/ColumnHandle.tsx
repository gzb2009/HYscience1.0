import { createSignal, type JSX } from "solid-js"
import { clampColumn } from "@/thesis/column-width"

export function ColumnHandle(props: {
  edge: "start" | "end"
  value: number
  min: number
  max: number
  reserved: () => number
  label: string
  hint: string
  onInput: (width: number) => void
  onCommit: (width: number) => void
  onReset: () => void
}): JSX.Element {
  const [active, setActive] = createSignal(false)
  const drag = { x: 0, width: 0, live: false }

  function nextWidth(clientX: number) {
    const delta = props.edge === "end" ? clientX - drag.x : drag.x - clientX
    return clampColumn(drag.width + delta, props.min, props.max, props.reserved(), window.innerWidth)
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    drag.x = event.clientX
    drag.width = props.value
    drag.live = true
    setActive(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    document.body.classList.add("cs-col-resizing")
  }

  function pointerMove(event: PointerEvent) {
    if (!drag.live) return
    props.onInput(nextWidth(event.clientX))
  }

  function pointerUp(event: PointerEvent) {
    if (!drag.live) return
    drag.live = false
    setActive(false)
    document.body.classList.remove("cs-col-resizing")
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    props.onCommit(nextWidth(event.clientX))
  }

  function onKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      const next = clampColumn(
        props.value + (props.edge === "end" ? -step : step),
        props.min,
        props.max,
        props.reserved(),
        window.innerWidth,
      )
      props.onCommit(next)
      return
    }
    if (event.key === "ArrowRight") {
      event.preventDefault()
      const next = clampColumn(
        props.value + (props.edge === "end" ? step : -step),
        props.min,
        props.max,
        props.reserved(),
        window.innerWidth,
      )
      props.onCommit(next)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      props.onReset()
    }
  }

  return (
    <div
      class="cs-col-handle"
      data-edge={props.edge}
      data-active={active() ? "true" : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      title={props.hint}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      tabindex="0"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDblClick={() => props.onReset()}
      onKeyDown={onKey}
    >
      <span class="cs-col-handle-grip" aria-hidden="true" />
    </div>
  )
}
