import path from "path"
import { Global } from "@/global"
import { Instance } from "../../project/instance"
import { PermissionNext } from "@/permission/next"
import { Truncate } from "@/tool/truncation"
import type { Agent } from "../agent"
import { PromptLoader } from "../prompt-loader"
import { BUILTIN, type BuiltinDefinition, type PermissionPreset } from "./builtin"

type Perm = (overrides: Parameters<typeof PermissionNext.fromConfig>[0]) => PermissionNext.Ruleset

function permission(def: BuiltinDefinition, perm: Perm) {
  const preset = def.permission
  if (!preset) return perm({})
  if (typeof preset === "object") return perm(preset as Parameters<typeof PermissionNext.fromConfig>[0])

  const presets: Record<PermissionPreset, PermissionNext.Ruleset> = {
    default: perm({}),
    "deny-all": perm({ "*": "deny" }),
    plan: perm({
      question: "allow",
      plan_exit: "allow",
      external_directory: { [path.join(Global.Path.data, "plans", "*")]: "allow" },
      edit: {
        "*": "deny",
        [path.join(".hyscience", "plans", "*.md")]: "allow",
        [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
      },
    }),
    task: perm({ todoread: "deny", todowrite: "deny" }),
    explore: perm({
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
    "literature-review": perm({
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
    critique: perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", skill: "allow" }),
    "physics-critique": perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", bash: "allow" }),
    reviewer: perm({ "*": "deny", read: "allow", glob: "allow", grep: "allow", bash: "allow", skill: "allow" }),
  }

  return presets[preset]
}

export function loadBuiltin(input: { perm: Perm; vars?: Record<string, string> }) {
  const result: Record<string, Agent.Info> = {}

  for (const def of BUILTIN) {
    const prompt =
      def.promptFile && def.promptRole === "prompt" ? PromptLoader.load(def.promptFile, input.vars) : undefined
    const promptText =
      def.promptFile && def.promptRole === "promptText" ? PromptLoader.load(def.promptFile, input.vars) : undefined

    result[def.key] = {
      name: def.name,
      mode: def.mode,
      native: def.native,
      hidden: def.hidden,
      steps: def.steps,
      description: def.description,
      prompt,
      promptText,
      gates: def.gates,
      hasArtifact: def.hasArtifact,
      biologyQueries: def.biologyQueries,
      biologyRuntime: def.biologyRuntime,
      color: def.color,
      temperature: def.temperature,
      permission: permission(def, input.perm),
      options: def.options ?? {},
    }
  }

  return result
}
