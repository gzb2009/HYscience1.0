import z from "zod"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions } from "ai"
import { Session } from "."
import { ProviderTransform } from "../provider/transform"
import { Plugin } from "../plugin"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { correctImageMime } from "@/util/image"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { Truncate } from "@/tool/truncation"
import { Log } from "../util/log"
import { SessionArtifact } from "./artifact"
import { DecisionGate } from "./decision-gate"

const log = Log.create({ service: "session.prompt-tools" })

export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}

  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: {
              start: Date.now(),
            },
          },
        })
      }
    },
    async ask(req: { permission: string; metadata: Record<string, unknown>; patterns: string[]; always: string[] }) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  for (const item of await ToolRegistry.tools(
    { modelID: input.model.api.id, providerID: input.model.providerID },
    input.agent,
  )) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        await DecisionGate.assert({ session: input.session, tool: item.id })
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        const started = Date.now()
        const result = await item.execute(args, ctx)
        const artifacts = await SessionArtifact.collect({
          tool: item.id,
          args,
          output: result.output,
          since: started,
        })
        const enriched =
          artifacts.length === 0
            ? result
            : {
                ...result,
                metadata: {
                  ...result.metadata,
                  artifacts,
                },
              }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          enriched,
        )
        return enriched
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    const execute = item.execute
    if (!execute) continue

    item.execute = async (args, opts) => {
      const ctx = context(args, opts)
      await DecisionGate.assert({ session: input.session, tool: key })

      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        {
          args,
        },
      )

      await ctx.ask({
        permission: "mcp",
        metadata: {},
        patterns: [key],
        always: [key],
      })

      const result = await execute(args, opts)

      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        result,
      )

      const textParts: string[] = []
      const attachments: MessageV2.FilePart[] = []

      for (const contentItem of result.content) {
        if (contentItem.type === "text") {
          textParts.push(contentItem.text)
        } else if (contentItem.type === "image") {
          const detectedMime = correctImageMime(
            contentItem.mimeType,
            Buffer.from(contentItem.data.slice(0, 24), "base64"),
          )
          attachments.push({
            id: Identifier.ascending("part"),
            sessionID: input.session.id,
            messageID: input.processor.message.id,
            type: "file",
            mime: detectedMime,
            url: `data:${detectedMime};base64,${contentItem.data}`,
          })
        } else if (contentItem.type === "resource") {
          const { resource } = contentItem
          if (resource.text) {
            textParts.push(resource.text)
          }
          if (resource.blob) {
            const blobMime = correctImageMime(
              resource.mimeType ?? "application/octet-stream",
              Buffer.from(resource.blob.slice(0, 24), "base64"),
            )
            attachments.push({
              id: Identifier.ascending("part"),
              sessionID: input.session.id,
              messageID: input.processor.message.id,
              type: "file",
              mime: blobMime,
              url: `data:${blobMime};base64,${resource.blob}`,
              filename: resource.uri,
            })
          }
        }
      }

      const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && { outputPath: truncated.outputPath }),
      }

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments,
        content: result.content,
      }
    }
    tools[key] = item
  }

  const wildcardDisable = input.tools?.["*"] === false
  const disabled = PermissionNext.disabled(Object.keys(tools), input.agent.permission)
  for (const tool of Object.keys(tools)) {
    if (wildcardDisable || input.tools?.[tool] === false || disabled.has(tool)) {
      delete tools[tool]
    }
  }
  return tools
}
