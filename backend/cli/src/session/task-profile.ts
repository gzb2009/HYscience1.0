import PHYSICS_EXPERIMENT from "../agent/prompt/physics-profiles/experiment.txt"
import PHYSICS_SIMULATION from "../agent/prompt/physics-profiles/simulation.txt"
import PHYSICS_THEORY from "../agent/prompt/physics-profiles/theory.txt"
import ML_EVALUATION from "../agent/prompt/ml-profiles/evaluation.txt"
import ML_INFERENCE from "../agent/prompt/ml-profiles/inference.txt"
import ML_TRAINING from "../agent/prompt/ml-profiles/training.txt"
import { BiologyProfile, type BiologyProfile as BiologySubdomain } from "./biology-profile"
import type { Project } from "../project/project"

export const SUBDOMAINS = {
  biology: ["genomics", "single-cell", "proteomics", "structure", "chemo"],
  physics: ["simulation", "theory", "experiment"],
  ml: ["training", "evaluation", "inference"],
  general: [],
} as const

const FRAGMENTS = {
  physics: {
    simulation: PHYSICS_SIMULATION,
    theory: PHYSICS_THEORY,
    experiment: PHYSICS_EXPERIMENT,
  },
  ml: {
    training: ML_TRAINING,
    evaluation: ML_EVALUATION,
    inference: ML_INFERENCE,
  },
}

export namespace TaskProfile {
  export function agent(research: Project.Research | undefined) {
    return research?.domain === "biology" || research?.domain === "physics" || research?.domain === "ml"
      ? research.domain
      : "research"
  }

  export function fragment(research: Project.Research | undefined, input: { text: string; filenames: string[] }) {
    if (!research || research.domain === "general") return undefined
    if (research.domain === "biology") {
      const profile =
        research.subdomain && SUBDOMAINS.biology.includes(research.subdomain as BiologySubdomain)
          ? (research.subdomain as BiologySubdomain)
          : BiologyProfile.detect(input)
      return profile ? BiologyProfile.fragment(profile) : undefined
    }

    const profiles = FRAGMENTS[research.domain]
    if (!research.subdomain || !(research.subdomain in profiles)) return undefined
    return profiles[research.subdomain as keyof typeof profiles]
  }

  export function context(research: Project.Research | undefined) {
    if (!research) return undefined
    const lines = [
      `<project-research domain="${research.domain}"${research.subdomain ? ` subdomain="${research.subdomain}"` : ""}>`,
      "This project configuration is authoritative for strategy selection. Adapt subsequent responses to it unless the user explicitly changes the project settings.",
      research.notes?.trim(),
      "</project-research>",
    ].filter(Boolean)
    return lines.join("\n")
  }
}
