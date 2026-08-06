import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Instance } from "../../src/project/instance"
import { File } from "../../src/file"

describe("File.rename", () => {
  const root = path.join(os.tmpdir(), `hyscience-rename-${process.pid}-${Date.now()}`)

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  })

  test("renames a file inside the project directory", async () => {
    await fs.mkdir(root, { recursive: true })
    await Bun.write(path.join(root, "a.png"), "png")
    await Instance.provide({
      directory: root,
      fn: async () => {
        const result = await File.rename({ from: "a.png", to: "b.png" })
        expect(result.renamed).toBe(true)
        expect(await Bun.file(path.join(root, "a.png")).exists()).toBe(false)
        expect(await Bun.file(path.join(root, "b.png")).exists()).toBe(true)
      },
    })
  })

  test("rejects overwrite of an existing target", async () => {
    await fs.mkdir(root, { recursive: true })
    await Bun.write(path.join(root, "a.png"), "a")
    await Bun.write(path.join(root, "b.png"), "b")
    await Instance.provide({
      directory: root,
      fn: async () => {
        await expect(File.rename({ from: "a.png", to: "b.png" })).rejects.toThrow(/already exists/)
      },
    })
  })
})
