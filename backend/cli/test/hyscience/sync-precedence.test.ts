import { test, expect } from "bun:test"
import { HYscience } from "../../src/hyscience"

test("syncServices is a no-op in local-first builds", async () => {
  expect(await HYscience.syncServices()).toBeNull()
})
