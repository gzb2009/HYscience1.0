export type PermissionPreset =
  | "default"
  | "plan"
  | "explore"
  | "task"
  | "literature-review"
  | "critique"
  | "physics-critique"
  | "reviewer"
  | "deny-all"

export type BuiltinDefinition = {
  key: string
  name: string
  steps?: number
  description?: string
  promptFile?: string
  promptRole?: "prompt" | "promptText"
  gates?: Array<"literature" | "task_profile" | "compute">
  hasArtifact?: boolean
  biologyQueries?: boolean
  biologyRuntime?: boolean
  mode: "primary" | "subagent" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
  temperature?: number
  permission?: PermissionPreset | Record<string, unknown>
  options?: Record<string, unknown>
}

export const BUILTIN: BuiltinDefinition[] = [
  {
    key: "research",
    name: "research",
    steps: 50,
    description:
      "Scientific research agent — literature review, data analysis, GPU compute, and synthesis across 241 skills.",
    promptFile: "research-core-v2.txt",
    promptRole: "promptText",
    gates: ["literature", "task_profile", "compute"],
    hasArtifact: true,
    biologyQueries: true,
    mode: "primary",
    native: true,
    color: "#06b6d4",
    permission: { question: "allow", plan_enter: "allow" },
  },
  {
    key: "biology",
    name: "biology",
    steps: 40,
    description:
      "Computational biology agent — bioinformatics analysis, 30+ biological database integrations, and systematic data-to-answer workflows.",
    promptFile: "biology-core-v2.txt",
    promptRole: "promptText",
    gates: ["literature", "task_profile", "compute"],
    hasArtifact: true,
    biologyQueries: true,
    biologyRuntime: true,
    mode: "all",
    native: true,
    color: "#10b981",
    permission: { question: "allow" },
  },
  {
    key: "physics",
    name: "physics",
    steps: 40,
    description:
      "Computational physics agent — simulation, PDE solving, dynamical systems, symbolic regression, data analysis, and scientific computing.",
    promptFile: "physics.txt",
    promptRole: "promptText",
    gates: ["compute"],
    mode: "all",
    native: true,
    color: "#8b5cf6",
    permission: { question: "allow" },
  },
  {
    key: "ml",
    name: "ml",
    steps: 50,
    description:
      "Machine learning agent — trains, evaluates, and analyzes models end-to-end (deep learning, LLMs, classical ML, RL) with rigorous evaluation, and builds specialized models to replace frontier APIs.",
    promptFile: "ml.txt",
    promptRole: "promptText",
    gates: ["compute"],
    hasArtifact: true,
    mode: "all",
    native: true,
    color: "#6366f1",
    permission: { question: "allow" },
  },
  {
    key: "write",
    name: "write",
    steps: 30,
    description:
      "Scientific & technical writing. Produces LaTeX papers, grants, literature reviews with verified citations and figures.",
    promptFile: "write.txt",
    promptRole: "promptText",
    mode: "subagent",
    native: true,
    color: "#a78bfa",
    permission: { question: "allow" },
  },
  {
    key: "plan",
    name: "plan",
    steps: 30,
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    native: true,
    permission: "plan",
  },
  {
    key: "task",
    name: "task",
    steps: 30,
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
    mode: "subagent",
    native: true,
    permission: "task",
  },
  {
    key: "explore",
    name: "explore",
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    promptFile: "explore.txt",
    promptRole: "prompt",
    mode: "subagent",
    native: true,
    permission: "explore",
  },
  {
    key: "literature-review",
    name: "literature-review",
    description: "Full PRISMA literature review — systematic search, screening, eligibility, synthesis, verification.",
    promptFile: "literature-review.txt",
    promptRole: "prompt",
    mode: "subagent",
    native: true,
    color: "#818cf8",
    permission: "literature-review",
  },
  {
    key: "critique",
    name: "critique",
    steps: 60,
    description:
      "Scientific critique specialist. Finds blocking errors — data leakage, wrong statistics, unsupported claims — in research artifacts before expensive or irreversible actions. Read-only.",
    promptFile: "critique.txt",
    promptRole: "prompt",
    mode: "subagent",
    native: true,
    color: "#ef4444",
    permission: "critique",
  },
  {
    key: "physics-critique",
    name: "physics-critique",
    steps: 60,
    description:
      "Physics critique specialist — validates computational physics results (PDE solutions, PINN outputs, fitted parameters) against rigorous physical and numerical criteria. Blind to generator reasoning (Aletheia pattern). Read-only.",
    promptFile: "physics-critique.txt",
    promptRole: "prompt",
    mode: "subagent",
    native: true,
    color: "#c084fc",
    permission: "physics-critique",
  },
  {
    key: "reviewer",
    name: "reviewer",
    steps: 60,
    hidden: true,
    description:
      "Blind, adversarial reviewer of research outputs. Traces every claim, number, and figure back to the provenance DAG and evidence — flags citation mismatches, untraceable numbers, and figure/stat mismatches. Read-only.",
    promptFile: "reviewer.txt",
    promptRole: "prompt",
    mode: "subagent",
    native: true,
    color: "#f59e0b",
    permission: "reviewer",
  },
  {
    key: "compaction",
    name: "compaction",
    promptFile: "compaction.txt",
    promptRole: "prompt",
    mode: "primary",
    native: true,
    hidden: true,
    permission: "deny-all",
  },
  {
    key: "title",
    name: "title",
    promptFile: "title.txt",
    promptRole: "prompt",
    mode: "primary",
    native: true,
    hidden: true,
    temperature: 0.5,
    permission: "deny-all",
  },
]
