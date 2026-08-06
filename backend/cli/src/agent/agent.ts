import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_CRITIQUE from "./prompt/critique.txt"
import PROMPT_LITERATURE_REVIEW from "./prompt/literature-review.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_PHYSICS_CRITIQUE from "./prompt/physics-critique.txt"
import PROMPT_REVIEWER from "./prompt/reviewer.txt"
import PROMPT_RESEARCH from "./prompt/research-core-v2.txt"
// Biology prompt split: core always loaded, stage prompts on demand
import PROMPT_BIOLOGY from "./prompt/biology-core-v2.txt"
import PROMPT_PHYSICS from "./prompt/physics.txt"
import PROMPT_ML from "./prompt/ml.txt"
import PROMPT_WRITE from "./prompt/write.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"
import { Plugin } from "@/plugin"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      promptText: z.string().optional(),
      gates: z.array(z.enum(["literature", "task_profile", "compute"])).optional(),
      hasArtifact: z.boolean().optional(),
      biologyQueries: z.boolean().optional(),
      biologyRuntime: z.boolean().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      mcp: "ask",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})
    const perm = (overrides: Parameters<typeof PermissionNext.fromConfig>[0]) =>
      PermissionNext.merge(defaults, PermissionNext.fromConfig(overrides), user)

    const result: Record<string, Info> = {
      // --- Research modes (top) ---
      research: {
        name: "research",
        steps: 50,
        description:
          "Scientific research agent — literature review, data analysis, GPU compute, and synthesis across 241 skills.",
        promptText: PROMPT_RESEARCH,
        gates: ["literature", "task_profile", "compute"],
        hasArtifact: true,
        biologyQueries: true,
        options: {},
        color: "#06b6d4",
        permission: perm({ question: "allow", plan_enter: "allow" }),
        mode: "primary",
        native: true,
      },
      // --- Domain agents ---
      biology: {
        name: "biology",
        steps: 40,
        description:
          "Computational biology agent — bioinformatics analysis, 30+ biological database integrations, and systematic data-to-answer workflows.",
        promptText: PROMPT_BIOLOGY,
        gates: ["literature", "task_profile", "compute"],
        hasArtifact: true,
        biologyQueries: true,
        biologyRuntime: true,
        options: {},
        color: "#10b981",
        permission: perm({ question: "allow" }),
        mode: "all",
        native: true,
      },
      // --- Physics ---
      physics: {
        name: "physics",
        steps: 40,
        description:
          "Computational physics agent — simulation, PDE solving, dynamical systems, symbolic regression, data analysis, and scientific computing.",
        promptText: PROMPT_PHYSICS,
        gates: ["compute"],
        options: {},
        color: "#8b5cf6",
        permission: perm({ question: "allow" }),
        mode: "all",
        native: true,
      },
      // --- Machine learning ---
      ml: {
        name: "ml",
        steps: 50,
        description:
          "Machine learning agent — trains, evaluates, and analyzes models end-to-end (deep learning, LLMs, classical ML, RL) with rigorous evaluation, and builds specialized models to replace frontier APIs.",
        promptText: PROMPT_ML,
        gates: ["compute"],
        hasArtifact: true,
        options: {},
        color: "#6366f1",
        permission: perm({ question: "allow" }),
        mode: "all",
        native: true,
      },
      // --- Utilities ---
      write: {
        name: "write",
        steps: 30,
        description:
          "Scientific & technical writing. Produces LaTeX papers, grants, literature reviews with verified citations and figures.",
        promptText: PROMPT_WRITE,
        options: {},
        color: "#a78bfa",
        permission: perm({ question: "allow" }),
        mode: "subagent",
        native: true,
      },
      plan: {
        name: "plan",
        steps: 30,
        description: "Plan mode. Disallows all edit tools.",
        options: {},
        permission: perm({
          question: "allow",
          plan_exit: "allow",
          external_directory: { [path.join(Global.Path.data, "plans", "*")]: "allow" },
          edit: {
            "*": "deny",
            [path.join(".hyscience", "plans", "*.md")]: "allow",
            [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
          },
        }),
        mode: "primary",
        native: true,
      },
      // --- Subagents (not shown in picker) ---
      task: {
        name: "task",
        steps: 30,
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: perm({ todoread: "deny", todowrite: "deny" }),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: perm({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          read: "allow",
          external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" },
        }),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      "literature-review": {
        name: "literature-review",
        description:
          "Full PRISMA literature review — systematic search, screening, eligibility, synthesis, verification.",
        permission: perm({
          "*": "deny",
          bash: "allow",
          read: "allow",
          glob: "allow",
          grep: "allow",
          webfetch: "allow",
          websearch: "allow",
          codesearch: "allow",
          skill: "allow",
        }),
        prompt: PROMPT_LITERATURE_REVIEW,
        options: {},
        color: "#818cf8",
        mode: "subagent",
        native: true,
      },
      critique: {
        name: "critique",
        steps: 60,
        description:
          "Scientific critique specialist. Finds blocking errors — data leakage, wrong statistics, unsupported claims — in research artifacts before expensive or irreversible actions. Read-only.",
        permission: perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", skill: "allow" }),
        prompt: PROMPT_CRITIQUE,
        options: {},
        color: "#ef4444",
        mode: "subagent",
        native: true,
      },
      "physics-critique": {
        name: "physics-critique",
        steps: 60,
        description:
          "Physics critique specialist — validates computational physics results (PDE solutions, PINN outputs, fitted parameters) against rigorous physical and numerical criteria. Blind to generator reasoning (Aletheia pattern). Read-only.",
        permission: perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", bash: "allow" }),
        prompt: PROMPT_PHYSICS_CRITIQUE,
        options: {},
        color: "#c084fc",
        mode: "subagent",
        native: true,
      },
      reviewer: {
        name: "reviewer",
        steps: 60,
        hidden: true,
        description:
          "Blind, adversarial reviewer of research outputs. Traces every claim, number, and figure back to the provenance DAG and evidence — flags citation mismatches, untraceable numbers, and figure/stat mismatches. Read-only.",
        permission: perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", bash: "allow", skill: "allow" }),
        prompt: PROMPT_REVIEWER,
        options: {},
        color: "#f59e0b",
        mode: "subagent",
        native: true,
      },
      // --- Hidden system agents ---
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: perm({ "*": "deny" }),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: perm({ "*": "deny" }),
        prompt: PROMPT_TITLE,
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = value.prompt ?? item.prompt
      item.promptText = value.promptText ?? item.promptText
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.gates = value.gates ?? item.gates
      item.hasArtifact = value.hasArtifact ?? item.hasArtifact
      item.biologyQueries = value.biologyQueries ?? item.biologyQueries
      item.biologyRuntime = value.biologyRuntime ?? item.biologyRuntime
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "research"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
