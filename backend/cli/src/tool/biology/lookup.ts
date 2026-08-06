import z from "zod"
import { Tool } from "../tool"
import { registry } from "../../science/connectors"

const EntityType = z.enum([
  "gene",
  "protein",
  "variant",
  "pathway",
  "metabolite",
  "disease",
  "compound",
  "marker",
  "multi_omics",
])

type EntityType = z.infer<typeof EntityType>

const ROUTES: Record<
  EntityType,
  {
    tools: string[]
    scienceDbs: string[]
    skills: string[]
    reason: string
  }
> = {
  gene: {
    tools: ["query_ensembl", "query_ncbi_gene", "query_string", "query_pubmed"],
    scienceDbs: ["ensembl", "clinvar", "opentargets", "pubmed"],
    skills: ["ensembl-database", "gene-database", "string-database"],
    reason: "Resolve gene annotation, cross-database IDs, interactions, and disease relevance.",
  },
  protein: {
    tools: ["query_uniprot", "query_pdb", "query_string"],
    scienceDbs: ["uniprot", "alphafold", "pubmed"],
    skills: ["uniprot-database", "pdb-database", "alphafold-database", "string-database"],
    reason: "Resolve protein function, domains, structure, interactions, and post-translational context.",
  },
  variant: {
    tools: ["query_ncbi_gene", "query_pubmed"],
    scienceDbs: ["clinvar", "ensembl", "pubmed"],
    skills: ["clinvar-database", "ensembl-database", "cosmic-database"],
    reason: "Resolve variant annotation, clinical significance, allele frequency, and cancer relevance.",
  },
  pathway: {
    tools: ["query_kegg", "query_pubmed"],
    scienceDbs: ["kegg", "reactome", "opentargets", "pubmed"],
    skills: ["kegg-database", "reactome-database", "opentargets-database"],
    reason: "Resolve pathway membership, enrichment context, and disease-pathway associations.",
  },
  metabolite: {
    tools: ["query_pubmed"],
    scienceDbs: ["pubchem", "pubmed"],
    skills: ["hmdb-database", "metabolomics-workbench-database", "pubchem-database"],
    reason: "Resolve metabolite identity, structure, assays, and metabolomics references.",
  },
  disease: {
    tools: ["query_pubmed"],
    scienceDbs: ["opentargets", "clinvar", "pubmed"],
    skills: ["opentargets-database", "clinicaltrials-database", "clinpgx-database"],
    reason: "Resolve disease targets, variants, trials, and clinical associations.",
  },
  compound: {
    tools: ["query_pubmed"],
    scienceDbs: ["pubchem", "chembl", "pubmed"],
    skills: ["chembl-database", "pubchem-database", "drugbank-database"],
    reason: "Resolve compound properties, bioactivity, targets, and drug interactions.",
  },
  marker: {
    tools: ["query_uniprot", "query_ensembl", "query_pubmed"],
    scienceDbs: ["uniprot", "ensembl", "pubmed"],
    skills: ["uniprot-database", "ensembl-database", "cellxgene-census"],
    reason: "Resolve marker identity and expression context; do not treat markers as definitive cell labels.",
  },
  multi_omics: {
    tools: ["query_uniprot", "query_ensembl", "query_kegg", "query_pubmed"],
    scienceDbs: ["uniprot", "ensembl", "kegg", "reactome", "opentargets", "pubmed"],
    skills: ["uniprot-database", "ensembl-database", "kegg-database", "reactome-database"],
    reason: "Route cross-modality entities and bridge gene-protein-pathway-metabolite evidence.",
  },
}

export function bioLookupRoute(entityType: EntityType, query: string, context?: string) {
  const route = ROUTES[entityType]
  const available = new Set(registry.catalog().map((entry) => entry.id))
  const scienceDbs = route.scienceDbs.filter((id) => available.has(id))
  const availableScience = scienceDbs.length
    ? scienceDbs.map((id) => `science_search(db="${id}", query="${query}")`).join("\n")
    : "No science connectors are currently registered for this entity type; use native query tools."

  const output = [
    `## bio_lookup: ${entityType} — ${query}`,
    "",
    route.reason,
    "",
    "### Recommended native tools",
    route.tools.map((tool) => `- ${tool}("${query}")`).join("\n"),
    "",
    "### Recommended science databases",
    availableScience,
    "",
    "### Recommended skills",
    route.skills.map((skill) => `- skill(name="${skill}")`).join("\n"),
    "",
    "Use the route above, then cross-check conflicting evidence and record source/version.",
  ].join("\n")

  return {
    title: `bio_lookup: ${entityType}`,
    output,
    metadata: {
      entityType,
      query,
      context: context ?? "",
      tools: route.tools,
      scienceDbs,
      skills: route.skills,
    },
  }
}

export const BioLookupTool = Tool.define("bio_lookup", {
  description: [
    "Route a biological entity to the recommended native tools, science databases, and skills.",
    "Use this before guessing which database or skill applies to a gene, protein, variant, pathway, metabolite, disease, compound, marker, or multi-omics question.",
  ].join("\n"),
  parameters: z.object({
    entityType: EntityType.describe("Biological entity type to route"),
    query: z.string().describe("Entity name or ID, e.g. TP53, P04637, rs113488022"),
    context: z.string().optional().describe("Optional analysis context, e.g. single-cell, cancer, multi-omics"),
  }),
  async execute(params) {
    return bioLookupRoute(params.entityType, params.query, params.context)
  },
})
