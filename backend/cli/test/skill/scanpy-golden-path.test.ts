import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const script = path.join(__dirname, "../../skills/biology/scanpy/scripts/pipeline.py")
const REQUIRED = [
  "adata.h5ad",
  "figures/umap_leiden.png",
  "figures/qc_violin.png",
  "markers.csv",
  "_script_manifest.jsonl",
]
const STAGES = ["load", "qc", "normalize", "hvg", "pca", "neighbors", "leiden", "rank_genes", "write"]

async function makeValidOutput(dir: string) {
  await fs.mkdir(path.join(dir, "figures"), { recursive: true })
  for (const rel of REQUIRED) await fs.writeFile(path.join(dir, rel), "ok\n")
  const manifest = STAGES.map((stage) => JSON.stringify({ stage, status: "ok" })).join("\n")
  await fs.writeFile(path.join(dir, "_script_manifest.jsonl"), manifest)
}

async function validate(dir: string) {
  const proc = Bun.spawn(["python3", script, "--validate", dir], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, stdout, stderr }
}

describe("scanpy golden path validation", () => {
  test("accepts a complete output directory", async () => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), ".scanpy-golden-ok-"))
    try {
      await makeValidOutput(dir)
      const result = await validate(dir)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("VALIDATION OK")
      expect(result.stderr).toBe("")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects an incomplete output directory", async () => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), ".scanpy-golden-bad-"))
    try {
      await makeValidOutput(dir)
      await fs.rm(path.join(dir, "markers.csv"))
      const result = await validate(dir)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("missing file: markers.csv")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
