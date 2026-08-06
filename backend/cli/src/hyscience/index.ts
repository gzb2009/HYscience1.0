/**
 * Local-runtime helpers + future managed-platform seam.
 *
 * Cloud auth, sync, wallet, and remote skill catalog were removed for the
 * local-first BYOK build. Reintroduce platform calls here when a hosted
 * backend ships — base URL resolves through `endpoints.ts`.
 */
import { Auth } from "../auth"
import { DEFAULT_MANAGED_API_BASE, MANAGED_API_BASE } from "../endpoints"

export const API_BASE = MANAGED_API_BASE
export { DEFAULT_MANAGED_API_BASE }

const SHARED_PROVIDER_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
])

const BYOK_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "GROQ_API_KEY",
  "FIREWORKS_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "CEREBRAS_API_KEY",
]

const BYOK_SUBPROCESS_PROVIDERS: Record<string, { key: string; baseUrl?: string; publicBaseUrl?: string }> = {
  openrouter: {
    key: "OPENROUTER_API_KEY",
    baseUrl: "OPENROUTER_BASE_URL",
    publicBaseUrl: "https://openrouter.ai/api/v1",
  },
  together: { key: "TOGETHER_API_KEY" },
  groq: { key: "GROQ_API_KEY" },
  fireworks: { key: "FIREWORKS_API_KEY" },
}

const byokSecretValues = new Set<string>()

function isManagedKey(value: string): boolean {
  return value.startsWith("thk_")
}

export class InsufficientCreditsError extends Error {
  constructor(message = "Managed cloud billing is not enabled in this build.") {
    super(message)
    this.name = "InsufficientCreditsError"
  }
}

export namespace HYscience {
  export async function refreshIfStale(): Promise<void> {}

  export async function flushPendingUsage(): Promise<void> {}

  export async function getSession(): Promise<null> {
    return null
  }

  export async function isAuthenticated(): Promise<boolean> {
    return false
  }

  export async function syncServices(): Promise<null> {
    return null
  }

  export async function getBalance(): Promise<null> {
    return null
  }

  export function invalidateBalance(): void {}

  export async function getBillingMode(): Promise<null> {
    return null
  }

  export async function setBillingMode(_mode: string): Promise<null> {
    return null
  }

  export async function getCredits(): Promise<null> {
    return null
  }

  export async function getTransactions(_limit?: number): Promise<null> {
    return null
  }

  export async function listDevices(): Promise<null> {
    return null
  }

  export async function revokeDevice(_keyID: string): Promise<boolean> {
    return false
  }

  export async function revokeCurrentDevice(): Promise<boolean> {
    return false
  }

  export async function clearSession(): Promise<void> {}

  export async function loginWithKey(_key: string): Promise<void> {
    throw new Error("Cloud login is not enabled. Configure provider API keys locally.")
  }

  export async function browserLogin(_opts?: { open?: (url: string) => void }): Promise<void> {
    throw new Error("Cloud login is not enabled. Configure provider API keys locally.")
  }

  export function authPageUrl(): string {
    return API_BASE
  }

  export async function reportUsage(_entry: Record<string, unknown>): Promise<void> {}

  export async function fetchSkillIndex(): Promise<null> {
    return null
  }

  export async function fetchSkillContent(_name: string): Promise<string | null> {
    return null
  }

  export async function fetchLearnedSkills(): Promise<null> {
    return null
  }

  export async function fetchLearnedSkillContent(_name: string): Promise<string | null> {
    return null
  }

  export async function uploadLearnedSkill(
    _name: string,
    _description: string,
    _content: string,
    _meta?: Record<string, unknown>,
  ): Promise<boolean> {
    return false
  }

  export async function fetchInstalledSkills(): Promise<null> {
    return null
  }

  export async function postInstalledSkill(_entry: Record<string, unknown>): Promise<boolean> {
    return false
  }

  export async function deleteInstalledSkill(_namespace: string, _name: string): Promise<boolean> {
    return false
  }

  export async function deleteInstalledNamespace(_namespace: string): Promise<null> {
    return null
  }

  export async function requestSkillReview(_payload: Record<string, unknown>): Promise<null> {
    return null
  }

  export async function atlasCliVersion(): Promise<null> {
    return null
  }

  export async function refreshByokSecrets(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    byokSecretValues.clear()
    try {
      const auth = await Auth.all().catch(() => ({}) as Record<string, Auth.Info>)
      for (const info of Object.values(auth)) {
        if (info.type !== "api") continue
        if (!info.key || isManagedKey(info.key)) continue
        byokSecretValues.add(info.key)
      }
    } catch {
      /* ignore */
    }
    for (const key of BYOK_ENV_KEYS) {
      const value = env[key]
      if (!value || isManagedKey(value)) continue
      byokSecretValues.add(value)
    }
  }

  export function registerSecretValues(values: Iterable<string>): void {
    for (const value of values) {
      if (!value || value.length < 4 || isManagedKey(value)) continue
      byokSecretValues.add(value)
    }
  }

  export function redactSecrets(text: string): string {
    let result = text
    for (const value of byokSecretValues) {
      if (value.length < 4) continue
      result = result.replaceAll(value, "[REDACTED]")
    }
    return result
  }

  export function isManagedKeyValue(value: string | undefined): boolean {
    return typeof value === "string" && isManagedKey(value)
  }

  export function isSyncedSecretKey(_key: string): boolean {
    return false
  }

  export function isSyncedSecretValue(_value: string | undefined): boolean {
    return false
  }

  export function filterEnvForSubprocess(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (!value) continue
      if (isManagedKey(value)) continue
      if (SHARED_PROVIDER_KEYS.has(key)) continue
      result[key] = value
    }
    return result
  }

  export function mergeByokEnv(base: Record<string, string>, auth: Record<string, Auth.Info>): Record<string, string> {
    const result = { ...base }
    for (const [providerID, info] of Object.entries(auth)) {
      if (info.type !== "api") continue
      if (isManagedKey(info.key)) continue
      const spec = BYOK_SUBPROCESS_PROVIDERS[providerID]
      if (!spec) continue
      if (result[spec.key]) continue
      result[spec.key] = info.key
      if (spec.baseUrl && spec.publicBaseUrl) result[spec.baseUrl] = spec.publicBaseUrl
    }
    return result
  }

  export async function subprocessEnv(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
    const base = filterEnvForSubprocess(env)
    const auth = await Auth.all().catch(() => ({}) as Record<string, Auth.Info>)
    const merged = mergeByokEnv(base, auth)
    merged.MPLBACKEND = "Agg"
    return merged
  }
}
