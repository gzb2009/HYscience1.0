import z from "zod"
import { spawn } from "child_process"
import crypto from "crypto"
import { Tool } from "./tool"
import { ComputeSettings } from "../server/routes/settings/compute"
import { Truncate } from "./truncation"
import { ProcessEnvironment } from "@/process/environment"

const parameters = z.object({
  command: z.string().describe("Remote shell command to run"),
  host_id: z.string().optional().describe("SSH host id from Compute settings; defaults to first host"),
  timeout: z
    .number()
    .positive()
    .max(3_600_000)
    .optional()
    .describe("Timeout in milliseconds (default 120000; max one hour)"),
  description: z.string().describe("Short description of what this remote command does (5-10 words)"),
})

export namespace RemotePlan {
  export type Info = {
    id: string
    host_id: string
    host: string
    target: string
    command_digest: string
    timeout_ms: number
    description: string
  }

  export function create(input: {
    host: ComputeSettings.SshHost
    command: string
    timeout?: number
    description: string
  }): Info {
    const digest = crypto.createHash("sha256").update(input.command).digest("hex")
    const target = input.host.user ? `${input.host.user}@${input.host.host}` : input.host.host
    return {
      id: `remote-${input.host.id}-${digest.slice(0, 12)}`,
      host_id: input.host.id,
      host: input.host.host,
      target,
      command_digest: `sha256:${digest}`,
      timeout_ms: input.timeout ?? 120_000,
      description: input.description,
    }
  }

  export function pattern(plan: Info) {
    return `${plan.host_id}:${plan.command_digest}`
  }
}

type Metadata = {
  status: "ok" | "error"
  host_id?: string
  host?: string
  exit?: number
  truncated?: boolean
  plan?: RemotePlan.Info
  audit?: {
    status: "submitted" | "completed" | "failed"
    started_at: string
    completed_at?: string
  }
}

/**
 * Run a command on a configured SSH host (Settings → Compute → SSH hosts).
 * Auth uses the local SSH agent / default keys (BatchMode) — no private keys
 * are stored in HYscience. Prefer this when execution tier is `ssh`, or when
 * submitting Slurm jobs via the slurm-hpc skill.
 */
export const RemoteTool = Tool.define<typeof parameters, Metadata>("remote", {
  description: [
    "Prepare a remote command plan and execute it only after approval.",
    "Hosts come from Settings → Compute → SSH hosts.",
    "Each approval is bound to the selected host and exact command digest.",
    "Uses the local SSH agent / default keys (BatchMode=yes). Do not paste private keys.",
    "For Slurm: `remote` with `sbatch`/`squeue`/`scancel` (see skill `slurm-hpc`).",
    "Omit host_id to use the first configured host.",
  ].join("\n"),
  parameters,
  async execute(params, ctx) {
    const hosts = await ComputeSettings.listSshHosts()
    if (!hosts.length) {
      return {
        title: "remote: no hosts",
        output:
          "No SSH hosts configured. Add one in Settings → Compute → SSH hosts (label, host, optional user/port). Auth via local ssh-agent.",
        metadata: { status: "error" },
      }
    }
    const host = params.host_id ? hosts.find((h) => h.id === params.host_id) : hosts[0]
    if (!host) {
      return {
        title: "remote: unknown host",
        output: `No SSH host with id "${params.host_id}". Available: ${hosts.map((h) => `${h.id} (${h.label})`).join(", ")}`,
        metadata: { status: "error" },
      }
    }

    const plan = RemotePlan.create({
      host,
      command: params.command,
      timeout: params.timeout,
      description: params.description,
    })
    await ctx.ask({
      permission: "remote",
      patterns: [RemotePlan.pattern(plan)],
      // Remote execution is approved per plan. It cannot grant a broad
      // persistent allow rule through this tool.
      always: [],
      metadata: { plan, command: params.command },
    })

    const started = new Date().toISOString()
    ctx.metadata({
      title: `remote ${host.label}`,
      metadata: {
        status: "ok",
        host_id: host.id,
        host: host.host,
        plan,
        audit: { status: "submitted", started_at: started },
      },
    })

    const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15"]
    if (host.port) args.push("-p", String(host.port))
    args.push(plan.target, params.command)

    const timeout = plan.timeout_ms
    const env = await ProcessEnvironment.resolve("remote")
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn("ssh", args, { env })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        resolve({
          code: 124,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8") + "\n[timeout]",
        })
      }, timeout)
      child.stdout.on("data", (d) => out.push(d))
      child.stderr.on("data", (d) => err.push(d))
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        })
      })
      ctx.abort.addEventListener("abort", () => child.kill("SIGTERM"))
    })

    const raw = [
      `$ ssh ${plan.target} — ${params.description}`,
      result.stdout.trimEnd(),
      result.stderr.trim() ? `stderr:\n${result.stderr.trimEnd()}` : "",
      `exit ${result.code}`,
    ]
      .filter(Boolean)
      .join("\n")
    const out = await Truncate.output(raw, {}, undefined)
    return {
      title: `remote ${host.label}`,
      output: out.truncated ? out.content : raw,
      metadata: {
        status: result.code === 0 ? "ok" : "error",
        host_id: host.id,
        host: host.host,
        exit: result.code,
        truncated: out.truncated,
        plan,
        audit: {
          status: result.code === 0 ? "completed" : "failed",
          started_at: started,
          completed_at: new Date().toISOString(),
        },
      },
    }
  },
})
