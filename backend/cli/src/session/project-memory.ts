/**
 * 项目级记忆 — 跨会话上下文检索
 *
 * 存储每个 session 的摘要，新 session 启动时检索相关历史上下文，
 * 实现跨会话知识复用。基于文件系统，无需外部向量数据库。
 */

import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"
import { Log } from "@/util/log"
import { MessageV2 } from "./message-v2"

export namespace ProjectMemory {
  const log = Log.create({ service: "project-memory" })
  const MEMORY_DIR = ".hyscience/memory"

  export interface Entry {
    sessionId: string
    title: string
    summary: string
    keywords: string[]
    agent: string
    timestamp: number
    outcome: string // "success" | "partial" | "failed"
  }

  function memoryPath(): string {
    return path.join(Instance.directory, MEMORY_DIR)
  }

  function indexPath(): string {
    return path.join(memoryPath(), "index.json")
  }

  /** Read all memory entries for the current project. */
  async function readIndex(): Promise<Entry[]> {
    try {
      const raw = await fs.readFile(indexPath(), "utf-8")
      return JSON.parse(raw) as Entry[]
    } catch {
      return []
    }
  }

  /** Write memory entries. */
  async function writeIndex(entries: Entry[]): Promise<void> {
    await fs.mkdir(memoryPath(), { recursive: true })
    await fs.writeFile(indexPath(), JSON.stringify(entries, null, 2))
  }

  /** Store a session summary in project memory. */
  export async function remember(entry: Entry): Promise<void> {
    const entries = await readIndex()
    // Deduplicate by sessionId
    const idx = entries.findIndex((e) => e.sessionId === entry.sessionId)
    if (idx >= 0) entries[idx] = entry
    else entries.push(entry)
    // Keep last 50 entries to prevent bloat
    const trimmed = entries.slice(-50)
    await writeIndex(trimmed)
    log.info("remembered", { sessionId: entry.sessionId, total: trimmed.length })
  }

  /** Search memory for entries relevant to the current query. */
  export async function recall(query: string, limit = 3): Promise<Entry[]> {
    const entries = await readIndex()
    if (entries.length === 0) return []

    const queryLower = query.toLowerCase()
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1)

    // Simple TF scoring: count keyword matches
    const scored = entries.map((entry) => {
      let score = 0
      const text = (entry.summary + " " + entry.keywords.join(" ") + " " + entry.title).toLowerCase()
      for (const word of queryWords) {
        if (text.includes(word)) score += 1
      }
      // Boost recent entries
      const ageDays = (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24)
      const recencyBoost = Math.max(0, 1 - ageDays / 30) // decay over 30 days
      score += recencyBoost * 0.5
      return { entry, score }
    })

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry)
  }

  /** Format recalled entries for hybio injection. */
  export function formatRecall(entries: Entry[]): string {
    if (entries.length === 0) return ""
    const lines = [
      "<project-memory>",
      "## 项目历史上下文 (相关会话)",
      "",
      ...entries.map((e) =>
        [
          `### ${e.title} (${new Date(e.timestamp).toLocaleDateString("zh-CN")})`,
          `- Agent: ${e.agent} | 结果: ${e.outcome}`,
          `- 摘要: ${e.summary}`,
          e.keywords.length > 0 ? `- 关键词: ${e.keywords.join(", ")}` : "",
          "",
        ].join("\n"),
      ),
      "请在回答时参考以上历史上下文，避免重复之前的错误或重复已完成的实验。",
      "</project-memory>",
    ]
    return lines.join("\n")
  }

  /** Extract and store a session summary after it finishes. */
  export async function rememberSession(sessionID: string, messages?: MessageV2.WithParts[]): Promise<void> {
    const msgs = messages ?? []
    const lastAssistant = msgs.findLast((m) => m.info.role === "assistant" && (m.info as MessageV2.Assistant).finish)
    if (!lastAssistant) return
    const text = lastAssistant.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as MessageV2.TextPart).text)
      .join(" ")
      .slice(0, 500)
    if (text.length < 30) return
    const userMsg = msgs.findLast((m) => m.info.role === "user")
    const userText =
      userMsg?.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as MessageV2.TextPart).text)
        .join(" ") ?? ""
    const keywords = extractKeywords(userText)
    const entry = {
      sessionId: sessionID,
      title: userText.slice(0, 80) || "Untitled",
      summary: text.slice(0, 300),
      keywords,
      agent: (lastAssistant.info as MessageV2.Assistant).agent ?? "unknown",
      timestamp: Date.now(),
      outcome: text.includes("[SELF-CHECK PASSED]") ? "success" : text.length > 100 ? "partial" : "failed",
    }
    await remember(entry)
  }

  function extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "of",
      "in",
      "to",
      "for",
      "with",
      "on",
      "at",
      "by",
      "this",
      "that",
      "and",
      "or",
      "it",
      "be",
      "as",
      "from",
    ])
    return [
      ...new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !stopWords.has(w))
          .slice(0, 10),
      ),
    ]
  }
}
