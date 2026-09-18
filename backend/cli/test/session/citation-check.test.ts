import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CitationCheck } from "../../src/session/citation-check"
import { SessionReview } from "../../src/session/review"
import { clearCache, resetRateLimits } from "../../src/science/connectors/http"

const realFetch = globalThis.fetch

beforeEach(() => {
  clearCache()
  resetRateLimits()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function stub(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    return handler(url)
  }) as unknown as typeof fetch
}

describe("CitationCheck", () => {
  test("extracts DOIs and PMIDs, strips trailing punctuation, dedupes", () => {
    const text = [
      "见 Nature 2021 (doi:10.1038/s41586-021-03819-2).",
      "另见 https://doi.org/10.1038/s41586-021-03819-2 和 10.1016/j.cell.2019.05.031，",
      "PMID: 34265844；PMID 12345678。",
    ].join("\n")
    const found = CitationCheck.extract(text)
    expect(found.dois).toEqual(["10.1038/s41586-021-03819-2", "10.1016/j.cell.2019.05.031"])
    expect(found.pmids).toEqual(["34265844", "12345678"])
  })

  test("resolves against CrossRef and PubMed and classifies 404 as missing", async () => {
    stub((url) => {
      if (url.includes("api.crossref.org/works/10.1038")) {
        return Response.json({
          message: { title: ["Highly accurate protein structure prediction"], issued: { "date-parts": [[2021]] } },
        })
      }
      if (url.includes("api.crossref.org/works/10.9999")) return new Response("Resource not found.", { status: 404 })
      if (url.includes("esummary.fcgi")) {
        return Response.json({
          result: {
            uids: ["34265844", "99999999"],
            "34265844": { title: "Highly accurate protein structure prediction with AlphaFold", pubdate: "2021 Aug" },
            "99999999": { error: "cannot get document summary" },
          },
        })
      }
      return new Response("nope", { status: 500 })
    })
    const result = await CitationCheck.verify(
      "doi:10.1038/s41586-021-03819-2 doi:10.9999/fake.2024.001 PMID:34265844 PMID:99999999",
    )
    expect(result.verified).toBe(2)
    expect(result.missing).toBe(2)
    expect(result.errors).toBe(0)
    expect(result.items.find((item) => item.id === "10.1038/s41586-021-03819-2")?.year).toBe(2021)
    const findings = CitationCheck.findings(result)
    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.severity === "blocking")).toBe(true)
    expect(findings[0].message).toContain("does not resolve")
    expect(CitationCheck.note(result)).toContain("Unresolvable (already flagged): doi:10.9999/fake.2024.001")
  })

  test("author/year attribution mismatch against the resolved record is a warning", async () => {
    stub((url) => {
      if (url.includes("api.crossref.org/works/10.1038")) {
        return Response.json({
          message: {
            title: ["Highly accurate protein structure prediction with AlphaFold"],
            issued: { "date-parts": [[2021]] },
            author: [{ family: "Jumper" }, { family: "Evans" }, { family: "Hassabis" }],
          },
        })
      }
      if (url.includes("esummary.fcgi")) {
        return Response.json({
          result: {
            uids: ["30193111"],
            "30193111": {
              title:
                "A Structured Tumor-Immune Microenvironment in Triple Negative Breast Cancer Revealed by Multiplexed Ion Beam Imaging",
              pubdate: "2018 Sep 6",
              authors: [{ name: "Keren L" }, { name: "Bosse M" }, { name: "Angelo M" }],
            },
          },
        })
      }
      return new Response("nope", { status: 500 })
    })
    const wrong = await CitationCheck.verify(
      "结构预测见 Smith et al., 2018 (doi:10.1038/s41586-021-03819-2)；MIBI 参考 Keren 2018（PMID 30193111）。",
    )
    const alpha = wrong.items.find((item) => item.id === "10.1038/s41586-021-03819-2")!
    expect(alpha.mismatch).toEqual([
      { field: "year", claimed: "2018", actual: "2021" },
      { field: "author", claimed: "Smith", actual: "Jumper, Evans, Hassabis" },
    ])
    const keren = wrong.items.find((item) => item.id === "30193111")!
    expect(keren.mismatch).toEqual([])
    const findings = CitationCheck.findings(wrong)
    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true)
    expect(findings[0].message).toContain('cites year "2018" while the record says "2021"')
    expect(CitationCheck.note(wrong)).toContain("Attribution mismatch")

    clearCache()
    const plain = await CitationCheck.verify("参考 doi:10.1038/s41586-021-03819-2 与 PMID 30193111。")
    expect(plain.items.every((item) => item.mismatch?.length === 0)).toBe(true)
  })

  test("network failure is a warning, not a blocking finding", async () => {
    stub(() => new Response("down", { status: 503, headers: { "Retry-After": "0" } }))
    const result = await CitationCheck.verify("doi:10.1000/xyz123")
    expect(result.errors).toBe(1)
    const findings = CitationCheck.findings(result)
    expect(findings[0].severity).toBe("warning")
  })

  test("no citations means no network and an empty result", async () => {
    stub(() => {
      throw new Error("must not fetch")
    })
    const result = await CitationCheck.verify("单细胞常规流程是质控→归一化→聚类。")
    expect(result.items).toEqual([])
    expect(CitationCheck.note(result)).toBe("")
  })

  test("citation findings escalate a CLEAN reviewer verdict", () => {
    const missing = { severity: "blocking" as const, message: "DOI x does not resolve", evidence: [] }
    expect(SessionReview.merge({ verdict: "CLEAN", findings: [] }, [missing]).verdict).toBe("FLAGGED")
    expect(SessionReview.merge({ verdict: "CLEAN", findings: [] }, []).verdict).toBe("CLEAN")
    const warn = { severity: "warning" as const, message: "DOI y unchecked", evidence: [] }
    expect(SessionReview.merge({ verdict: "CLEAN", findings: [] }, [warn]).verdict).toBe("CLEAN")
  })
})
