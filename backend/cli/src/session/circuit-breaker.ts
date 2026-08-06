/**
 * LLM Circuit Breaker — prevents runaway sessions by detecting loops and
 * excessive token consumption. Injects hybio warnings when thresholds
 * are crossed.
 */

import { Log } from "@/util/log"

export namespace CircuitBreaker {
  const log = Log.create({ service: "circuit-breaker" })

  export interface State {
    consecutiveIdentical: number
    lastAssistantText: string
    consecutiveErrors: number
    totalSteps: number
  }

  const MAX_IDENTICAL = 3
  const MAX_CONSECUTIVE_ERRORS = 5
  const WARN_STEPS = 50

  export function init(): State {
    return { consecutiveIdentical: 0, lastAssistantText: "", consecutiveErrors: 0, totalSteps: 0 }
  }

  export function update(
    state: State,
    messages: { info: { role: string }; parts: { type: string; text?: string; state?: { status?: string } }[] }[],
    step: number,
  ): { state: State; warning?: string } {
    state.totalSteps = step

    // Check for identical text loops
    const lastAssistant = messages.findLast((m) => m.info.role === "assistant")
    if (lastAssistant) {
      const textParts = lastAssistant.parts.filter((p) => p.type === "text")
      const currentText = textParts
        .map((p) => (p as any).text)
        .join(" ")
        .trim()
      if (currentText && currentText === state.lastAssistantText) {
        state.consecutiveIdentical++
      } else {
        state.consecutiveIdentical = 0
        state.lastAssistantText = currentText
      }
    }

    // Check for consecutive tool errors
    if (lastAssistant) {
      const toolParts = lastAssistant.parts.filter((p) => p.type === "tool")
      const allErrored = toolParts.length > 0 && toolParts.every((p) => (p as any).state?.status === "error")
      if (allErrored) {
        state.consecutiveErrors++
      } else {
        state.consecutiveErrors = 0
      }
    }

    // Generate warnings
    if (state.consecutiveIdentical >= MAX_IDENTICAL) {
      state.consecutiveIdentical = 0 // reset to avoid repeated warnings
      return {
        state,
        warning: `<circuit-breaker severity="loop">The assistant has produced ${MAX_IDENTICAL} consecutive identical responses. This likely indicates a reasoning loop. Pause and reconsider the approach. Try a different strategy or ask the user for clarification.</circuit-breaker>`,
      }
    }

    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      state.consecutiveErrors = 0
      return {
        state,
        warning: `<circuit-breaker severity="errors">${MAX_CONSECUTIVE_ERRORS} consecutive tool execution failures. The current approach is not working. Stop and reassess. Consider: checking environment setup, verifying tool parameters, or simplifying the task.</circuit-breaker>`,
      }
    }

    if (step === WARN_STEPS) {
      return {
        state,
        warning: `<circuit-breaker severity="steps">Step ${step} reached. If the task is not yet complete, consider whether the approach needs adjustment or if intermediate results are sufficient.</circuit-breaker>`,
      }
    }

    if (step >= 80) {
      return {
        state,
        warning: `<circuit-breaker severity="critical">Step ${step} reached — approaching maximum. Synthesize findings now and deliver results. Prioritize the most important conclusions.</circuit-breaker>`,
      }
    }

    return { state }
  }
}
