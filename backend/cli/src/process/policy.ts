export namespace ProcessPolicy {
  export type Mode = "safe" | "inherit"

  const COMMON = new Set([
    "COLORTERM",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LANGUAGE",
    "LOGNAME",
    "NO_COLOR",
    "PATH",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "TZ",
    "USER",
  ])

  const WINDOWS = new Set([
    "APPDATA",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "USERPROFILE",
    "WINDIR",
  ])

  function values(env: NodeJS.ProcessEnv) {
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  }

  export function baseline(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
    const allowed = platform === "win32" ? new Set([...COMMON, ...WINDOWS]) : COMMON
    return Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => {
        if (entry[1] === undefined) return false
        const key = entry[0].toUpperCase()
        return allowed.has(key) || key.startsWith("LC_")
      }),
    )
  }

  export function environment(input: {
    source: NodeJS.ProcessEnv
    overrides?: Record<string, string>
    mode?: Mode
    platform?: NodeJS.Platform
  }) {
    const base =
      input.mode === "inherit" ? values(input.source) : baseline(input.source, input.platform ?? process.platform)
    return {
      ...base,
      ...input.overrides,
    }
  }
}
