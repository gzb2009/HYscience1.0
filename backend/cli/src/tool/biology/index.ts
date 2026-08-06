export {
  QueryUniprotTool,
  QueryEnsemblTool,
  QueryKeggTool,
  QueryPubmedTool,
  QueryNcbiGeneTool,
  QueryStringTool,
  QueryPdbTool,
} from "./database"
export { BioLookupTool, bioLookupRoute } from "./lookup"
export { NotebookTool } from "./notebook"

import {
  QueryUniprotTool,
  QueryEnsemblTool,
  QueryKeggTool,
  QueryPubmedTool,
  QueryNcbiGeneTool,
  QueryStringTool,
  QueryPdbTool,
} from "./database"
import { BioLookupTool } from "./lookup"
import { NotebookTool } from "./notebook"

export const BiologyTools = [
  BioLookupTool,
  QueryUniprotTool,
  QueryEnsemblTool,
  QueryKeggTool,
  QueryPubmedTool,
  QueryNcbiGeneTool,
  QueryStringTool,
  QueryPdbTool,
  NotebookTool,
]

/** Native DB query tools shared by research + biology. */
export const BIOLOGY_QUERY_TOOL_IDS = new Set([
  "bio_lookup",
  "query_uniprot",
  "query_ensembl",
  "query_kegg",
  "query_pubmed",
  "query_ncbi_gene",
  "query_string",
  "query_pdb",
])

/** Heavier biology runtime tools — biology agent only. */
export const BIOLOGY_RUNTIME_TOOL_IDS = new Set(["notebook"])

export const BIOLOGY_TOOL_IDS = new Set([...BIOLOGY_QUERY_TOOL_IDS, ...BIOLOGY_RUNTIME_TOOL_IDS])
