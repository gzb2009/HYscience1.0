import { describe, expect, test } from "bun:test"
import path from "path"
import { Glob } from "bun"

const root = path.join(import.meta.dir, "../../src")
const base = await Bun.file(path.join(root, "session/prompt/base-system.txt")).text()

async function others() {
  const out: { file: string; text: string }[] = []
  for (const dir of ["agent/prompt", "session/prompt"]) {
    for await (const file of new Glob("**/*.txt").scan(path.join(root, dir))) {
      if (file === "base-system.txt") continue
      out.push({ file: `${dir}/${file}`, text: await Bun.file(path.join(root, dir, file)).text() })
    }
  }
  return out
}

describe("prompt single source", () => {
  test("base-system owns the ask-first slot list and voice rules", () => {
    expect(base).toContain("准则 1")
    expect(base).toContain("准则 2")
    expect(base).toContain("question tool")
    expect(base).toContain("HGNC")
    expect(base).toContain("「已确认」「方向锁定」")
    expect(base).toContain("表格只用于 3 项以上")
  })

  test("other prompts do not restate the forbidden-phrase list", async () => {
    for (const item of await others()) {
      expect(item.text, item.file).not.toMatch(/已确认|方向锁定/)
    }
  })

  test("cell annotation table is conditional, not ALWAYS", async () => {
    const delivery = await Bun.file(path.join(root, "session/prompt/result-delivery.txt")).text()
    expect(delivery).not.toMatch(/ALWAYS include this table/)
    expect(base).toContain("方法问答和 panel 设计不套这张表")
  })

  test("resident biology prompt budget stays under 20 KB", async () => {
    const files = [
      "session/prompt/base-system.txt",
      "agent/prompt/research-core-v2.txt",
      "agent/prompt/biology-core-v2.txt",
      "agent/prompt/biology-service-contract.txt",
      "session/prompt/result-delivery.txt",
    ]
    const total = (await Promise.all(files.map((f) => Bun.file(path.join(root, f)).text()))).reduce(
      (sum, text) => sum + Buffer.byteLength(text),
      0,
    )
    expect(total).toBeLessThan(20 * 1024)
  })
})
