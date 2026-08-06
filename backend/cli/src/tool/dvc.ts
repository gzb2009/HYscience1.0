import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { $ } from "bun"
import DESCRIPTION from "./dvc.txt"

const DvcParams = z.object({
  operation: z.enum(["init", "add", "push", "status"]),
  target: z.string().optional(),
  remote: z.string().optional(),
})

export const DvcTool = Tool.define("dvc", async () => {
  return {
    description: DESCRIPTION,
    parameters: DvcParams,
    async execute(params) {
      const cwd = Instance.worktree
      const run = (args: string[]) => $`dvc ${args}`.cwd(cwd).quiet().nothrow()

      switch (params.operation) {
        case "init": {
          const r = await run(["init"])
          if (r.exitCode !== 0)
            throw new Error(`DVC init failed: ${r.stderr.toString()}. Install with: pip install dvc`)
          await $`dvc config core.autostage true`.cwd(cwd).quiet()
          return {
            title: "DVC initialized",
            metadata: {},
            output: "DVC initialized. Large files will be tracked with .dvc metafiles.",
          }
        }
        case "add": {
          if (!params.target) throw new Error("target is required for add operation")
          const r = await run(["add", params.target])
          if (r.exitCode !== 0) throw new Error(`DVC add failed: ${r.stderr.toString()}`)
          return { title: `DVC tracking: ${params.target}`, metadata: {}, output: r.text() }
        }
        case "push": {
          const args = params.remote ? ["push", "-r", params.remote] : ["push"]
          const r = await run(args)
          if (r.exitCode !== 0) throw new Error(`DVC push failed: ${r.stderr.toString()}`)
          return { title: "DVC push complete", metadata: {}, output: r.text() }
        }
        case "status": {
          const r = await run(["status"])
          return { title: "DVC status", metadata: {}, output: r.text() || "No changes in tracked data." }
        }
        default:
          throw new Error(`Unknown operation: ${params.operation}`)
      }
    },
  }
})
