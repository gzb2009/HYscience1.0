import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { mkdtemp, writeFile } from "fs/promises"
import { DataProfile } from "../../src/session/data-profile"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

function msg(text: string, files: string[] = []): MessageV2.WithParts {
  const id = Identifier.ascending("message")
  const sessionID = Identifier.ascending("session")
  return {
    info: { id, sessionID, role: "user", time: { created: Date.now() } },
    parts: [
      { id: Identifier.ascending("part"), messageID: id, sessionID, type: "text", text },
      ...files.map((file) => ({
        id: Identifier.ascending("part"),
        messageID: id,
        sessionID,
        type: "file",
        mime: "application/octet-stream",
        url: `file://${file}`,
      })),
    ],
  } as unknown as MessageV2.WithParts
}

const python = await (async () => {
  try {
    const proc = Bun.spawn(["python3", "--version"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
})()

describe("DataProfile", () => {
  test("collects attached files and mentioned paths, capped and deduped", () => {
    const dir = "/tmp/proj"
    const item = msg("请分析 data/markers.csv 和 /abs/cells.h5ad，忽略 notes.txt", ["/abs/cells.h5ad"])
    expect(DataProfile.candidates(item, dir).sort()).toEqual(["/abs/cells.h5ad", "/tmp/proj/data/markers.csv"])
  })

  test.skipIf(!python)("profiles a marker table with real python and injects measured facts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-profile-"))
    const file = path.join(dir, "cluster_markers.csv")
    await writeFile(
      file,
      [
        "cluster,gene,avg_log2FC,p_val_adj,pct.1",
        "0,CD3E,2.1,1e-50,0.9",
        "0,CD3D,1.9,1e-40,0.85",
        "1,MS4A1,3.2,1e-80,0.95",
      ].join("\n"),
    )
    const item = msg("注释这些 cluster", [file])
    await DataProfile.inject(item, dir)
    const block = item.parts.find(
      (part) => part.type === "text" && (part as MessageV2.TextPart).hybio,
    ) as MessageV2.TextPart
    expect(block.text).toContain('kind="table"')
    expect(block.text).toContain("3 rows")
    expect(block.text).toContain("columns: cluster, gene, avg_log2FC, p_val_adj, pct.1")
    expect(block.text).toContain("numeric: cluster, avg_log2FC, p_val_adj, pct.1")
    await DataProfile.inject(item, dir)
    expect(item.parts.filter((part) => part.type === "text" && (part as MessageV2.TextPart).hybio)).toHaveLength(1)
  })

  test.skipIf(!python)("an h5ad without anndata/h5py degrades to an explicit unavailable note", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hy-profile-"))
    const file = path.join(dir, "cells.h5ad")
    await writeFile(file, "not really hdf5")
    const summary = await DataProfile.profile(file)
    expect(summary?.status === "unavailable" || summary?.status === "error").toBe(true)
    const text = DataProfile.render(file, summary!)
    expect(text).toContain("Do not guess its contents")
  })

  test("missing files are skipped silently", async () => {
    const item = msg("看看 /nonexistent/x.h5ad")
    await DataProfile.inject(item, "/tmp")
    expect(item.parts.some((part) => part.type === "text" && (part as MessageV2.TextPart).hybio)).toBe(false)
  })
})
