import { describe, test, expect } from "bun:test"
import path from "path"
import { MessageV2 } from "../../src/session/message-v2"
import * as Inject from "../../src/session/prompt-inject"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"

function mkMsg(role: "user" | "assistant"): MessageV2.WithParts {
  const id = Identifier.ascending("message")
  const sid = Identifier.ascending("session")
  return {
    info: { id, sessionID: sid, role, time: { created: Date.now() } },
    parts: [],
  } as unknown as MessageV2.WithParts
}

function pushUserText(msg: MessageV2.WithParts, text: string) {
  msg.parts.push({
    id: Identifier.ascending("part"),
    messageID: msg.info.id,
    sessionID: msg.info.sessionID,
    type: "text",
    text,
  } as MessageV2.TextPart)
}

describe("prompt-inject", () => {
  test("injectResultDelivery adds result-delivery prompt for analysis requests", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "请分析这个数据集并运行差异表达分析")
    Inject.injectResultDelivery([msg], msg)
    const hp = msg.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("result-delivery-protocol")
  })

  test("injectResultDelivery uses compact direct-answer protocol for method questions", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "对单细胞 RNA-seq 数据做质控、归一化与聚类，并识别主要细胞类型")
    Inject.injectResultDelivery([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain("direct-answer-protocol")
    expect(text).toContain("≤ 20 lines")
  })

  test("injectResultDelivery idempotent", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "对单细胞 RNA-seq 数据做质控、归一化与聚类，并识别主要细胞类型")
    Inject.injectResultDelivery([msg], msg)
    Inject.injectResultDelivery([msg], msg)
    expect(msg.parts.filter((p: any) => p.hybio).length).toBe(1)
  })

  test("injectBiologyServiceContract adds scientific rigor contract", () => {
    const msg = mkMsg("user")
    Inject.injectBiologyServiceContract(msg)
    const hp = msg.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("Service Boundaries And Scientific Rigor")
  })

  test("injectBiologyServiceContract idempotent", () => {
    const msg = mkMsg("user")
    Inject.injectBiologyServiceContract(msg)
    Inject.injectBiologyServiceContract(msg)
    expect(msg.parts.filter((p: any) => p.hybio).length).toBe(1)
  })

  test("injectCorrectionContext flags corrected assumptions", () => {
    const prev = mkMsg("user")
    pushUserText(prev, "小鼠样本 10X 5' control vs model")
    const current = mkMsg("user")
    pushUserText(current, "纠正一下，样本是人不是小鼠")
    Inject.injectCorrectionContext([prev, current], current)
    const hp = current.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("interaction-correction")
  })

  test("injectSessionContext remembers conversation parameters", () => {
    const prev = mkMsg("user")
    pushUserText(prev, "小鼠样本 10X 5' control vs model")
    const current = mkMsg("user")
    pushUserText(current, "做单细胞分析")
    Inject.injectSessionContext([prev, current], current)
    const hp = current.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("species: 小鼠")
    expect((hp[0] as any).text).toContain("platform: 10X")
  })

  test("injectMultiQuestion requires separate answers", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "DIA重复怎么设？蛋白组和代谢组能联合吗？")
    Inject.injectMultiQuestion(msg)
    const hp = msg.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("multi-question")
  })

  test("injectResearchContract answers general methods questions without a data gate", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "没有数据文件时，如何选择 bulk RNA-seq 的归一化方法？")
    Inject.injectResearchContract([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain('intent="direct_answer"')
    expect(text).toContain("Direct-answer mode")
    expect(text).not.toContain("Execution is blocked")
  })

  test("injectDataGate skips general scRNA methodology questions", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "对单细胞 RNA-seq 数据做质控、归一化与聚类，并识别主要细胞类型")
    Inject.injectDataGate([msg], msg)
    expect(msg.parts.filter((p: any) => p.hybio).length).toBe(0)
  })

  test("injectDataGate blocks execution without files", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "请分析这个数据集并运行差异表达分析")
    Inject.injectDataGate([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain("DATA GATE")
  })

  test("injectLiteratureGate skips direct-answer method questions", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: async () => {
        const msg = mkMsg("user")
        pushUserText(msg, "对单细胞 RNA-seq 数据做质控、归一化与聚类，并识别主要细胞类型")
        await Inject.injectLiteratureGate(msg, {
          intent: "direct_answer",
          confidence: 0.75,
          knownContext: [],
          missingPremises: [],
          mustClarify: false,
          gates: [],
          coordinate: false,
          review: false,
        })
        expect(msg.parts.filter((p: any) => p.hybio).length).toBe(0)
      },
    })
  })

  test("injectResearchContract gates only missing execution prerequisites", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "请分析这个数据集并运行差异表达分析")
    Inject.injectResearchContract([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain('intent="data_analysis"')
    expect(text).toContain("Execution is blocked only by")
  })

  test("injectResearchContract tracks a Chinese correction across turns", () => {
    const prev = mkMsg("user")
    pushUserText(prev, "小鼠样本的对照组和处理组")
    const msg = mkMsg("user")
    pushUserText(msg, "纠正一下，不是小鼠而是人源样本；请比较两组。")
    Inject.injectResearchContract([prev, msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain('intent="correction"')
    expect(text).toContain("latest correction replace prior assumptions")
  })

  test("injectResearchContract does not coordinate an ordinary long question", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "请详细比较两种单细胞归一化方法的假设、优点、局限和适用条件，并说明何时应当进行敏感性分析。")
    Inject.injectResearchContract([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).not.toContain("Create a plan")
  })

  test("injectResearchContract separates final answers from internal execution", () => {
    const msg = mkMsg("user")
    pushUserText(msg, "请说明这次文献检索的进度和当前限制。")
    Inject.injectResearchContract([msg], msg)
    const text = (msg.parts.find((part: any) => part.hybio) as any).text
    expect(text).toContain("Keep the final answer separate from internal execution")
    expect(text).toContain("progress, failure, or reproduction")
    expect(text).toContain("completed scope, observable limits, and reproducible steps")
  })

  test("injectErrorRecovery adds recovery on errored tools", () => {
    const userMsg = mkMsg("user")
    const ast = mkMsg("assistant")
    ast.parts.push({
      id: Identifier.ascending("part"),
      messageID: ast.info.id,
      sessionID: userMsg.info.sessionID,
      type: "tool",
      tool: "bash",
      callID: "call1",
      state: { status: "error", error: "command not found" },
    } as MessageV2.ToolPart)
    Inject.injectErrorRecovery([ast], userMsg)
    const hp = userMsg.parts.filter((p: any) => p.hybio)
    expect(hp.length).toBe(1)
    expect((hp[0] as any).text).toContain("error-recovery")
  })

  test("injectErrorRecovery skips when no errors", () => {
    const userMsg = mkMsg("user")
    const ast = mkMsg("assistant")
    ast.parts.push({
      id: Identifier.ascending("part"),
      messageID: ast.info.id,
      sessionID: userMsg.info.sessionID,
      type: "tool",
      tool: "bash",
      callID: "call1",
      state: { status: "completed" },
    } as MessageV2.ToolPart)
    Inject.injectErrorRecovery([ast], userMsg)
    expect(userMsg.parts.filter((p: any) => p.hybio).length).toBe(0)
  })

  test("injectProjectResearch no-op without research context", async () => {
    await Instance.provide({
      directory: path.join(__dirname, "../.."),
      fn: () => {
        const msg = mkMsg("user")
        const before = msg.parts.length
        Inject.injectProjectResearch(msg)
        expect(msg.parts.length).toBe(before)
      },
    })
  })
})
