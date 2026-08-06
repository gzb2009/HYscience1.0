import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { localEnvironment } from "../../src/mcp/environment"

describe("local MCP environment", () => {
  test("uses the safe environment mode by default", () => {
    const config = Config.McpLocal.parse({
      type: "local",
      command: ["example-mcp"],
    })
    const env = localEnvironment({
      command: "example-mcp",
      config,
      source: {
        PATH: "/usr/bin",
        HOME: "/home/researcher",
        GITHUB_TOKEN: "gh-secret",
        OPENAI_API_KEY: "sk-secret",
        AWS_ACCESS_KEY_ID: "aws-secret",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
      },
      platform: "linux",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/researcher",
    })
  })

  test("passes only explicitly configured MCP credentials beyond the safe baseline", () => {
    const config = Config.McpLocal.parse({
      type: "local",
      command: ["example-mcp"],
      environment: {
        EXAMPLE_MCP_TOKEN: "explicit-secret",
        HTTPS_PROXY: "http://proxy.example",
      },
    })
    const env = localEnvironment({
      command: "example-mcp",
      config,
      source: {
        PATH: "/usr/bin",
        EXAMPLE_MCP_TOKEN: "host-secret",
        DATABASE_URL: "postgres://host-secret",
      },
      platform: "linux",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      EXAMPLE_MCP_TOKEN: "explicit-secret",
      HTTPS_PROXY: "http://proxy.example",
    })
  })

  test("preserves BUN_BE_BUN for the bundled hyscience command", () => {
    const config = Config.McpLocal.parse({
      type: "local",
      command: ["hyscience", "mcp"],
    })
    const env = localEnvironment({
      command: "hyscience",
      config,
      source: { PATH: "/usr/bin" },
      platform: "linux",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      BUN_BE_BUN: "1",
    })
  })

  test("supports explicit full inheritance for legacy MCP servers", () => {
    const config = Config.McpLocal.parse({
      type: "local",
      command: ["legacy-mcp"],
      environmentMode: "inherit",
      environment: {
        LEGACY_MCP_TOKEN: "configured-secret",
      },
    })
    const env = localEnvironment({
      command: "legacy-mcp",
      config,
      source: {
        PATH: "/usr/bin",
        LEGACY_MCP_TOKEN: "host-secret",
        CUSTOM_RUNTIME_FLAG: "1",
      },
      platform: "linux",
    })

    expect(env).toEqual({
      PATH: "/usr/bin",
      LEGACY_MCP_TOKEN: "configured-secret",
      CUSTOM_RUNTIME_FLAG: "1",
    })
  })
})
