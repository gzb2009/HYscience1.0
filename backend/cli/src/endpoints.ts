/**
 * Central resolver for the optional managed-platform backend base URL.
 *
 * Local-first builds do not call this by default. When a hosted platform ships,
 * point HYSCIENCE_API_BASE (or aliases below) at your backend — every client
 * route should go through this module.
 */

/** Neutral public default. Contains no internal codename. */
export const DEFAULT_MANAGED_API_BASE = "https://app.hyscience.ai"

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "")
}

/** Env var names that override the managed base URL, highest precedence first. */
export const MANAGED_API_BASE_ENV_KEYS = [
  "HYSCIENCE_API_BASE",
  "HYSC_API_BASE",
  "MANAGED_API_BASE",
  "ATLAS_BASE_URL",
  "THESIS_BASE_URL",
] as const

/**
 * Resolve the managed backend base URL from the given environment, falling back
 * to the neutral default. Pure + parameterized so it stays unit-testable.
 */
export function managedApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = MANAGED_API_BASE_ENV_KEYS.map((key) => env[key]).find((value) => !!value)
  return stripTrailingSlashes(override || DEFAULT_MANAGED_API_BASE)
}

/** The resolved managed base URL for this process. */
export const MANAGED_API_BASE = managedApiBase()
