import { describe, expect, test } from "bun:test"
import { BiologyProfile } from "../../src/session/biology-profile"

describe("BiologyProfile.detect", () => {
  test("detects single-cell from h5ad filename", () => {
    expect(BiologyProfile.detect({ filenames: ["pbmc.h5ad"] })).toBe("single-cell")
  })

  test("detects single-cell from marker table filename", () => {
    expect(BiologyProfile.detect({ filenames: ["results/cluster_markers.csv"] })).toBe("single-cell")
    expect(BiologyProfile.detect({ filenames: ["TNK-markers.tsv"] })).toBe("single-cell")
  })

  test("detects genomics from vcf", () => {
    expect(BiologyProfile.detect({ filenames: ["cohort.vcf.gz"] })).toBe("genomics")
  })

  test("respects explicit marker over filename", () => {
    expect(
      BiologyProfile.detect({
        text: "<biology-profile>chemo</biology-profile>",
        filenames: ["pbmc.h5ad"],
      }),
    ).toBe("chemo")
  })

  test("detects from keywords", () => {
    expect(BiologyProfile.detect({ text: "annotate cell types from UMAP clusters" })).toBe("single-cell")
    expect(BiologyProfile.detect({ text: "对这些亚群进行重新注释" })).toBe("single-cell")
  })

  test("returns undefined when no signal", () => {
    expect(BiologyProfile.detect({ text: "hello" })).toBeUndefined()
  })
})
