import { describe, expect, test } from "bun:test"
import { bioLookupRoute } from "../../src/tool/biology/lookup"

describe("bio_lookup routing", () => {
  test("routes gene entities to genome and interaction sources", () => {
    const result = bioLookupRoute("gene", "TP53")
    expect(result.metadata.tools).toContain("query_ensembl")
    expect(result.metadata.tools).toContain("query_string")
    expect(result.metadata.scienceDbs).toContain("ensembl")
    expect(result.output).toContain("query_ensembl")
  })

  test("routes protein entities to UniProt and structure sources", () => {
    const result = bioLookupRoute("protein", "P04637")
    expect(result.metadata.tools).toContain("query_uniprot")
    expect(result.metadata.tools).toContain("query_pdb")
    expect(result.metadata.scienceDbs).toContain("uniprot")
  })

  test("routes multi-omics entities to cross-modality sources", () => {
    const result = bioLookupRoute("multi_omics", "TP53", "RNA + proteomics")
    expect(result.metadata.skills).toContain("reactome-database")
    expect(result.output).toContain("cross-modality")
  })
})
