export namespace StreamGuard {
  // Reasoning tokens can continue arriving forever without moving the task forward.
  // Keep this shorter than the provider request timeout so the session becomes retryable.
  export const NO_USEFUL_PROGRESS_MS = 90_000
  export const MAX_REASONING_MS = 120_000
  export const MAX_REASONING_CHARS = 20_000

  export class TimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "StreamGuardTimeoutError"
    }
  }

  export function create(now = () => Date.now()) {
    let progress = now()
    let tools = 0
    const reasoning = new Map<string, { started: number; chars: number }>()

    const check = () => {
      const current = now()
      for (const item of reasoning.values()) {
        if (current - item.started > MAX_REASONING_MS) {
          throw new TimeoutError("Reasoning exceeded the 120 second limit without completing")
        }
        if (item.chars > MAX_REASONING_CHARS) {
          throw new TimeoutError("Reasoning exceeded the 20,000 character limit without completing")
        }
      }
      if (tools === 0 && current - progress > NO_USEFUL_PROGRESS_MS) {
        throw new TimeoutError("No tool call or final response progress for 90 seconds")
      }
    }

    return {
      reasoningStart(id: string) {
        reasoning.set(id, { started: now(), chars: 0 })
      },
      reasoningDelta(id: string, text: string) {
        const item = reasoning.get(id)
        if (!item) return
        item.chars += text.length
      },
      reasoningEnd(id: string) {
        reasoning.delete(id)
      },
      toolStart() {
        tools++
        progress = now()
      },
      toolEnd() {
        tools = Math.max(0, tools - 1)
        progress = now()
      },
      textProgress() {
        progress = now()
      },
      check,
    }
  }
}
