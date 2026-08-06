import { describe, expect, test } from "bun:test"
import { ProcessPolicy } from "../src/process/policy"

describe("ProcessPolicy.baseline", () => {
  test("keeps only portable runtime variables on unix", () => {
    const env = ProcessPolicy.baseline(
      {
        PATH: "/usr/bin",
        HOME: "/home/researcher",
        TMPDIR: "/tmp",
        LANG: "en_US.UTF-8",
        LC_NUMERIC: "C",
        OPENAI_API_KEY: "sk-secret",
        GITHUB_TOKEN: "gh-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        DATABASE_URL: "postgres://secret",
        XDG_CONFIG_HOME: "/home/researcher/.config",
      },
      "linux",
    )

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/researcher",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      LC_NUMERIC: "C",
    })
  })

  test("keeps variables required to spawn processes on windows", () => {
    const env = ProcessPolicy.baseline(
      {
        Path: "C:\\Windows\\System32",
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATHEXT: ".EXE;.CMD",
        USERPROFILE: "C:\\Users\\researcher",
        APPDATA: "C:\\Users\\researcher\\AppData\\Roaming",
        GITHUB_TOKEN: "gh-secret",
      },
      "win32",
    )

    expect(env).toEqual({
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".EXE;.CMD",
      USERPROFILE: "C:\\Users\\researcher",
      APPDATA: "C:\\Users\\researcher\\AppData\\Roaming",
    })
  })

  test("allows the SSH agent only for the remote profile", () => {
    const source = {
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      GITHUB_TOKEN: "gh-secret",
    }

    expect(ProcessPolicy.baseline(source, "linux", "bash")).toEqual({
      PATH: "/usr/bin",
    })
    expect(ProcessPolicy.baseline(source, "linux", "remote")).toEqual({
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    })
  })
})

describe("ProcessPolicy.environment", () => {
  test("explicit overrides are the only extra values in safe mode", () => {
    const env = ProcessPolicy.environment({
      source: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "host-secret",
      },
      overrides: {
        MCP_API_KEY: "explicit-secret",
        PATH: "/custom/bin",
      },
      mode: "safe",
      platform: "linux",
    })

    expect(env).toEqual({
      PATH: "/custom/bin",
      MCP_API_KEY: "explicit-secret",
    })
  })

  test("inherit mode preserves the host environment as a compatibility escape hatch", () => {
    const env = ProcessPolicy.environment({
      source: {
        PATH: "/usr/bin",
        LEGACY_MCP_TOKEN: "legacy-secret",
      },
      overrides: {
        MCP_MODE: "compat",
      },
      mode: "inherit",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      LEGACY_MCP_TOKEN: "legacy-secret",
      MCP_MODE: "compat",
    })
  })
})

describe("ProcessPolicy.timeout", () => {
  test("uses a finite default when no override is provided", () => {
    expect(ProcessPolicy.timeout({ fallback: 120_000 })).toBe(120_000)
  })

  test("prefers per-call and then configured values", () => {
    expect(ProcessPolicy.timeout({ requested: 5_000, configured: 60_000, fallback: 120_000 })).toBe(5_000)
    expect(ProcessPolicy.timeout({ configured: 60_000, fallback: 120_000 })).toBe(60_000)
  })

  test("preserves zero as an explicit timeout disable", () => {
    expect(ProcessPolicy.timeout({ requested: 0, configured: 60_000, fallback: 120_000 })).toBe(0)
  })
})
