import { describe, expect, test } from "bun:test"
import { createCatalogCache } from "./skillCatalog"

describe("createCatalogCache", () => {
  test("dedupes in-flight loads", async () => {
    let calls = 0
    const cache = createCatalogCache(async () => {
      calls += 1
      await Promise.resolve()
      return ["scanpy", "imc-analysis"]
    })
    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect(calls).toBe(1)
    expect(a).toEqual(b)
    expect(cache.peek()).toEqual(["scanpy", "imc-analysis"])
  })

  test("serves memory after the first load", async () => {
    let calls = 0
    const cache = createCatalogCache(async () => {
      calls += 1
      return ["squidpy"]
    })
    await cache.get()
    await cache.get()
    expect(calls).toBe(1)
  })

  test("invalidate forces one new load", async () => {
    let calls = 0
    const cache = createCatalogCache(async () => {
      calls += 1
      return [`v${calls}`]
    })
    expect(await cache.get()).toEqual(["v1"])
    cache.invalidate()
    expect(await cache.get()).toEqual(["v2"])
    expect(calls).toBe(2)
  })
})
