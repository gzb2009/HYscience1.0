import type { AgentRouter } from "./agent-router"
import { InjectionPipeline } from "./injection-pipeline"

const RESEARCH_AGENTS = new Set(["research", "biology", "physics", "ml"])

function isDirectAnswer(contract: AgentRouter.Contract) {
  return contract.intent === "direct_answer" && !contract.mustClarify
}

function researchAgent(ctx: InjectionPipeline.TurnContext) {
  return RESEARCH_AGENTS.has(ctx.agent.name)
}

function notDirectAnswer(ctx: InjectionPipeline.TurnContext) {
  return !isDirectAnswer(ctx.contract)
}

export function scientificInjections(handlers: {
  experimentDesign: InjectionPipeline.Injection["run"]
  statsCheck: InjectionPipeline.Injection["run"]
  dataQuality: InjectionPipeline.Injection["run"]
  literatureCheck: InjectionPipeline.Injection["run"]
  causalCheck: InjectionPipeline.Injection["run"]
  metaAnalysis: InjectionPipeline.Injection["run"]
  activeLearning: InjectionPipeline.Injection["run"]
  crossValidate: InjectionPipeline.Injection["run"]
  designRe: RegExp
  statsRe: RegExp
  dataRe: RegExp
  litRe: RegExp
  causalRe: RegExp
  metaRe: RegExp
  activeRe: RegExp
}): InjectionPipeline.Injection[] {
  return [
    {
      name: "experiment-design",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.designRe.test(ctx.userText),
      run: handlers.experimentDesign,
    },
    {
      name: "stats-check",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.statsRe.test(ctx.userText),
      run: handlers.statsCheck,
    },
    {
      name: "data-quality",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.dataRe.test(ctx.userText),
      run: handlers.dataQuality,
    },
    {
      name: "literature-contradiction-check",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.litRe.test(ctx.userText),
      run: handlers.literatureCheck,
    },
    {
      name: "causal-inference",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.causalRe.test(ctx.userText),
      run: handlers.causalCheck,
    },
    {
      name: "meta-analysis",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.metaRe.test(ctx.userText),
      run: handlers.metaAnalysis,
    },
    {
      name: "active-learning",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && handlers.activeRe.test(ctx.userText),
      run: handlers.activeLearning,
    },
    {
      name: "cross-database-validation",
      tier: "scientific",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx) && ctx.userText.length >= 100,
      run: handlers.crossValidate,
    },
  ]
}

export function advisoryInjections(handlers: {
  agentRouter: InjectionPipeline.Injection["run"]
  refineLoop: InjectionPipeline.Injection["run"]
  coordinatorPlan: InjectionPipeline.Injection["run"]
  projectMemory: InjectionPipeline.Injection["run"]
}): InjectionPipeline.Injection[] {
  return [
    {
      name: "agent-router",
      tier: "advisory",
      when: researchAgent,
      run: handlers.agentRouter,
    },
    {
      name: "refine-loop",
      tier: "advisory",
      when: (ctx) => researchAgent(ctx) && notDirectAnswer(ctx),
      run: handlers.refineLoop,
    },
    {
      name: "coordinator-plan",
      tier: "advisory",
      when: (ctx) => researchAgent(ctx) && ctx.contract.coordinate,
      run: handlers.coordinatorPlan,
    },
    {
      name: "project-memory",
      tier: "advisory",
      when: (ctx) => researchAgent(ctx) && ctx.userText.length >= 30,
      run: handlers.projectMemory,
    },
  ]
}
