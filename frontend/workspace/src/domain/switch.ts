export type DomainSwitch = {
  current: string
  suggest: string
  currentTitle: string
  suggestTitle: string
  kind: "execute" | "ask"
}

export function parseDomainSwitch(text: string): DomainSwitch | undefined {
  const open = text.match(/<domain-switch\s+([^>]+)>/)
  if (!open) return undefined
  const attrs: Record<string, string> = {}
  for (const piece of open[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[piece[1]] = piece[2]
  if (attrs.kind !== "execute" && attrs.kind !== "ask") return undefined
  if (!attrs.current || !attrs.suggest) return undefined
  return {
    current: attrs.current,
    suggest: attrs.suggest,
    currentTitle: attrs.currentTitle || attrs.current,
    suggestTitle: attrs.suggestTitle || attrs.suggest,
    kind: attrs.kind,
  }
}

export function switchFromParts(parts: { type: string; text?: string }[]) {
  for (const part of parts) {
    if (part.type !== "text" || !part.text) continue
    const hit = parseDomainSwitch(part.text)
    if (hit) return hit
  }
}
