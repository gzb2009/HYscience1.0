import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { ContextBudget } from "./context-budget"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { TaskScope } from "./task-scope"
import { TaskDecisionState } from "./task-decisions"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    if (input.model.limit.context === 0) return false
    return ContextBudget.isOverflow(input.tokens, input.model)
  }

  export async function isProactive(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    if (input.model.limit.context === 0) return false
    return ContextBudget.isProactive(input.tokens, input.model)
  }

  export async function shouldCompact(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    if (await isOverflow(input)) return true
    return isProactive(input)
  }

  export async function shouldPrune(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return false
    if (input.model.limit.context === 0) return false
    return ContextBudget.shouldPrune(input.tokens, input.model)
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_FIRST = new Set([
    "bash",
    "grep",
    "glob",
    "webfetch",
    "websearch",
    "codesearch",
    "lsp",
    "batch",
    "notebook",
    "rkernel",
    "remote",
    "todo_read",
    "todo_write",
    "planwrite",
    "visualize",
    "pdf",
    "image",
    "dvc",
    "git",
  ])

  export function taskMessages(messages: MessageV2.WithParts[], scope: TaskScope.State | undefined) {
    return TaskScope.messages(messages, scope)
  }

  export function taskPrompt(scope: TaskScope.State | undefined) {
    const current = TaskScope.current(scope)
    if (!current) return ""
    const archived = scope?.items
      .filter((item) => item.status === "archived")
      .map((item) => `- ${item.id}: ${item.summary || "Archived; retrieve only when explicitly requested."}`)
      .join("\n")
    return [
      `<compaction-scope task_id="${current.id}">`,
      "Preserve current-task evidence, decisions, user corrections, and unresolved work. Do not carry old task details into the current summary.",
      ...(archived ? ["<archived-task-summaries>", archived, "</archived-task-summaries>"] : []),
      "</compaction-scope>",
    ].join("\n")
  }

  export async function decisionPrompt(sessionID: string, scope: TaskScope.State | undefined) {
    const current = TaskScope.current(scope)
    if (!current) return ""
    const state = await TaskDecisionState.load(sessionID, current.id)
    const merged = scope?.items.filter((item) => current.mergedScopeIDs?.includes(item.id)) ?? []
    const references = await Promise.all(
      merged.map(async (item) =>
        TaskDecisionState.format(item.id, await TaskDecisionState.load(sessionID, item.id), true),
      ),
    )
    return [TaskDecisionState.format(current.id, state), ...references].join("\n")
  }

  type PruneCandidate = { part: MessageV2.ToolPart; estimate: number; tier: "first" | "other" }

  function pruneTier(tool: string, protectedTools: string[]) {
    if (protectedTools.includes(tool)) return "protected"
    if (PRUNE_FIRST.has(tool)) return "first"
    return "other"
  }

  function collectPruneCandidates(msgs: MessageV2.WithParts[], protectedTools: string[]) {
    const first: PruneCandidate[] = []
    const other: PruneCandidate[] = []
    let total = 0
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "text" && part.text.includes("<rlm_state>")) continue
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if (pruneTier(part.tool, protectedTools) === "protected") continue
        if (part.state.time.compacted) break loop
        const estimate = Token.estimate(part.state.output)
        total += estimate
        if (total <= PRUNE_PROTECT) continue
        const candidate = { part, estimate, tier: pruneTier(part.tool, protectedTools) as "first" | "other" }
        if (candidate.tier === "first") first.push(candidate)
        if (candidate.tier === "other") other.push(candidate)
      }
    }

    return { first, other, total }
  }

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. low-value tools are pruned first.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const protectedTools = [
      "skill",
      "artifact",
      "read",
      "edit",
      "write",
      "apply_patch",
      ...(config.compaction?.protectedTools ?? []),
    ]
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const candidates = collectPruneCandidates(msgs, protectedTools)
    const picked: MessageV2.ToolPart[] = []
    let pruned = 0

    for (const candidate of [...candidates.first, ...candidates.other]) {
      if (pruned >= PRUNE_MINIMUM) break
      picked.push(candidate.part)
      pruned += candidate.estimate
    }

    log.info("found", { pruned, total: candidates.total, count: picked.length })
    if (pruned <= PRUNE_MINIMUM) return

    for (const part of picked) {
      if (part.state.status !== "completed") continue
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)
    }
    log.info("pruned", { count: picked.length })
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const session = await Session.get(input.sessionID)
    const messages = taskMessages(input.messages, session.taskScope)
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = [
      "Summarize the conversation above for continuation in a new session.",
      "",
      "Use this structure wrapped in <compaction-summary> tags:",
      "## task-state — current goal and unfinished work",
      "## key-decisions — constraints, corrections, and choices that must persist",
      "## artifacts — files, datasets, models, and important paths",
      "## tool-context — only tool results still needed for next steps",
      "## next-steps — ordered immediate actions",
    ].join("\n")
    const decisions = await decisionPrompt(input.sessionID, session.taskScope)
    const promptText =
      compacting.prompt ??
      [defaultPrompt, taskPrompt(session.taskScope), decisions, ...compacting.context].filter(Boolean).join("\n\n")
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessages(messages, model),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        hybio: true,
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )
}
