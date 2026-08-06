import { Config } from "@/config/config"
import { HYscience } from "@/hyscience"
import { Log } from "@/util/log"
import { ProcessPolicy } from "./policy"

export namespace ProcessEnvironment {
  const log = Log.create({ service: "process-environment" })
  const warned = new Set<string>()

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
    profile: "bash" | "notebook" | "remote",
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

  export async function bashTimeout() {
    const config = await Config.get()
    return config.process?.bash?.timeout
  }
}
