/**
 * Single source of truth for outbound HYscience URLs + the deployed
 * web host. Everything user-facing (composer copy, right pane, settings, entry
 * favicon, changelog fetch, dev-host detection) routes through here so the brand
 * host lives in exactly one place.
 */

/** Bare deployed web host, used for dev-host detection (no scheme). */
export const HOST = "hyscience.ai"

/** Marketing / docs site root. */
export const SITE = `https://${HOST}`

export const URLS = {
  /** Bare host (scheme-less) — matched against `location.hostname`. */
  host: HOST,
  /** Marketing / docs site root. */
  site: SITE,
  /** Account / keys / billing dashboard root. */
  dashboard: "https://app.hyscience.ai",
  /** CLI plan + wallet tab. */
  dashboardCli: "https://app.hyscience.ai/cli",
  /** GitHub integration settings. */
  githubIntegration: "https://app.hyscience.ai/settings/integrations",
  /** Notification favicon. */
  favicon: `${SITE}/favicon-96x96-v4.png`,
  /** Changelog feed consumed by the highlights context. */
  changelog: `${SITE}/changelog.json`,
  /** Theme authoring docs. */
  docsThemes: `${SITE}/docs/themes/`,
} as const
