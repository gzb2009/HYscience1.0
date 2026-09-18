export namespace StreamGuard {
  // Reasoning can run long on scientific tasks. Cap wall time below the
  // 300s provider request timeout so a stuck stream stays retryable.
  export const NO_USEFUL_PROGRESS_MS = 90_000
  export const TEXT_SETTLE_MS = 500
  export const MAX_REASONING_MS = 240_000
  export const MAX_REASONING_CHARS = 200_000

  export class TimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "StreamGuardTimeoutError"
    }
  }

  export class SettledError extends Error {
    constructor() {
      super("Answer completed and no further output arrived")
      this.name = "StreamGuardSettledError"
    }
  }

  export function create(now = () => Date.now()) {
    let progress = now()
    let settled: number | undefined
    let tools = 0
    const reasoning = new Map<string, { started: number; chars: number }>()

    const bump = () => {
      progress = now()
      settled = undefined
    }

    const check = () => {
      const current = now()
      for (const item of reasoning.values()) {
        if (current - item.started > MAX_REASONING_MS) {
          throw new TimeoutError("Reasoning exceeded the 240 second limit without completing")
        }
        if (item.chars > MAX_REASONING_CHARS) {
          throw new TimeoutError("Reasoning exceeded the 200,000 character limit without completing")
        }
      }
      if (tools === 0 && reasoning.size === 0 && settled !== undefined && current - settled > TEXT_SETTLE_MS) {
        throw new SettledError()
      }
      if (tools === 0 && current - progress > NO_USEFUL_PROGRESS_MS) {
        throw new TimeoutError("No tool call or final response progress for 90 seconds")
      }
    }

    return {
      reasoningStart(id: string) {
        reasoning.set(id, { started: now(), chars: 0 })
        bump()
      },
      reasoningDelta(id: string, text: string) {
        const item = reasoning.get(id)
        if (!item) return
        item.chars += text.length
        bump()
      },
      reasoningEnd(id: string) {
        reasoning.delete(id)
      },
      toolStart() {
        tools++
        bump()
      },
      toolEnd() {
        tools = Math.max(0, tools - 1)
        bump()
      },
      textProgress() {
        bump()
      },
      textEnd() {
        progress = now()
        settled = now()
      },
      check,
    }
  }
}
