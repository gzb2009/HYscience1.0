import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"

const storage = path.join(Global.Path.data, "storage")
const project = path.join(Global.Path.data, "project")

async function clean() {
  Storage.reset()
  await Promise.all([
    fs.rm(storage, { force: true, recursive: true }),
    fs.rm(project, { force: true, recursive: true }),
  ])
}

afterEach(clean)

test("retries a failed migration without advancing its version", async () => {
  await clean()
  const source = path.join(project, "broken", "storage", "session", "message", "message", "part.json")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await Bun.write(source, "{")

  await expect(Storage.write(["todo", "retry"], [])).rejects.toThrow()
  expect(await Bun.file(path.join(storage, "migration")).exists()).toBe(false)

  await Bun.write(source, JSON.stringify({ path: { root: "/missing-worktree" } }))
  await Storage.write(["todo", "retry"], [])

  expect(await Bun.file(path.join(storage, "migration")).text()).toBe("2")
  expect(await Storage.read<string[]>(["todo", "retry"])).toEqual([])
})

test("uses atomic writes and ignores a stale temporary file", async () => {
  await Storage.write(["todo", "atomic"], ["before"])
  const target = path.join(storage, "todo", "atomic.json")
  const stale = `${target}.${process.pid}.stale.tmp`
  await Bun.write(stale, '{"torn"')

  expect(await Storage.read<string[]>(["todo", "atomic"])).toEqual(["before"])
  await fs.unlink(stale)
  await Storage.update<string[]>(["todo", "atomic"], (draft) => draft.push("after"))

  expect(await Storage.read<string[]>(["todo", "atomic"])).toEqual(["before", "after"])
  expect(await fs.readdir(path.dirname(target))).toEqual(["atomic.json"])
})
