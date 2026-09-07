import { expect, test } from "bun:test"
import { LiteratureGate } from "../../src/session/literature-gate"

test("flags literature survey requests", () => {
  expect(LiteratureGate.isReport("写一份CODEX的文献调研")).toBe(true)
  expect(LiteratureGate.isReport("literature survey of IMC neighborhood")).toBe(true)
  expect(LiteratureGate.isReport("对单细胞数据做质控聚类")).toBe(false)
})

test("blocks compute tools only in literature-report mode", () => {
  expect(LiteratureGate.blocksCompute("bash")).toBe(true)
  expect(LiteratureGate.blocksCompute("read")).toBe(false)
  expect(() => LiteratureGate.assert({ tool: "bash", text: "写一份文献调研" })).toThrow(/Literature-report/)
  expect(() => LiteratureGate.assert({ tool: "bash", text: "跑一下质控" })).not.toThrow()
  expect(() => LiteratureGate.assert({ tool: "read", text: "写一份文献调研" })).not.toThrow()
})
