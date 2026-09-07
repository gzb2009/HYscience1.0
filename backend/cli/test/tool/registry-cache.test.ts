import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import { PermissionNext } from "../../src/permission/next"

describe("tool.registry.init cache", () => {
  test("research agent skips disabled tools before init", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          research: {
            permission: {
              bash: "deny",
              grep: "deny",
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("research")
        expect(agent).toBeDefined()
        const tools = await ToolRegistry.tools({ providerID: "anthropic", modelID: "claude-sonnet-4" }, agent)
        const ids = tools.map((t) => t.id)
        expect(ids).not.toContain("bash")
        expect(ids).not.toContain("grep")
        expect(ids).toContain("read")
      },
    })
  })

  test("reuses cached init for repeated calls", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("research")
        const model = { providerID: "anthropic", modelID: "claude-sonnet-4" }
        const first = await ToolRegistry.tools(model, agent)
        const second = await ToolRegistry.tools(model, agent)
        expect(first.length).toBe(second.length)
        expect(first.find((t) => t.id === "read")?.description).toBe(second.find((t) => t.id === "read")?.description)
      },
    })
  })
})

describe("tool.registry permission filter", () => {
  test("explore agent only receives read-only tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("explore")
        const tools = await ToolRegistry.tools({ providerID: "anthropic", modelID: "claude-sonnet-4" }, agent)
        const ids = new Set(tools.map((t) => t.id))
        expect(ids.has("read")).toBe(true)
        expect(ids.has("grep")).toBe(true)
        expect(ids.has("edit")).toBe(false)
        expect(PermissionNext.disabled([...ids], agent!.permission).size).toBe(0)
      },
    })
  })
})
