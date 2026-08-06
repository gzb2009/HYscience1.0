import { describe, expect, test } from "bun:test"
import { artifactImageUrl, artifactTable } from "./artifactPreview"

describe("artifactImageUrl", () => {
  test("uses the verified binary image content directly", () => {
    expect(artifactImageUrl({ content: "aGVsbG8=", encoding: "base64", mimeType: "image/png" })).toBe(
      "data:image/png;base64,aGVsbG8=",
    )
  })

  test("encodes inline SVG content", () => {
    expect(artifactImageUrl({ content: "<svg/>", mimeType: "image/svg+xml" })).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    )
  })
})

describe("artifactTable", () => {
  test("parses a compact TSV preview and respects quoted cells", () => {
    expect(artifactTable('sample\tvalue\n"A\\t1"\t2\nB\t3', "qc.tsv")).toEqual([
      ["sample", "value"],
      ["A\\t1", "2"],
      ["B", "3"],
    ])
  })
})
