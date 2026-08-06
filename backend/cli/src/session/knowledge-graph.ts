/**
 * Research Knowledge Graph — extracts biomedical entities from session
 * output and builds a cross-project relationship network.
 *
 * Entities: gene, protein, compound, disease, pathway, cell_type
 * Relations: activates, inhibits, binds, associated_with, encodes
 *
 * Stored as JSON-LD compatible node/edge lists per session.
 */

import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace KnowledgeGraph {
  const log = Log.create({ service: "knowledge-graph" })
  const DIR = path.join(Global.Path.data, "knowledge-graph")

  export type EntityType = "gene" | "protein" | "compound" | "disease" | "pathway" | "cell_type"
  export type RelationType = "activates" | "inhibits" | "binds" | "associated_with" | "encodes" | "expresses"

  export interface Entity {
    id: string
    type: EntityType
    name: string
    synonyms: string[]
    sessionIds: string[]
    firstSeen: number
    lastSeen: number
    occurrences: number
  }

  export interface Relation {
    id: string
    type: RelationType
    source: string
    target: string
    evidence: string
    sessionId: string
  }

  // ---- Extraction patterns ----

  const PATTERNS: Record<EntityType, RegExp[]> = {
    gene: [
      /\b(?:gene|基因)\s+([A-Z][A-Z0-9]+)\b/g,
      /\b([A-Z][A-Z0-9]{2,}(?:\s*[,，]\s*[A-Z][A-Z0-9]{2,})*)\s*(?:gene|基因|表达|expression)\b/g,
    ],
    protein: [/\b(?:protein|蛋白(?:质)?)\s+([A-Z][A-Z0-9]{2,})\b/g, /\b(CD\d+[A-Z]?)\b/g],
    compound: [
      /\b(?:compound|drug|inhibitor|ligand|small molecule)\s+([A-Z][a-z]+(?:[-\s][A-Za-z0-9]+)*)\b/g,
      /\b([A-Z][a-z]+ib)\b/g, // -ib suffix drugs
    ],
    disease: [
      /\b(?:disease|disorder|syndrome|tumor|cancer|carcinoma|leukemia|lymphoma)\b/gi,
      /\b(Alzheimer|Parkinson|diabetes|obesity|asthma|arthritis)\b/gi,
    ],
    pathway: [
      /\b(?:pathway|signaling)\s+([A-Za-z]+[/-][A-Za-z]+(?:[/-][A-Za-z]+)*)\b/g,
      /\b(Wnt|Notch|Hedgehog|NF-kB|JAK-STAT|MAPK|PI3K|mTOR|TGF-β|TGF-beta)\b/gi,
    ],
    cell_type: [
      /\b(?:cell type|细胞类型|cluster|亚群)\s+[:：]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
      /\b(T cell|B cell|NK cell|monocyte|macrophage|dendritic|neutrophil|eosinophil|fibroblast|epithelial)\b/gi,
    ],
  }

  const RELATION_PATTERNS: [RelationType, RegExp][] = [
    ["activates", /\b([A-Z][A-Z0-9]{2,})\s+(?:activates|upregulates|stimulates|promotes)\s+([A-Z][A-Z0-9]{2,})\b/gi],
    ["inhibits", /\b([A-Z][A-Z0-9]{2,})\s+(?:inhibits|downregulates|suppresses|blocks)\s+([A-Z][A-Z0-9]{2,})\b/gi],
    ["binds", /\b([A-Z][A-Z0-9]{2,})\s+(?:binds|interacts with|docks to)\s+([A-Z][A-Z0-9]{2,})\b/gi],
    [
      "encodes",
      /\b([A-Z][A-Z0-9]{2,})\s+(?:encodes|produces|translates to)\s+(?:the\s+)?([A-Z][a-z]+(?:[-\s][A-Za-z0-9]+)*)\b/gi,
    ],
    [
      "expresses",
      /\b(T cell|B cell|monocyte|macrophage|NK cell)s?\s+(?:express|secrete|produce)\s+([A-Z][A-Z0-9]{2,})\b/gi,
    ],
  ]

  // ---- Graph operations ----

  export async function extract(
    text: string,
    sessionId: string,
  ): Promise<{ entities: Entity[]; relations: Relation[] }> {
    const entityMap = new Map<string, Entity>()
    const relations: Relation[] = []
    const now = Date.now()

    for (const [type, patterns] of Object.entries(PATTERNS) as [EntityType, RegExp[]][]) {
      for (const pattern of patterns) {
        const matches = text.matchAll(pattern)
        for (const m of matches) {
          const name = (m[1] ?? m[0]).trim()
          if (name.length < 2 || name.length > 50) continue
          const key = `${type}:${name.toLowerCase()}`
          if (entityMap.has(key)) {
            const e = entityMap.get(key)!
            e.occurrences++
            e.lastSeen = now
            if (!e.sessionIds.includes(sessionId)) e.sessionIds.push(sessionId)
          } else {
            entityMap.set(key, {
              id: key,
              type,
              name,
              synonyms: [],
              sessionIds: [sessionId],
              firstSeen: now,
              lastSeen: now,
              occurrences: 1,
            })
          }
        }
      }
    }

    for (const [rt, rp] of RELATION_PATTERNS) {
      const matches = text.matchAll(rp)
      let ri = 0
      for (const m of matches) {
        const source = m[1]?.trim()
        const target = m[2]?.trim()
        if (!source || !target) continue
        const srcKey = findEntityKey(entityMap, source)
        const tgtKey = findEntityKey(entityMap, target)
        if (!srcKey || !tgtKey) continue
        relations.push({
          id: `${sessionId}-rel-${ri++}`,
          type: rt,
          source: srcKey,
          target: tgtKey,
          evidence: m[0],
          sessionId,
        })
      }
    }

    return { entities: [...entityMap.values()], relations }
  }

  function findEntityKey(map: Map<string, Entity>, name: string): string | undefined {
    const key =
      map.get(`gene:${name.toLowerCase()}`) ??
      map.get(`protein:${name.toLowerCase()}`) ??
      map.get(`cell_type:${name.toLowerCase()}`)
    if (key) return key.id
    for (const [k, v] of map) {
      if (v.name.toLowerCase() === name.toLowerCase()) return k
    }
    return undefined
  }

  export async function merge(sessionId: string, entities: Entity[], relations: Relation[]): Promise<void> {
    const dir = path.join(DIR, sessionId)
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, "entities.json"), JSON.stringify(entities, null, 2))
    await Bun.write(path.join(dir, "relations.json"), JSON.stringify(relations, null, 2))

    // Update global index
    const index = await globalIndex()
    for (const e of entities) {
      const existing = index.entities[e.id]
      if (existing) {
        existing.occurrences += e.occurrences
        existing.lastSeen = Math.max(existing.lastSeen, e.lastSeen)
        for (const sid of e.sessionIds) {
          if (!existing.sessionIds.includes(sid)) existing.sessionIds.push(sid)
        }
      } else {
        index.entities[e.id] = e
      }
    }
    for (const r of relations) {
      if (!index.relations.find((x) => x.source === r.source && x.target === r.target && x.type === r.type)) {
        index.relations.push(r)
      }
    }
    await Bun.write(path.join(DIR, "index.json"), JSON.stringify(index, null, 2))
    log.info("kg merged", { sessionId, entities: entities.length, relations: relations.length })
  }

  async function globalIndex(): Promise<{ entities: Record<string, Entity>; relations: Relation[] }> {
    try {
      return await Bun.file(path.join(DIR, "index.json")).json()
    } catch {
      return { entities: {}, relations: [] }
    }
  }

  export async function query(
    entityName: string,
  ): Promise<{ entity?: Entity; related: { entity: Entity; relation: Relation }[] }> {
    const idx = await globalIndex()
    const key = Object.keys(idx.entities).find((k) => idx.entities[k].name.toLowerCase() === entityName.toLowerCase())
    const entity = key ? idx.entities[key] : undefined
    const related: { entity: Entity; relation: Relation }[] = []
    if (entity) {
      for (const r of idx.relations) {
        if (r.source === entity.id || r.target === entity.id) {
          const other = r.source === entity.id ? idx.entities[r.target] : idx.entities[r.source]
          if (other) related.push({ entity: other, relation: r })
        }
      }
    }
    return { entity, related }
  }

  export async function scan(
    sessionId: string,
    messages: { parts: { type: string; text?: string }[] }[],
  ): Promise<number> {
    let count = 0
    try {
      const allText = messages
        .flatMap((m) => m.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text!))
        .join("\n")
      if (!allText) return 0
      const result = await extract(allText, sessionId)
      if (result.entities.length > 0) {
        await merge(sessionId, result.entities, result.relations)
        count = result.entities.length
      }
    } catch (e) {
      log.warn("kg scan failed", { error: e instanceof Error ? e.message : String(e) })
    }
    return count
  }

  export function mermaid(entities: Entity[], relations: Relation[]): string {
    const lines = ["graph LR"]
    for (const e of entities) lines.push(`  ${e.id.replace(/[:]/g, "_")}["${e.name}"]`)
    for (const r of relations) {
      const label = r.type.replace(/_/g, " ")
      const arrow = r.type === "inhibits" ? "--|" : r.type === "activates" ? "-->" : r.type === "binds" ? "---" : "-->"
      lines.push(`  ${r.source.replace(/[:]/g, "_")} ${arrow}${label}| ${r.target.replace(/[:]/g, "_")}`)
    }
    return lines.join("\n")
  }
}
