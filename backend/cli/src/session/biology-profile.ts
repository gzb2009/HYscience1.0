import PROMPT_GENOMICS from "../agent/prompt/biology-profiles/genomics.txt"
import PROMPT_SINGLE_CELL from "../agent/prompt/biology-profiles/single-cell.txt"
import PROMPT_IMC from "../agent/prompt/biology-profiles/imc.txt"
import PROMPT_SPATIAL from "../agent/prompt/biology-profiles/spatial.txt"
import { FILES as EXT, KEYWORDS } from "./biology-lexicon"
import { BIOLOGY_THEMES, type BiologyTheme } from "@hysci/util/themes"

export type BiologyProfile = BiologyTheme

const FRAGMENTS: Record<BiologyProfile, string> = {
  genomics: PROMPT_GENOMICS,
  "single-cell": PROMPT_SINGLE_CELL,
  imc: PROMPT_IMC,
  spatial: PROMPT_SPATIAL,
}

const SINGLE_CELL_TABLE = /(?:^|[/_-])(?:cluster[_-]?)?markers?(?:[_-].*)?\.(csv|tsv)$/i

export namespace BiologyProfile {
  export function fragment(profile: BiologyProfile) {
    return FRAGMENTS[profile]
  }

  /** The theme's "## Review" checklist, for the blind reviewer. */
  export function review(profile: BiologyProfile) {
    const match = FRAGMENTS[profile].match(/## Review\n([\s\S]*?)(?=\n## |\n<\/biology-task-profile>)/)
    return match?.[1].trim()
  }

  /** Explicit override from a hybio marker in the user message, if present. */
  export function fromMarker(text: string): BiologyProfile | undefined {
    const m = text.match(/<biology-profile>\s*([a-z-]+)\s*<\/biology-profile>/i)
    if (!m) return undefined
    const id = m[1].toLowerCase()
    return (BIOLOGY_THEMES as string[]).includes(id) ? (id as BiologyProfile) : undefined
  }

  export function detect(input: { text?: string; filenames?: string[] }): BiologyProfile | undefined {
    const marked = input.text ? fromMarker(input.text) : undefined
    if (marked) return marked

    const names = input.filenames ?? []
    if (names.some((name) => SINGLE_CELL_TABLE.test(name))) return "single-cell"
    for (const profile of Object.keys(EXT) as BiologyProfile[]) {
      if (names.some((n) => EXT[profile].test(n))) return profile
    }

    const text = input.text ?? ""
    for (const profile of Object.keys(KEYWORDS) as BiologyProfile[]) {
      if (KEYWORDS[profile].test(text)) return profile
    }
    return undefined
  }
}
