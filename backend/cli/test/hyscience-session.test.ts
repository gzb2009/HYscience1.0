import { test, expect } from "bun:test"
import { HYscience } from "../src/hyscience"

test("getSession returns null in local-first builds", async () => {
  expect(await HYscience.getSession()).toBeNull()
})
