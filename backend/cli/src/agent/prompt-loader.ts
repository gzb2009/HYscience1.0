import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_CRITIQUE from "./prompt/critique.txt"
import PROMPT_LITERATURE_REVIEW from "./prompt/literature-review.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_PHYSICS_CRITIQUE from "./prompt/physics-critique.txt"
import PROMPT_REVIEWER from "./prompt/reviewer.txt"
import PROMPT_RESEARCH from "./prompt/research-core-v2.txt"
import PROMPT_BIOLOGY from "./prompt/biology-core-v2.txt"
import PROMPT_PHYSICS from "./prompt/physics.txt"
import PROMPT_ML from "./prompt/ml.txt"
import PROMPT_WRITE from "./prompt/write.txt"
import { PromptTemplate } from "./prompt-template"

const files: Record<string, string> = {
  "compaction.txt": PROMPT_COMPACTION,
  "explore.txt": PROMPT_EXPLORE,
  "critique.txt": PROMPT_CRITIQUE,
  "literature-review.txt": PROMPT_LITERATURE_REVIEW,
  "title.txt": PROMPT_TITLE,
  "physics-critique.txt": PROMPT_PHYSICS_CRITIQUE,
  "reviewer.txt": PROMPT_REVIEWER,
  "research-core-v2.txt": PROMPT_RESEARCH,
  "biology-core-v2.txt": PROMPT_BIOLOGY,
  "physics.txt": PROMPT_PHYSICS,
  "ml.txt": PROMPT_ML,
  "write.txt": PROMPT_WRITE,
}

export namespace PromptLoader {
  export function load(name: string, vars?: Record<string, string>) {
    const text = files[name]
    if (!text) throw new Error(`unknown prompt file: ${name}`)
    if (!vars) return text
    return PromptTemplate.render(text, vars)
  }

  export function names() {
    return Object.keys(files)
  }
}
