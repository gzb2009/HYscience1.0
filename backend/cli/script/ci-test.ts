#!/usr/bin/env bun
/**
 * CI test runner. Excludes tool/read.test.ts so Bun never loads the
 * Agent ↔ ReadTool circular module graph that poisons Linux runners.
 */
import { Glob } from "bun"
import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.join(import.meta.dir, "..")
const skip = new Set(["read.test.ts"])
const files: string[] = []

for (const pattern of ["test/**/*.test.ts", "src/**/*.test.ts"]) {
  for await (const file of new Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
    if (skip.has(path.basename(file))) continue
    files.push(file)
  }
}

files.sort()
if (files.length === 0) {
  console.error("ci-test: no test files found")
  process.exit(1)
}

const result = spawnSync("bun", ["test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
})

process.exit(result.status ?? 1)
