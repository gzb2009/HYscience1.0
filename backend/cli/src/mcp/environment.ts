import type { Config } from "@/config/config"
import { ProcessPolicy } from "@/process/policy"

export function localEnvironment(input: {
  command: string
  config: Config.McpLocal
  source?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}) {
  return ProcessPolicy.environment({
    source: input.source ?? process.env,
    platform: input.platform,
    mode: input.config.environmentMode ?? "safe",
    overrides: {
      ...(input.command === "hyscience" ? { BUN_BE_BUN: "1" } : {}),
      ...input.config.environment,
    },
  })
}
