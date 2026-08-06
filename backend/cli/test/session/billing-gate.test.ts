import { describe, expect, test } from "bun:test"
import {
  isCodexOAuthProvider,
  requiresWalletBalance,
  shouldReportUsage,
  type CredentialSource,
} from "../../src/session/billing-gate"

describe("billing-gate", () => {
  describe("isCodexOAuthProvider", () => {
    test("true for the synthesized openai-codex provider", () => {
      expect(isCodexOAuthProvider("openai-codex")).toBe(true)
    })
    test("false for the plain openai provider", () => {
      expect(isCodexOAuthProvider("openai")).toBe(false)
    })
  })

  describe("requiresWalletBalance (pre-flight gate)", () => {
    test("local-first build never gates on wallet balance", () => {
      const sources: CredentialSource[] = ["byok", "oauth-free"]
      for (const source of sources) expect(requiresWalletBalance(source)).toBe(false)
    })
  })

  describe("shouldReportUsage", () => {
    test("local-first build never reports usage to a cloud backend", () => {
      const sources: CredentialSource[] = ["byok", "oauth-free"]
      for (const source of sources) expect(shouldReportUsage(source)).toBe(false)
    })
  })
})
