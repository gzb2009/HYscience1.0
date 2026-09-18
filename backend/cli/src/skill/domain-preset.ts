import { SHARED_SKILLS as SHARED, themeAllows } from "@hysci/util/themes"

/** Re-exported for existing callers; the list itself lives in the theme manifest. */
export const SHARED_SKILLS = SHARED

export function domainSkillAllowed(subdomain: string | undefined, name: string) {
  return themeAllows(subdomain, name)
}
