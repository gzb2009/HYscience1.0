import { describe, expect, test } from "bun:test"
import { Config } from "../src/config/config"

describe("process security profiles", () => {
  test("accepts explicit environment, BYOK opt-in, and bash timeout", () => {
    const config = Config.Info.parse({
      process: {
        bash: {
          timeout: 300_000,
          environmentMode: "safe",
          environment: { PROJECT_MODE: "analysis" },
          byokProviders: ["openrouter"],
        },
        notebook: {
          environment: { UV_CACHE_DIR: "/tmp/uv" },
        },
        remote: {
          environmentMode: "inherit",
        },
        pty: {
          environment: { EDITOR_MODE: "safe" },
        },
      },
    })

    expect(config.process?.bash?.timeout).toBe(300_000)
    expect(config.process?.bash?.byokProviders).toEqual(["openrouter"])
    expect(config.process?.notebook?.environment).toEqual({ UV_CACHE_DIR: "/tmp/uv" })
    expect(config.process?.remote?.environmentMode).toBe("inherit")
    expect(config.process?.pty?.environment).toEqual({ EDITOR_MODE: "safe" })
  })

  test("allows zero to disable the default bash timeout", () => {
    const config = Config.Info.parse({ process: { bash: { timeout: 0 } } })
    expect(config.process?.bash?.timeout).toBe(0)
  })

  test("rejects unknown profile fields", () => {
    expect(() => Config.Info.parse({ process: { bash: { exposeAllSecrets: true } } })).toThrow()
  })
})
