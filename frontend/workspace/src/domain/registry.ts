import { PRIMARY_THEMES, SHARED_SKILLS as SHARED, type ResearchDomain } from "@hysci/util/themes"

/** Themes with a UI card. The list itself lives in @hysci/util/themes. */
export type DomainId = (typeof PRIMARY_THEMES)[number]["id"]

export type DomainInfo = {
  id: DomainId
  researchDomain: ResearchDomain
  subdomain?: string
  skills: string[]
}

export const SHARED_SKILLS: string[] = [...SHARED]

export const DOMAINS: DomainInfo[] = PRIMARY_THEMES.map((theme) => ({
  id: theme.id,
  researchDomain: theme.researchDomain,
  subdomain: "subdomain" in theme ? theme.subdomain : undefined,
  skills: [...theme.skills],
}))

const IDS = new Set<string>(DOMAINS.map((item) => item.id))

export function domainById(id: string | undefined) {
  return DOMAINS.find((item) => item.id === id)
}

export function isDomainId(id: string | undefined): id is DomainId {
  return !!id && IDS.has(id)
}

export function projectDomainId(project?: { research?: { domain?: string; subdomain?: string } }) {
  const sub = project?.research?.subdomain
  if (sub && IDS.has(sub)) return sub as DomainId
  return "general" as DomainId
}

export function toResearch(id: DomainId) {
  const item = domainById(id) ?? domainById("general")!
  return {
    domain: item.researchDomain,
    subdomain: item.subdomain,
  }
}

export function domainAllows(id: DomainId, name: string) {
  const domain = domainById(id)
  if (!domain) return false
  return domain.skills.includes(name) || SHARED_SKILLS.includes(name)
}

export function buildDomainOverlay(id: DomainId, names: string[]) {
  const map: Record<string, "allow" | "deny"> = {}
  for (const name of names) map[name] = domainAllows(id, name) ? "allow" : "deny"
  return map
}

export function buildDomainSkillPreset(names: string[]) {
  const next: Record<string, Record<string, "allow" | "deny">> = {}
  for (const item of DOMAINS) next[item.id] = buildDomainOverlay(item.id, names)
  return next
}
