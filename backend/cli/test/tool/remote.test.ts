import { describe, expect, test } from "bun:test"
import { ComputeSettings } from "../../src/server/routes/settings/compute"
import type { PermissionNext } from "../../src/permission/next"
import { RemotePlan, RemoteTool } from "../../src/tool/remote"

describe("tool.remote plans", () => {
  test("binds an approval to the configured host and exact command", () => {
    const host = {
      id: "cluster-a",
      label: "Cluster A",
      host: "hpc.example.edu",
      user: "researcher",
    }
    const first = RemotePlan.create({
      host,
      command: "sbatch train.sh",
      description: "Submit training job",
    })
    const second = RemotePlan.create({
      host,
      command: "sbatch evaluate.sh",
      timeout: 45_000,
      description: "Submit evaluation job",
    })

    expect(first.target).toBe("researcher@hpc.example.edu")
    expect(first.timeout_ms).toBe(120_000)
    expect(second.timeout_ms).toBe(45_000)
    expect(RemotePlan.pattern(first)).toStartWith("cluster-a:sha256:")
    expect(RemotePlan.pattern(first)).not.toBe(RemotePlan.pattern(second))
  })

  test("requires approval before opening an SSH connection", async () => {
    const label = `approval-test-${Math.random().toString(36).slice(2)}`
    const info = await ComputeSettings.addSshHost({ label, host: "localhost" })
    const host = info.ssh_hosts.find((item) => item.label === label)
    if (!host) throw new Error("test SSH host was not created")

    try {
      const tool = await RemoteTool.init()
      const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
      await expect(
        tool.execute(
          {
            command: "echo should-not-run",
            host_id: host!.id,
            description: "Verify remote approval",
          },
          {
            sessionID: "ses_test",
            messageID: "msg_test",
            callID: "call_test",
            agent: "research",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async (request) => {
              requests.push(request)
              throw new Error("approval required")
            },
          },
        ),
      ).rejects.toThrow("approval required")

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        permission: "remote",
        always: [],
        metadata: {
          command: "echo should-not-run",
        },
      })
      expect(requests[0]!.patterns).toHaveLength(1)
      expect(requests[0]!.patterns[0]).toStartWith(`${host.id}:sha256:`)
    } finally {
      await ComputeSettings.removeSshHost(host.id)
    }
  })
})
