import { Agent } from "../agent/agent"
import { AgentRouter } from "./agent-router"
import { MessageV2 } from "./message-v2"
import { Session } from "."

export namespace InjectionPipeline {
  export type Tier = "critical" | "scientific" | "advisory"

  export type TurnContext = {
    messages: MessageV2.WithParts[]
    userMessage: MessageV2.WithParts
    agent: Agent.Info
    session: Session.Info
    scopedMessages: MessageV2.WithParts[]
    contract: AgentRouter.Contract
    userText: string
  }

  export type Injection = {
    name: string
    tier: Tier
    when?: (ctx: TurnContext) => boolean
    run: (ctx: TurnContext) => void | Promise<void>
  }

  const TIER_ORDER: Tier[] = ["critical", "scientific", "advisory"]

  export function userText(messages: MessageV2.WithParts[]): string[] {
    return messages
      .filter((msg) => msg.info.role === "user")
      .map((msg) =>
        msg.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text")
          .map((p) => p.text)
          .join(" "),
      )
      .filter(Boolean)
  }

  export function plainUserText(userMessage: MessageV2.WithParts) {
    return userMessage.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.hybio)
      .map((part) => part.text)
      .join(" ")
  }

  export function interpretTurn(messages: MessageV2.WithParts[], userMessage: MessageV2.WithParts) {
    const text = plainUserText(userMessage)
    const history = userText(messages).slice(0, -1)
    const filenames = userMessage.parts
      .filter((part): part is MessageV2.FilePart => part.type === "file")
      .map((part) => part.filename ?? "")
      .filter(Boolean)
    return AgentRouter.interpret({ text, history, filenames })
  }

  export function buildTurnContext(input: {
    messages: MessageV2.WithParts[]
    userMessage: MessageV2.WithParts
    agent: Agent.Info
    session: Session.Info
    scopedMessages: MessageV2.WithParts[]
  }): TurnContext {
    const contract = interpretTurn(input.messages, input.userMessage)
    return {
      ...input,
      contract,
      userText: plainUserText(input.userMessage),
    }
  }

  export async function run(injections: Injection[], ctx: TurnContext, trace?: (name: string, tier: Tier) => void) {
    for (const tier of TIER_ORDER) {
      for (const injection of injections) {
        if (injection.tier !== tier) continue
        if (injection.when && !injection.when(ctx)) continue
        await injection.run(ctx)
        trace?.(injection.name, tier)
      }
    }
  }
}
