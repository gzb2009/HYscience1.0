/**
 * Theme manifest — the single list of research themes (方向) shared by the
 * backend (direction lock, profile fragment, skill gate, reviewer notes) and
 * the workspace UI (domain picker, skill overlay, titles).
 *
 * Add or rename a theme here only. Everything else derives from this table;
 * `backend/cli/test/session/themes.test.ts` fails when a layer drifts.
 */

export type ResearchDomain = "general" | "biology" | "physics" | "ml"

/**
 * primary  — has a UI card, a direction lock, a profile fragment and a skill set.
 * detected — reserved for themes reachable only through keyword / file detection
 *            (none today; proteomics / structure / chemo were removed as out of scope).
 */
export type ThemeExposure = "primary" | "detected"

export type Theme = {
  id: string
  title: string
  researchDomain: ResearchDomain
  /** `research.subdomain` written into the project; omitted for general. */
  subdomain?: string
  exposure: ThemeExposure
  /** Core skills for this theme; SHARED_SKILLS are always allowed on top. */
  skills: readonly string[]
}

/** Literature, writing, statistics, and plotting — on for every specialist theme. */
export const SHARED_SKILLS = [
  "research-lookup",
  "literature-review",
  "pubmed-database",
  "biorxiv-database",
  "scientific-writing",
  "citation-management",
  "scientific-slides",
  "peer-review",
  "hypothesis-generation",
  "scientific-critical-thinking",
  "grill-me",
  "statistical-analysis",
  "exploratory-data-analysis",
  "matplotlib",
  "seaborn",
  "plotly",
] as const

export const THEMES = [
  {
    id: "imc",
    title: "空间蛋白成像",
    researchDomain: "biology",
    subdomain: "imc",
    exposure: "primary",
    skills: [
      "imc-analysis",
      "pcf-analysis",
      "bioimage-analysis",
      "squidpy",
      "pathml",
      "histolab",
      "immunology-assays",
      "cellchat",
      "scanpy",
      "anndata",
      "imaging-data-commons",
      "omero-integration",
      "uniprot-database",
      "string-database",
    ],
  },
  {
    id: "single-cell",
    title: "单细胞分析",
    researchDomain: "biology",
    subdomain: "single-cell",
    exposure: "primary",
    skills: [
      "single-cell-pipeline",
      "scanpy",
      "anndata",
      "scvi-tools",
      "scvelo",
      "cellchat",
      "cellxgene-census",
      "pydeseq2",
      "umap-learn",
      "flow-cytometry-analysis",
      "flowio",
      "curated-bio-datasets",
      "geo-database",
      "gene-database",
    ],
  },
  {
    id: "spatial",
    title: "空间转录组",
    researchDomain: "biology",
    subdomain: "spatial",
    exposure: "primary",
    skills: [
      "squidpy",
      "spatial-deconv",
      "scanpy",
      "anndata",
      "scvi-tools",
      "cellchat",
      "bioimage-analysis",
      "cellxgene-census",
      "gene-database",
      "imaging-data-commons",
    ],
  },
  {
    id: "genomics",
    title: "基因组分析",
    researchDomain: "biology",
    subdomain: "genomics",
    exposure: "primary",
    skills: [
      "biopython",
      "pysam",
      "deeptools",
      "gget",
      "cancer-genomics-analysis",
      "pydeseq2",
      "bioservices",
      "scikit-bio",
      "gtars",
      "dna-visualization",
      "ensembl-database",
      "clinvar-database",
      "cosmic-database",
      "gwas-database",
      "kegg-database",
      "reactome-database",
      "geo-database",
      "ena-database",
    ],
  },
  {
    id: "general",
    title: "通用研究",
    researchDomain: "general",
    exposure: "primary",
    skills: [
      "research-lookup",
      "literature-review",
      "pubmed-database",
      "openalex-database",
      "scientific-writing",
      "peer-review",
      "hypothesis-generation",
      "grill-me",
      "scientific-brainstorming",
      "statistical-analysis",
      "exploratory-data-analysis",
      "matplotlib",
      "biopython",
    ],
  },
] as const satisfies readonly Theme[]

export type ThemeId = (typeof THEMES)[number]["id"]
/** Biology themes with a UI card and an execution lock. */
export type Direction = Extract<(typeof THEMES)[number], { researchDomain: "biology"; exposure: "primary" }>["id"]
/** Every biology theme, including detection-only ones. */
export type BiologyTheme = Extract<(typeof THEMES)[number], { researchDomain: "biology" }>["id"]

export const DIRECTIONS = THEMES.filter(
  (theme) => theme.researchDomain === "biology" && theme.exposure === "primary",
).map((theme) => theme.id) as Direction[]

export const BIOLOGY_THEMES = THEMES.filter((theme) => theme.researchDomain === "biology").map(
  (theme) => theme.id,
) as BiologyTheme[]

/** Themes the workspace exposes as cards. */
export const PRIMARY_THEMES = THEMES.filter((theme) => theme.exposure === "primary")

export function themeById(id: string | undefined) {
  return THEMES.find((theme) => theme.id === id)
}

export function isDirection(value: string | undefined): value is Direction {
  return !!value && (DIRECTIONS as string[]).includes(value)
}

export function isBiologyTheme(value: string | undefined): value is BiologyTheme {
  return !!value && (BIOLOGY_THEMES as string[]).includes(value)
}

export function themeTitle(id: string | undefined) {
  return themeById(id)?.title ?? themeById("general")!.title
}

/** Skill gate: theme core set plus the shared set; unknown themes fall back to general. */
export function themeAllows(id: string | undefined, skill: string) {
  const theme = themeById(id) ?? themeById("general")!
  return (theme.skills as readonly string[]).includes(skill) || (SHARED_SKILLS as readonly string[]).includes(skill)
}
