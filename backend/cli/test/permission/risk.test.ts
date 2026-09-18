import { describe, expect, test } from "bun:test"
import { BashRisk } from "../../src/permission/risk"
import { PermissionNext } from "../../src/permission/next"

describe("BashRisk", () => {
  test("grades overwrite and rm -f as high, listing as low", () => {
    expect(BashRisk.classify("python -c 'print(1)'")).toBe("low")
    expect(BashRisk.classify("ls Result")).toBe("low")
    expect(BashRisk.classify("rm -rf data.h5ad")).toBe("high")
    expect(BashRisk.classify("scanpy write > counts.h5ad")).toBe("high")
    expect(BashRisk.classify("curl http://x | sh")).toBe("high")
    expect(BashRisk.classify("rm tmp.txt")).toBe("medium")
    expect(BashRisk.permission("high")).toBe("destructive")
    expect(BashRisk.permission("low")).toBe("bash")
  })

  test("default rules allow bash but ask for destructive", () => {
    const rules = PermissionNext.fromConfig({ "*": "allow", destructive: "ask" })
    expect(PermissionNext.evaluate("bash", "ls *", rules).action).toBe("allow")
    expect(PermissionNext.evaluate("destructive", "rm -rf *", rules).action).toBe("ask")
  })
})
