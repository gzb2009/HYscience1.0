import { test, expect } from "bun:test"
import { HYscience } from "../src/hyscience"

test("flushPendingUsage is a no-op in local-first builds", async () => {
  await HYscience.flushPendingUsage()
})
