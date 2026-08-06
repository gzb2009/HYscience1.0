import type { Message, Part } from "@hysci/sdk/v2/client"
import { sessionTitleLocal } from "@/thesis/store/sessionTitleLocal"
import { deriveSessionTitleFromMessage, isDefaultSessionTitle, isGenericSessionTitle } from "./sessionNaming"

export function firstUserMessageText(
  messages: Message[] | undefined,
  parts: Record<string, Part[] | undefined>,
): string {
  if (!messages?.length) return ""
  const first = messages.find((m) => m.role === "user")
  if (!first) return ""
  const msgParts = parts[first.id] ?? []
  return msgParts
    .filter((p): p is Part & { type: "text"; text: string } => p.type === "text" && "text" in p)
    .map((p) => p.text)
    .join("\n")
    .trim()
}

export function getSessionDisplayTitle(
  session: { id?: string; title?: string | null },
  messages?: Message[],
  parts?: Record<string, Part[] | undefined>,
  fallback = "新子任务",
): string {
  sessionTitleLocal.all()

  const id = session.id
  const local = id ? sessionTitleLocal.get(id)?.title?.trim() : ""
  if (local) return local

  const title = session.title?.trim() ?? ""
  const text = firstUserMessageText(messages, parts ?? {})
  const generated = text ? deriveSessionTitleFromMessage(text) : ""
  if (text && title === text && generated && !isGenericSessionTitle(generated)) {
    return generated
  }

  if (title && !isDefaultSessionTitle(title)) {
    return title
  }

  if (text) {
    const derived = deriveSessionTitleFromMessage(text)
    if (derived && !isGenericSessionTitle(derived)) return derived
  }

  if (isDefaultSessionTitle(title) || isGenericSessionTitle(title)) return fallback
  return title || fallback
}

export { deriveSessionTitleFromMessage, isDefaultSessionTitle } from "./sessionNaming"
