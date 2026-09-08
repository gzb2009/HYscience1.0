import { createMemo, type JSX } from "solid-js"
import { useSync } from "@/context/sync"

const GRID_SIZE = 9
const CELLS = Array.from({ length: GRID_SIZE }, (_, i) => i)

interface SessionStatusLightProps {
  sessionID: string
  running?: boolean
}

export function SessionStatusLight(props: SessionStatusLightProps): JSX.Element {
  const sync = useSync()
  const running = createMemo(() => {
    if (props.running !== undefined) return props.running
    const type = sync.data.session_status[props.sessionID]?.type
    return type === "busy" || type === "retry"
  })
  const flicker = () => running()

  return (
    <span class="cs-subtask-status-bar" aria-hidden="true">
      <span class="cs-subtask-cube-grid">
        {CELLS.map((cell) => (
          <span
            class={`cs-subtask-cube ${flicker() ? "cs-subtask-cube--flicker" : "cs-subtask-cube--static"}`}
            style={
              flicker()
                ? {
                    "animation-delay": `${(cell % 3) * 0.14 + Math.floor(cell / 3) * 0.08}s`,
                  }
                : undefined
            }
          />
        ))}
      </span>
    </span>
  )
}
