import type { ReviewRecord } from "@hysci/sdk/v2/client"

export function mergeReviews(current: ReviewRecord[], incoming: ReviewRecord[]) {
  const records = new Map(current.map((record) => [record.messageID, record]))
  for (const record of incoming) {
    const previous = records.get(record.messageID)
    if (previous && previous.time.completed > record.time.completed) continue
    records.set(record.messageID, record)
  }
  return [...records.values()].sort((a, b) => a.time.started - b.time.started || a.messageID.localeCompare(b.messageID))
}

export function reviewState(record: ReviewRecord | undefined) {
  if (!record) return { blocked: false, tone: "none" as const }
  const blocked = record.mode === "enforce" && record.verdict !== "CLEAN"
  if (blocked) return { blocked, tone: "blocked" as const }
  if (record.verdict === "CLEAN") return { blocked, tone: "clean" as const }
  if (record.verdict === "FLAGGED") return { blocked, tone: "flagged" as const }
  return { blocked, tone: "error" as const }
}

export function reviewHistory(records: ReviewRecord[]) {
  return [...records].sort((a, b) => b.time.started - a.time.started || b.messageID.localeCompare(a.messageID))
}

export function selectedReview(
  records: ReviewRecord[],
  sessionID: string | undefined,
  selection: { sessionID: string; messageID: string } | undefined,
) {
  const messageID = selection?.sessionID === sessionID ? selection?.messageID : undefined
  if (messageID) {
    const record = records.find((item) => item.messageID === messageID)
    if (record) return record
  }
  return records[0]
}
