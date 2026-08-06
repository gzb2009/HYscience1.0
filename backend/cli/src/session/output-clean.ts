import { MessageV2 } from "./message-v2"
import { Session } from "."

/**
 * Output cleaner — strips reviewer residuals, redundant file references,
 * and other noise from final assistant answers before delivery.
 */

export namespace OutputClean {
  // Patterns that indicate reviewer/critique sub-agent leakage
  const REVIEWER_PATTERNS = [
    /^Reviewer\s*\(@reviewer\)\s*[—–-]\s*blind review[\s\S]*?(?=\n\n|\n(?:##|[A-Z][a-z]))/gim,
    /^>?\s*Reviewer\s*\(@reviewer\)[\s\S]*?(?=\n\n|\n(?:##|[A-Z][a-z]))/gim,
    /\[SELF-CHECK (?:PASSED|FAILED)\]\s*\(reviewer\)[\s\S]*?(?=\n\n)/gim,
    /\[REVIEWER (?:NOTE|FLAG|WARNING)\][\s\S]*?(?=\n\n|\n(?:##|[A-Z][a-z]))/gim,
  ]

  // Patterns for useless file metadata that leaks into output
  const NOISE_PATTERNS = [
    /^\s*📁\s*.*\.(?:png|jpg|jpeg|svg|pdf)\s*[-–]\s*在文件夹中显示\s*$/gim,
    /^查看\s+.*\s+文件\s*·\s*(?:MD|PDF|PNG|CSV)\s+在文件夹中显示\s*$/gim,
    /^\s*AI\s+.*\s*·\s*(?:PDF|PNG|JPEG|Image)\s+在文件夹中显示\s*$/gim,
    /^在文件夹中显示\s*$/gim,
  ]

  // These remove only standalone, high-confidence orchestration narration.
  // Scientific uses such as "agent-based model", "re-run experiment", and
  // ordinary descriptions of a failure deliberately do not match.
  const INTERNAL_EXECUTION_PATTERNS = [
    /^\s*(?:收到|已收到|acknowledged)[。！!]*\s*$/i,
    /^\s*(?:我|我们|i|we)\s*(?:先|会先|将先|will first|['’]ll first)\s*(?:并行(?:地)?|parallel(?:ly)?|协调|orchestrat\w*).*(?:补一轮|启动|调用|重试|重跑|retry|rerun|sub-?agent|子智能体|工具|tool).*$/i,
    /^\s*(?:(?:\S+\s+)?(?:子智能体|sub-?agent)|\S+\s+agent)\s*(?:已|被|中途|was|has|had)?\s*(?:中断|超时|失败|重试|重跑|返回|完成|timed out|failed|retried|rerun|returned|completed).*$/i,
    /^\s*(?:正在|已|准备)?\s*(?:重试|重跑|重新运行|retrying|retried|rerunning)\s*(?:内部|该|the)?\s*(?:任务|步骤|workflow|task|operation)?[。！!]*\s*$/i,
  ]

  export function clean(text: string): string {
    let result = text

    // 1. If a reviewer block was appended, preserve only the answer before it.
    const reviewerHeading = result.search(/Reviewer\s*\(@reviewer\)/i)
    if (reviewerHeading >= 0) {
      result = result.slice(0, reviewerHeading)
    }

    // 2. Strip reviewer leakage
    for (const pattern of REVIEWER_PATTERNS) {
      result = result.replace(pattern, "").trim()
    }

    // 3. Strip noise file references
    for (const pattern of NOISE_PATTERNS) {
      result = result.replace(pattern, "").trim()
    }

    // 4. Remove standalone internal orchestration narration.
    result = result
      .split("\n")
      .filter((line) => !INTERNAL_EXECUTION_PATTERNS.some((pattern) => pattern.test(line)))
      .join("\n")

    // 5. Collapse multiple blank lines
    result = result.replace(/\n{3,}/g, "\n\n")

    // 6. Strip leading blank lines
    result = result.replace(/^\n+/, "")

    return result
  }

  /** Clean the final answer of the most recent assistant message in a session. */
  export async function cleanFinalAnswer(sessionID: string, messages?: MessageV2.WithParts[]): Promise<void> {
    const msgs = messages ?? (await Session.messages({ sessionID }))
    const last = msgs.findLast((m) => m.info.role === "assistant" && (m.info as MessageV2.Assistant).finish)
    if (!last) return
    for (const part of last.parts) {
      if (part.type !== "text") continue
      const cleaned = clean((part as MessageV2.TextPart).text)
      if (cleaned === (part as MessageV2.TextPart).text) continue
      await Session.updatePart({
        ...part,
        text: cleaned,
      } as MessageV2.TextPart)
    }
  }
}
