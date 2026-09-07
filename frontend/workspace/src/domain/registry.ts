export type DomainId = "imc" | "single-cell" | "spatial" | "genomics" | "general"

export type DomainInfo = {
  id: DomainId
  researchDomain: "general" | "biology" | "physics" | "ml"
  subdomain?: string
  skills: string[]
}

/** Literature, writing, and plotting — kept on for every specialist domain. */
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
]

export const DOMAINS: DomainInfo[] = [
  {
    id: "imc",
    researchDomain: "biology",
    subdomain: "imc",
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
    researchDomain: "biology",
    subdomain: "single-cell",
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
    researchDomain: "biology",
    subdomain: "spatial",
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
    researchDomain: "biology",
    subdomain: "genomics",
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
    researchDomain: "general",
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
]

const IDS = new Set<string>(DOMAINS.map((item) => item.id))

export function domainById(id: string | undefined) {
  return DOMAINS.find((item) => item.id === id)
}

export function isDomainId(id: string | undefined): id is DomainId {
  return !!id && IDS.has(id)
}

export function projectDomainId(project?: { research?: { domain?: string; subdomain?: string } }) {
  const sub = project?.research?.subdomain
  if (sub && IDS.has(sub)) return sub as DomainId
  return "general" as DomainId
}

export function toResearch(id: DomainId) {
  const item = domainById(id) ?? domainById("general")!
  return {
    domain: item.researchDomain,
    subdomain: item.subdomain,
  }
}

export function domainAllows(id: DomainId, name: string) {
  const domain = domainById(id)
  if (!domain) return false
  return domain.skills.includes(name) || SHARED_SKILLS.includes(name)
}

export function buildDomainOverlay(id: DomainId, names: string[]) {
  const map: Record<string, "allow" | "deny"> = {}
  for (const name of names) map[name] = domainAllows(id, name) ? "allow" : "deny"
  return map
}

export function buildDomainSkillPreset(names: string[]) {
  const next: Record<string, Record<string, "allow" | "deny">> = {}
  for (const item of DOMAINS) next[item.id] = buildDomainOverlay(item.id, names)
  return next
}
