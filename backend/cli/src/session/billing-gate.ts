/**
 * Billing gate predicates for LLM calls (local-first BYOK build).
 *
 * Managed cloud billing is disabled; only BYOK and first-party OAuth paths run.
 */

import { Auth } from "@/auth"
import { Provider } from "@/provider/provider"

export type CredentialSource = "byok" | "oauth-free"
export type BillingMode = "byok"

export async function llmBillingMode(): Promise<BillingMode> {
  return "byok"
}

export async function computeBillingMode(): Promise<BillingMode> {
  return "byok"
}

const OAUTH_FREE_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "github-copilot",
  "github-copilot-enterprise",
])

export function isCodexOAuthProvider(providerID: string): boolean {
  return providerID === "openai-codex"
}

export async function resolveCredentialSource(providerID: string, _modelID: string): Promise<CredentialSource> {
  const auth = await Auth.get(providerID).catch(() => undefined)
  if (auth?.type === "oauth") return "oauth-free"

  const provider = await Provider.getProvider(providerID).catch(() => undefined)
  const optionKey = provider?.options?.["apiKey"]
  const resolvedKey = typeof provider?.key === "string" ? provider.key : undefined
  const explicitKey = typeof optionKey === "string" ? optionKey : undefined
  if (OAUTH_FREE_PROVIDERS.has(providerID) && !resolvedKey && !explicitKey && !auth) return "oauth-free"

  return "byok"
}

export function requiresWalletBalance(_source: CredentialSource): boolean {
  return false
}

export function shouldReportUsage(_source: CredentialSource): boolean {
  return false
}
