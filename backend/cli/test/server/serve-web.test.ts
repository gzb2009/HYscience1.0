import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"

describe("Server.listen web flag", () => {
  test("headless serve does not host the workspace SPA", async () => {
    const server = Server.listen({ port: 0 })
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { Accept: "text/html" },
    })
    const body = await res.text()
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(body).not.toContain('id="root"')
    expect(body).toContain("http://localhost:4444")
    const asset = await fetch(`http://127.0.0.1:${server.port}/index.html`)
    expect(asset.status).toBe(404)
    await server.stop(true)
  })

  test("headless API callers get a JSON pointer to the live UI", async () => {
    const server = Server.listen({ port: 0 })
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { Accept: "application/json" },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "headless-api", ui: "http://localhost:4444" })
    await server.stop(true)
  })

  test("web listen does not silently move to another port", async () => {
    const first = Server.listen({ port: 18776, web: true })
    expect(first.port).toBe(18776)
    expect(() => Server.listen({ port: 18776, web: true })).toThrow(/Stop the other hyscience/)
    await first.stop(true)
  })
})
