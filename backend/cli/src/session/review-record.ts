import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

export namespace ReviewRecord {
  export const Finding = z.object({
    severity: z.enum(["blocking", "warning"]),
    message: z.string(),
    evidence: z.array(z.string()).default([]),
  })
  export type Finding = z.infer<typeof Finding>

  export const Info = z
    .object({
      id: Identifier.schema("review"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      reviewerSessionID: Identifier.schema("session").optional(),
      agent: z.string(),
      reviewer: z.string(),
      verdict: z.enum(["CLEAN", "FLAGGED", "ERROR"]),
      mode: z.enum(["annotate", "enforce"]),
      findings: z.array(Finding),
      summary: z.string().optional(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      tokens: z
        .object({
          input: z.number(),
          output: z.number(),
          reasoning: z.number(),
          cache: z.object({
            read: z.number(),
            write: z.number(),
          }),
        })
        .optional(),
      cost: z.number().optional(),
      error: z.string().optional(),
      time: z.object({
        started: z.number(),
        completed: z.number(),
      }),
    })
    .meta({ ref: "ReviewRecord" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "review.updated",
      z.object({
        sessionID: Identifier.schema("session"),
        record: Info,
      }),
    ),
  }

  export async function save(record: Info) {
    await Storage.write(["review", record.sessionID, record.messageID], record)
    Bus.publish(Event.Updated, { sessionID: record.sessionID, record })
    return record
  }

  export async function get(sessionID: string, messageID: string) {
    return Storage.read<Info>(["review", sessionID, messageID]).catch(() => undefined)
  }

  export async function list(sessionID: string) {
    const records = await Promise.all(
      (await Storage.list(["review", sessionID])).map((key) => Storage.read<Info>(key).catch(() => undefined)),
    )
    return records
      .filter((record): record is Info => !!record)
      .sort((a, b) => a.time.started - b.time.started || a.messageID.localeCompare(b.messageID))
  }

  export async function remove(sessionID: string, messageID: string) {
    await Storage.remove(["review", sessionID, messageID]).catch(() => {})
  }

  export async function removeSession(sessionID: string) {
    for (const key of await Storage.list(["review", sessionID])) {
      await Storage.remove(key).catch(() => {})
    }
  }
}
