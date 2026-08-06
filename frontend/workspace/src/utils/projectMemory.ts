const AGENT_CONTEXT_CATEGORY = "Agent Context"

type Note = { id: string; text: string; createdAt: number }
type Category = { id: string; name: string; notes: Note[] }
type Doc = { enabled: boolean; categories: Category[] }

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)

function endpoint(baseUrl: string, directory: string) {
  const u = new URL(`${baseUrl}/settings/memory`)
  u.searchParams.set("scope", "project")
  u.searchParams.set("directory", directory)
  return u.toString()
}

export async function loadProjectAgentContext(
  baseUrl: string,
  directory: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(endpoint(baseUrl, directory))
  if (!res.ok) return ""
  const doc = (await res.json()) as Doc
  const cat = doc.categories.find((c) => c.name === AGENT_CONTEXT_CATEGORY)
  if (!cat?.notes.length) return ""
  return cat.notes
    .map((n) => n.text)
    .join("\n\n")
    .trim()
}

export async function saveProjectAgentContext(
  baseUrl: string,
  directory: string,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const trimmed = text.trim()
  const res = await fetchFn(endpoint(baseUrl, directory))
  const doc: Doc = res.ok ? ((await res.json()) as Doc) : { enabled: true, categories: [] }

  const without = doc.categories.filter((c) => c.name !== AGENT_CONTEXT_CATEGORY)
  const next: Doc = {
    enabled: doc.enabled,
    categories:
      trimmed.length === 0
        ? without
        : [
            ...without,
            {
              id: uid(),
              name: AGENT_CONTEXT_CATEGORY,
              notes: [{ id: uid(), text: trimmed, createdAt: Date.now() }],
            },
          ],
  }

  const put = await fetchFn(endpoint(baseUrl, directory), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  })
  if (!put.ok) throw new Error(await put.text())
}
