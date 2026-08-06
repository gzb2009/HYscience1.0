import { test, expect } from "bun:test"
import { HYscience } from "../src/hyscience"

test("clearSession is a no-op in local-first builds", async () => {
  await HYscience.clearSession()
})
