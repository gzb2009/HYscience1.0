import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { ClaimLedger } from "../../src/session/claim-ledger"
import { tmpdir } from "../fixture/fixture"

const output = (finding: string) =>
  [
    "<rlm_result>",
    "<status>success</status>",
    `<findings>${JSON.stringify([finding])}</findings>`,
    "<failures>[]</failures>",
    "<assumptions>[]</assumptions>",
    "<parameters>{}</parameters>",
    `<artifact_refs>${JSON.stringify(["results/evidence.csv"])}</artifact_refs>`,
    "<suggestions>[]</suggestions>",
    "</rlm_result>",
  ].join("\n")

describe("claim ledger", () => {
  test("persists verified branch claims and marks contradictory claims conflicted", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await ClaimLedger.record({
          sessionID: "ses_claims",
          taskID: "task_current",
          branch: "branch_a",
          output: output("Marker A is present"),
        })
        expect(first.claims[0].status).toBe("verified")

        const merged = await ClaimLedger.record({
          sessionID: "ses_claims",
          taskID: "task_current",
          branch: "branch_b",
          output: output("Marker A is not present"),
        })
        expect(merged.claims).toHaveLength(2)
        expect(merged.claims.every((claim) => claim.status === "conflicted")).toBe(true)
        expect(ClaimLedger.format(merged)).toContain("Parent aggregation may include only validated-claims")
      },
    })
    await fs.rm(path.join(tmp.path, ".hyscience"), { recursive: true, force: true })
  })

  test("keeps claims without structured evidence out of parent aggregation", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const state = await ClaimLedger.record({
          sessionID: "ses_unverified",
          taskID: "task_current",
          branch: "branch_a",
          output: '<rlm_result><status>success</status><findings>["Unverified result"]</findings></rlm_result>',
        })
        expect(state.claims[0].status).toBe("unverified")
        expect(ClaimLedger.format(state)).not.toContain("- Unverified result [")
      },
    })
  })

  test("bounds ledger context without promoting omitted claims", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const state = await ClaimLedger.record({
          sessionID: "ses_bounded",
          taskID: "task_current",
          branch: "branch_a",
          output: output("A".repeat(2_000)),
        })
        const formatted = ClaimLedger.format(state, 600)

        expect(formatted.length).toBeLessThanOrEqual(600)
        expect(formatted).toContain("<claim-ledger>")
        expect(formatted).toContain("</claim-ledger>")
        expect(formatted).not.toContain("A".repeat(2_000))
      },
    })
  })
})
