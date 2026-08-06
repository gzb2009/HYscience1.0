function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const HYSCIENCE_AUTO_SHARE = truthy("HYSCIENCE_AUTO_SHARE")
  export const HYSCIENCE_GIT_BASH_PATH = process.env["HYSCIENCE_GIT_BASH_PATH"]
  export const HYSCIENCE_CONFIG = process.env["HYSCIENCE_CONFIG"]
  export declare const HYSCIENCE_CONFIG_DIR: string | undefined
  export const HYSCIENCE_CONFIG_CONTENT = process.env["HYSCIENCE_CONFIG_CONTENT"]
  export const HYSCIENCE_DISABLE_AUTOUPDATE = truthy("HYSCIENCE_DISABLE_AUTOUPDATE")
  export const HYSCIENCE_DISABLE_PRUNE = truthy("HYSCIENCE_DISABLE_PRUNE")
  export const HYSCIENCE_DISABLE_TERMINAL_TITLE = truthy("HYSCIENCE_DISABLE_TERMINAL_TITLE")
  export const HYSCIENCE_PERMISSION = process.env["HYSCIENCE_PERMISSION"]
  export const HYSCIENCE_DISABLE_DEFAULT_PLUGINS = truthy("HYSCIENCE_DISABLE_DEFAULT_PLUGINS")
  export const HYSCIENCE_DISABLE_LSP_DOWNLOAD = truthy("HYSCIENCE_DISABLE_LSP_DOWNLOAD")
  export const HYSCIENCE_ENABLE_EXPERIMENTAL_MODELS = truthy("HYSCIENCE_ENABLE_EXPERIMENTAL_MODELS")
  export const HYSCIENCE_DISABLE_AUTOCOMPACT = truthy("HYSCIENCE_DISABLE_AUTOCOMPACT")
  export const HYSCIENCE_DISABLE_MODELS_FETCH = truthy("HYSCIENCE_DISABLE_MODELS_FETCH")
  export const HYSCIENCE_DISABLE_CLAUDE_CODE = truthy("HYSCIENCE_DISABLE_CLAUDE_CODE")
  export const HYSCIENCE_DISABLE_CLAUDE_CODE_PROMPT =
    HYSCIENCE_DISABLE_CLAUDE_CODE || truthy("HYSCIENCE_DISABLE_CLAUDE_CODE_PROMPT")
  export const HYSCIENCE_DISABLE_CLAUDE_CODE_SKILLS =
    HYSCIENCE_DISABLE_CLAUDE_CODE || truthy("HYSCIENCE_DISABLE_CLAUDE_CODE_SKILLS")
  export const HYSCIENCE_DISABLE_BUNDLED_SKILLS = truthy("HYSCIENCE_DISABLE_BUNDLED_SKILLS")
  export declare const HYSCIENCE_DISABLE_PROJECT_CONFIG: boolean
  export const HYSCIENCE_FAKE_VCS = process.env["HYSCIENCE_FAKE_VCS"]
  export const HYSCIENCE_CLIENT = process.env["HYSCIENCE_CLIENT"] ?? "cli"
  export const HYSCIENCE_TRUST_PROXY = truthy("HYSCIENCE_TRUST_PROXY")

  // Experimental
  export const HYSCIENCE_EXPERIMENTAL = truthy("HYSCIENCE_EXPERIMENTAL")
  export const HYSCIENCE_EXPERIMENTAL_FILEWATCHER = truthy("HYSCIENCE_EXPERIMENTAL_FILEWATCHER")
  export const HYSCIENCE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("HYSCIENCE_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const HYSCIENCE_EXPERIMENTAL_ICON_DISCOVERY =
    HYSCIENCE_EXPERIMENTAL || truthy("HYSCIENCE_EXPERIMENTAL_ICON_DISCOVERY")
  export const HYSCIENCE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("HYSCIENCE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const HYSCIENCE_ENABLE_EXA =
    truthy("HYSCIENCE_ENABLE_EXA") || HYSCIENCE_EXPERIMENTAL || truthy("HYSCIENCE_EXPERIMENTAL_EXA")
  export const HYSCIENCE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("HYSCIENCE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const HYSCIENCE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("HYSCIENCE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const HYSCIENCE_EXPERIMENTAL_OXFMT = HYSCIENCE_EXPERIMENTAL || truthy("HYSCIENCE_EXPERIMENTAL_OXFMT")
  export const HYSCIENCE_EXPERIMENTAL_LSP_TY = truthy("HYSCIENCE_EXPERIMENTAL_LSP_TY")
  export const HYSCIENCE_EXPERIMENTAL_LSP_TOOL = HYSCIENCE_EXPERIMENTAL || truthy("HYSCIENCE_EXPERIMENTAL_LSP_TOOL")
  export const HYSCIENCE_DISABLE_FILETIME_CHECK = truthy("HYSCIENCE_DISABLE_FILETIME_CHECK")
  export const HYSCIENCE_EXPERIMENTAL_PLAN_MODE = HYSCIENCE_EXPERIMENTAL || truthy("HYSCIENCE_EXPERIMENTAL_PLAN_MODE")
  export const HYSCIENCE_EXPERIMENTAL_MARKDOWN = truthy("HYSCIENCE_EXPERIMENTAL_MARKDOWN")
  export const HYSCIENCE_MODELS_URL = process.env["HYSCIENCE_MODELS_URL"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for HYSCIENCE_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "HYSCIENCE_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("HYSCIENCE_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for HYSCIENCE_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "HYSCIENCE_CONFIG_DIR", {
  get() {
    return process.env["HYSCIENCE_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})
