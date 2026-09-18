import { Log } from "../util/log"
import { getJSON, HttpStatusError } from "../science/connectors/http"
import type { ReviewRecord } from "./review-record"

/**
 * Citation check — resolves every DOI / PMID in a delivered answer against
 * CrossRef and PubMed. A citation that does not resolve is the single most
 * damaging kind of hallucination for a research assistant, so this runs
 * deterministically before the LLM reviewer and its result is folded into the
 * ReviewRecord shown in the Evidence pane.
 */
export namespace CitationCheck {
  const log = Log.create({ service: "citation-check" })

  const DOI = /\b10\.\d{4,9}\/[^\s"'<>()\[\]{}，。；、（）【】《》]+/g
  const PMID = /\bPMID\s*[:：]?\s*(\d{6,9})\b/gi
  const TRAIL = /[.,;:!?]+$/
  const MAX = 40
  const TIMEOUT = 8_000

  export type Status = "verified" | "missing" | "error"
  export type Mismatch = { field: "year" | "author"; claimed: string; actual: string }
  export type Item = {
    kind: "doi" | "pmid"
    id: string
    status: Status
    title?: string
    year?: number
    authors?: string[]
    mismatch?: Mismatch[]
  }
  export type Result = { items: Item[]; verified: number; missing: number; errors: number }

  export function extract(text: string) {
    const dois = new Set<string>()
    for (const match of text.matchAll(DOI)) dois.add(match[0].replace(TRAIL, "").toLowerCase())
    const pmids = new Set<string>()
    for (const match of text.matchAll(PMID)) pmids.add(match[1])
    return { dois: [...dois].slice(0, MAX), pmids: [...pmids].slice(0, MAX) }
  }

  type Work = {
    message?: {
      title?: string[]
      issued?: { "date-parts"?: number[][] }
      author?: { family?: string; name?: string }[]
    }
  }
  type Summary = {
    result?: Record<string, { title?: string; pubdate?: string; error?: string; authors?: { name?: string }[] }>
  }

  const WINDOW = 90
  const CLAIM =
    /([A-Z][A-Za-z\u00C0-\u024F\u4e00-\u9fa5\-]{1,30})\s*(?:et al\.?|等)?[\s,，（(]*((?:19|20)\d{2})\b[^\n]{0,15}$/u
  const YEAR = /\b((?:19|20)\d{2})\b(?!.*\b(?:19|20)\d{2}\b)/

  /** The text immediately before each citation id — where "Author Year" claims live. */
  export function windows(text: string) {
    const hits = [
      ...[...text.matchAll(DOI)].map((m) => ({
        id: m[0].replace(TRAIL, "").toLowerCase(),
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
      })),
      ...[...text.matchAll(PMID)].map((m) => ({ id: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })),
    ].sort((a, b) => a.start - b.start)
    const out = new Map<string, string[]>()
    hits.forEach((hit, i) => {
      // A window never reaches back past the previous citation, so "A 2018 (PMID x), B 2020 (PMID y)" attributes B to y only.
      const floor = i > 0 ? hits[i - 1].end : 0
      const list = out.get(hit.id) ?? []
      list.push(text.slice(Math.max(floor, hit.start - WINDOW), hit.start))
      out.set(hit.id, list)
    })
    return out
  }

  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()

  /** Compare the in-text "Author Year" claim against the resolved record. Conservative: only fires on an explicit claim. */
  export function compare(item: Item, before: string[]): Mismatch[] {
    if (item.status !== "verified") return []
    const out: Mismatch[] = []
    for (const window of before) {
      const claim = window.match(CLAIM)
      const year = claim?.[2] ?? window.match(YEAR)?.[1]
      if (year && item.year && Math.abs(Number(year) - item.year) > 1 && !out.some((m) => m.field === "year")) {
        out.push({ field: "year", claimed: year, actual: String(item.year) })
      }
      const surname = claim?.[1]
      if (
        surname &&
        item.authors?.length &&
        !/^(PMID|DOI|Nature|Science|Cell|Fig|Table|See|Ref)$/i.test(surname) &&
        !item.authors.some((author) => fold(author) === fold(surname)) &&
        !out.some((m) => m.field === "author")
      ) {
        out.push({ field: "author", claimed: surname, actual: item.authors.slice(0, 3).join(", ") })
      }
    }
    return out
  }

  async function doi(id: string, signal?: AbortSignal): Promise<Item> {
    const url = `https://api.crossref.org/works/${encodeURIComponent(id)}?mailto=support@hyscience.ai`
    return getJSON<Work>(url, { signal, timeout: TIMEOUT, retries: 1 })
      .then((data) => ({
        kind: "doi" as const,
        id,
        status: data.message?.title?.length ? ("verified" as const) : ("missing" as const),
        title: data.message?.title?.[0],
        year: data.message?.issued?.["date-parts"]?.[0]?.[0],
        authors: (data.message?.author ?? [])
          .map((author) => author.family ?? author.name?.split(/\s+/).at(-1) ?? "")
          .filter(Boolean),
      }))
      .catch((error) => ({
        kind: "doi" as const,
        id,
        status: error instanceof HttpStatusError && error.status === 404 ? ("missing" as const) : ("error" as const),
      }))
  }

  async function pmids(ids: string[], signal?: AbortSignal): Promise<Item[]> {
    if (ids.length === 0) return []
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`
    return getJSON<Summary>(url, { signal, timeout: TIMEOUT, retries: 1 })
      .then((data) =>
        ids.map((id) => {
          const row = data.result?.[id]
          if (!row || row.error) return { kind: "pmid" as const, id, status: "missing" as const }
          return {
            kind: "pmid" as const,
            id,
            status: "verified" as const,
            title: row.title,
            year: Number(row.pubdate?.slice(0, 4)) || undefined,
            authors: (row.authors ?? []).map((author) => author.name?.split(/\s+/)[0] ?? "").filter(Boolean),
          }
        }),
      )
      .catch(() => ids.map((id) => ({ kind: "pmid" as const, id, status: "error" as const })))
  }

  export async function verify(text: string, signal?: AbortSignal): Promise<Result> {
    const found = extract(text)
    const before = windows(text)
    const items = [
      ...(await Promise.all(found.dois.map((id) => doi(id, signal)))),
      ...(await pmids(found.pmids, signal)),
    ].map((item) => ({ ...item, mismatch: compare(item, before.get(item.id) ?? []) }))
    const result = {
      items,
      verified: items.filter((item) => item.status === "verified").length,
      missing: items.filter((item) => item.status === "missing").length,
      errors: items.filter((item) => item.status === "error").length,
    }
    if (items.length) log.info("citation check", { total: items.length, ...result, items: undefined })
    return result
  }

  /** Unresolvable citations become blocking findings; network errors become warnings. */
  export function findings(result: Result): ReviewRecord.Finding[] {
    const out: ReviewRecord.Finding[] = []
    for (const item of result.items) {
      if (item.status === "missing") {
        out.push({
          severity: "blocking",
          message: `${item.kind.toUpperCase()} ${item.id} does not resolve in ${item.kind === "doi" ? "CrossRef" : "PubMed"}; treat as unverified or remove it.`,
          evidence: [
            item.kind === "doi" ? `https://doi.org/${item.id}` : `https://pubmed.ncbi.nlm.nih.gov/${item.id}/`,
          ],
        })
      }
      for (const m of item.mismatch ?? []) {
        out.push({
          severity: "warning",
          message: `${item.kind.toUpperCase()} ${item.id} resolves, but the answer cites ${m.field} "${m.claimed}" while the record says "${m.actual}"${item.title ? ` (${item.title.slice(0, 80)})` : ""}; fix the attribution or the citation.`,
          evidence: [
            item.kind === "doi" ? `https://doi.org/${item.id}` : `https://pubmed.ncbi.nlm.nih.gov/${item.id}/`,
          ],
        })
      }
      if (item.status === "error") {
        out.push({
          severity: "warning",
          message: `${item.kind.toUpperCase()} ${item.id} could not be checked (network error).`,
          evidence: [],
        })
      }
    }
    return out
  }

  /** One line the reviewer prompt can use so it does not re-verify resolved IDs. */
  export function note(result: Result) {
    if (result.items.length === 0) return ""
    const ok = result.items.filter((item) => item.status === "verified").map((item) => `${item.kind}:${item.id}`)
    const bad = result.items.filter((item) => item.status === "missing").map((item) => `${item.kind}:${item.id}`)
    return [
      "<citation_check>",
      ok.length ? `Resolved: ${ok.join(", ")}` : "",
      bad.length ? `Unresolvable (already flagged): ${bad.join(", ")}` : "",
      ...result.items
        .filter((item) => item.mismatch?.length)
        .map(
          (item) =>
            `Attribution mismatch (already flagged): ${item.kind}:${item.id} → ${item.mismatch!.map((m) => `${m.field} ${m.claimed}≠${m.actual}`).join("; ")}`,
        ),
      "Check that each resolved citation's title/year actually supports the claim it is attached to.",
      "</citation_check>",
    ]
      .filter(Boolean)
      .join("\n")
  }
}
