import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { $ } from "bun"
import DESCRIPTION from "./git.txt"

const GitParams = z.object({
  operation: z.enum(["commit", "diff", "log", "branch", "status"]),
  message: z.string().optional(),
  branch: z.string().optional(),
  files: z.array(z.string()).optional(),
})

export const GitTool = Tool.define("git", async () => {
  return {
    description: DESCRIPTION,
    parameters: GitParams,
    async execute(params) {
      const cwd = Instance.worktree
      const run = (args: string[]) => $`git ${args}`.cwd(cwd).quiet().nothrow()

      switch (params.operation) {
        case "status": {
          const r = await run(["status", "--short"])
          return { title: "Git status", metadata: {}, output: r.text() }
        }
        case "diff": {
          const r = await run(["diff", "--stat"])
          const out = r.text().trim() || "Working directory clean."
          return { title: "Git diff", metadata: {}, output: out }
        }
        case "log": {
          const r = await run(["log", "--oneline", "-10"])
          return { title: "Recent commits", metadata: {}, output: r.text() || "No commits yet." }
        }
        case "commit": {
          if (!params.message) throw new Error("message is required for commit")
          await run(params.files?.length ? ["add", ...params.files] : ["add", "-A"])
          const r = await run(["commit", "-m", params.message])
          if (r.exitCode !== 0) throw new Error(r.stderr.toString())
          return { title: `Committed: ${params.message}`, metadata: {}, output: r.text() }
        }
        case "branch": {
          if (params.branch) {
            const r = await run(["checkout", "-b", params.branch])
            if (r.exitCode !== 0) throw new Error(r.stderr.toString())
            return { title: `Branch: ${params.branch}`, metadata: {}, output: r.text() }
          }
          const r = await run(["branch"])
          return { title: "Branches", metadata: {}, output: r.text() }
        }
        default:
          throw new Error(`Unknown operation: ${params.operation}`)
      }
    },
  }
})
