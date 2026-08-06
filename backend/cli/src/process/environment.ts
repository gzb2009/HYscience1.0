import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { HYscience } from "@/hyscience"
import { Log } from "@/util/log"
import { ProcessPolicy } from "./policy"

export namespace ProcessEnvironment {
  const log = Log.create({ service: "process-environment" })
  const warned = new Set<string>()
  const DEFAULT_BASH_TIMEOUT = Flag.HYSCIENCE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS ?? 120_000

  function warning(profile: ProcessPolicy.Profile, kind: "inherit" | "byok", providers?: string[]) {
    const key = `${profile}:${kind}:${providers?.join(",") ?? ""}`
    if (warned.has(key)) return
    warned.add(key)
    if (kind === "inherit") {
      log.warn("subprocess profile inherits the full host environment", {
        profile,
        migration: `Remove process.${profile}.environmentMode = "inherit" and declare required variables under environment.`,
      })
      return
    }
    log.warn("subprocess profile exposes user-owned provider credentials", {
      profile,
      providers,
    })
  }

  export async function resolve(
    profile: "bash" | "notebook" | "remote" | "pty",
    overrides?: Record<string, string>,
    source: NodeJS.ProcessEnv = process.env,
  ) {
    const config = await Config.get()
    const settings = config.process?.[profile]
    const mode = settings?.environmentMode ?? "safe"
    const providers = settings?.byokProviders ?? []
    if (mode === "inherit") warning(profile, "inherit")
    if (providers.length > 0) warning(profile, "byok", providers)
    return HYscience.subprocessEnv(source, {
      profile,
      mode,
      overrides: {
        ...settings?.environment,
        ...overrides,
      },
      byokProviders: providers,
    })
  }

  export async function mode(profile: "bash" | "notebook" | "remote" | "pty") {
    const config = await Config.get()
    return config.process?.[profile]?.environmentMode ?? "safe"
  }

  export async function bashTimeout(requested?: number) {
    const config = await Config.get()
    return ProcessPolicy.timeout({
      requested,
      configured: config.process?.bash?.timeout,
      fallback: DEFAULT_BASH_TIMEOUT,
    })
  }
}
