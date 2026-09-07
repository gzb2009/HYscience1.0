import { createSignal } from "solid-js"
import { domainById, type DomainId } from "./registry"

const KEY = "hyscience.domain.last"

function read(): DomainId | undefined {
  try {
    const value = localStorage.getItem(KEY)
    return domainById(value ?? "")?.id
  } catch {
    return undefined
  }
}

const [lastDomain, setLast] = createSignal<DomainId | undefined>(read())

export function lastSelectedDomain() {
  return lastDomain()
}

export function rememberDomain(id: DomainId) {
  setLast(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
}
