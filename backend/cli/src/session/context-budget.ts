import { Flag } from "../flag/flag"
import type { Provider } from "../provider/provider"
import type { MessageV2 } from "./message-v2"

export namespace ContextBudget {
  export const PROACTIVE_RATIO = 0.7
  export const PRUNE_PRESSURE_RATIO = 0.5

  export function outputMax(model: Provider.Model) {
    const flag = Flag.HYSCIENCE_EXPERIMENTAL_OUTPUT_TOKEN_MAX
    if (flag) return flag
    const context = model.limit.context
    if (!context) return 32_000
    const cap = model.limit.output || 32_000
    const adaptive = Math.floor(context * 0.25)
    return Math.min(cap, Math.max(8_000, adaptive))
  }

  export function usable(model: Provider.Model) {
    const context = model.limit.context
    if (!context) return 0
    const output = Math.min(model.limit.output || outputMax(model), outputMax(model)) || outputMax(model)
    return model.limit.input || context - output
  }

  export function usage(tokens: MessageV2.Assistant["tokens"]) {
    return tokens.input + tokens.cache.read + tokens.output
  }

  export function pressure(tokens: MessageV2.Assistant["tokens"], model: Provider.Model) {
    const budget = usable(model)
    if (!budget) return 0
    return usage(tokens) / budget
  }

  export function isOverflow(tokens: MessageV2.Assistant["tokens"], model: Provider.Model) {
    const budget = usable(model)
    if (!budget) return false
    return usage(tokens) > budget
  }

  export function isProactive(tokens: MessageV2.Assistant["tokens"], model: Provider.Model, ratio = PROACTIVE_RATIO) {
    if (isOverflow(tokens, model)) return false
    return pressure(tokens, model) >= ratio
  }

  export function shouldPrune(tokens: MessageV2.Assistant["tokens"], model: Provider.Model) {
    return pressure(tokens, model) >= PRUNE_PRESSURE_RATIO
  }
}
