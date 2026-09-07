import type { AgentRouter } from "./agent-router"

const REPORT_RE =
  /(?:文献调研|文献综述|调研报告|撰写.*(?:文献|报告|调研)|写一份.*(?:文献|调研|报告)|(?:做|进行|完成).{0,12}(?:文献)?调研|literature\s+survey|literature\s+review\s+report|systematic\s+literature)/i

const COMPUTE = new Set(["bash", "notebook", "rkernel", "remote"])

export namespace LiteratureGate {
  export function isReport(text: string, contract?: Pick<AgentRouter.Contract, "intent">) {
    if (REPORT_RE.test(text)) return true
    return contract?.intent === "literature_verification" && /(?:调研|综述|survey|review report)/i.test(text)
  }

  export function blocksCompute(tool: string) {
    return COMPUTE.has(tool)
  }

  export function assert(input: { tool: string; text: string; contract?: Pick<AgentRouter.Contract, "intent"> }) {
    if (!blocksCompute(input.tool)) return
    if (!isReport(input.text, input.contract)) return
    throw new Error(
      "Literature-report mode: bash/notebook/remote are blocked. Deliver the structured survey in chat first.",
    )
  }
}
