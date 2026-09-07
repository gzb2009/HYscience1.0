import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part as PartType } from "@hysci/sdk/v2/client"
import {
  collectResultFiles,
  customerFacingResultFiles,
  formatResultMarkdown,
  formatSectionForDisplay,
  isWorkflowArtifact,
  organizeResultFiles,
  filterLatestFileNodes,
  assistantMessagesForLastTurn,
  collectRecentTurnFileNames,
  collectTaskFileNames,
  collectInferredFileNamesFromTools,
  splitResultSections,
} from "./session-result"

describe("splitResultSections", () => {
  test("classifies the scientific delivery sections", () => {
    const sections = splitResultSections(`## 总结
5个cluster完成注释。

## 分组分析
- C0 Treg

## 关键发现
1. Treg活化。

## 建议
- 保留并验证。`)
    expect(sections.map((section) => section.kind)).toEqual(["summary", "analysis", "findings", "recommendations"])
    expect(sections[1].text).toContain("C0 Treg")
  })

  test("keeps unstructured replies as one body", () => {
    expect(splitResultSections("直接答案")).toEqual([{ kind: "body", text: "直接答案" }])
  })

  test("splits deliverable prefix and inline findings", () => {
    const sections = splitResultSections(
      `模板已生成：~/Desktop/单细胞测序报告模板.md（534 行，占位骨架文档，零编造数据）。 **Key Findings** 覆盖 12 章节 + 附录。 **Confidence** High — 参考集来自公开数据。 **Caveat** 需确认输入为 scRNA-seq。 **Next Steps** 填写样本信息。`,
    )
    expect(sections.map((section) => section.kind)).toEqual([
      "deliverable",
      "findings",
      "caveat",
      "caveat",
      "recommendations",
    ])
  })

  test("classifies confidence and caveat headings", () => {
    const sections = splitResultSections(`## Key Findings
- item

## Confidence
High

## Caveat
Needs validation

## Next Steps
- step`)
    expect(sections.map((section) => section.kind)).toEqual(["findings", "caveat", "caveat", "recommendations"])
  })
})

describe("formatResultMarkdown", () => {
  test("replaces evidence tags with readable badges", () => {
    expect(formatResultMarkdown("结论 [computed] 成立")).toBe("结论 `实测` 成立")
  })
})

describe("formatSectionForDisplay", () => {
  test("keeps authored scientific headings", () => {
    const text = formatSectionForDisplay({
      kind: "findings",
      text: "## 关键发现\n- one",
    })
    expect(text).toBe("## 关键发现\n- one")
  })

  test("adds a Chinese heading for inferred sections", () => {
    const text = formatSectionForDisplay({
      kind: "recommendations",
      text: "- 补充样本信息",
    })
    expect(text).toBe("### 下一步\n\n- 补充样本信息")
  })
})

describe("customerFacingResultFiles", () => {
  test("hides internal workflow artifacts like literature-review.md", () => {
    const files = [
      {
        path: "result/literature-review.md",
        name: "literature-review.md",
        kind: "md" as const,
        role: "supporting" as const,
        verified: true,
      },
      {
        path: "result/pdac_annotation.xlsx",
        name: "pdac_annotation.xlsx",
        kind: "xlsx" as const,
        role: "primary" as const,
        verified: true,
      },
    ]
    expect(isWorkflowArtifact("literature-review.md")).toBe(true)
    expect(isWorkflowArtifact("codex-literature-review.md")).toBe(true)
    expect(isWorkflowArtifact("imc-literature-review.md")).toBe(true)
    expect(isWorkflowArtifact("pdac_annotation.xlsx")).toBe(false)
    expect(customerFacingResultFiles(files).map((file) => file.name)).toEqual(["pdac_annotation.xlsx"])
  })
})

describe("organizeResultFiles", () => {
  test("keeps only the latest version per artifact stem", () => {
    const files = [
      { path: "result/a_v1.png", name: "a_v1.png", kind: "png" as const, role: "primary" as const, verified: true },
      { path: "result/a_v2.png", name: "a_v2.png", kind: "png" as const, role: "primary" as const, verified: true },
    ]
    const organized = organizeResultFiles(files)
    expect(organized.deliverables.map((f) => f.name)).toEqual(["a_v2.png"])
    expect(organized.intermediate.map((f) => f.name)).toEqual(["a_v1.png"])
    expect(organized.hiddenCount).toBe(1)
  })
})

describe("collectResultFiles", () => {
  test("uses only verified artifacts emitted by a completed tool", () => {
    const message = { id: "message-1" } as unknown as AssistantMessage
    const parts = [
      {
        type: "tool",
        tool: "bash",
        state: {
          metadata: {
            artifacts: [
              {
                path: "result/pdac_annotation.xlsx",
                name: "pdac_annotation.xlsx",
                mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                size: 2048,
                verified: true,
              },
              {
                path: "result/reference_heatmap.png",
                name: "reference_heatmap.png",
                mime: "image/png",
                size: 1024,
                verified: true,
              },
            ],
          },
        },
      },
    ] as unknown as PartType[]

    const files = collectResultFiles({
      assistantMessages: [message],
      partsByMessage: { [message.id]: parts },
      responseText: "结果文件：`cluster_annotation.md`、`markers.csv`",
    })

    expect(files.map((file) => file.name)).toEqual(["pdac_annotation.xlsx", "reference_heatmap.png"])
    expect(files[0].verified).toBe(true)
    expect(files[1].kind).toBe("png")
    expect(files[0].role).toBe("primary")
  })

  test("does not turn file names in prose into output artifacts", () => {
    const files = collectResultFiles({
      assistantMessages: [],
      partsByMessage: {},
      responseText: "结果文件：`reference_heatmap.png`",
    })
    expect(files).toHaveLength(0)
  })

  test("promotes verified report templates to primary role", () => {
    const message = { id: "message-2" } as unknown as AssistantMessage
    const files = collectResultFiles({
      assistantMessages: [message],
      partsByMessage: {
        [message.id]: [
          {
            type: "tool",
            tool: "write",
            state: {
              metadata: {
                artifacts: [{ path: "result/单细胞测序报告模板.md", verified: true }],
              },
            },
          } as unknown as PartType,
        ],
      },
      responseText: "",
    })
    expect(files[0]?.role).toBe("primary")
  })

  test("keeps verified table and image artifacts distinct from unverified files", () => {
    const message = { id: "message-3" } as unknown as AssistantMessage
    const files = collectResultFiles({
      assistantMessages: [message],
      partsByMessage: {
        [message.id]: [
          {
            type: "tool",
            tool: "bash",
            state: {
              metadata: {
                artifacts: [
                  { path: "result/qc.tsv", mime: "text/tab-separated-values", verified: true },
                  { path: "result/qc.png", mime: "image/png", verified: true },
                  { path: "result/retry.log", mime: "text/plain", verified: false },
                  { path: "result/qc.tsv", mime: "text/tab-separated-values", verified: true },
                ],
              },
            },
          } as unknown as PartType,
        ],
      },
      responseText: "",
    })

    expect(files.map((file) => [file.name, file.kind])).toEqual([
      ["qc.tsv", "tsv"],
      ["qc.png", "png"],
    ])
  })
})

describe("filterLatestFileNodes", () => {
  test("keeps only the latest version per artifact stem for disk rows", () => {
    const nodes = [
      { name: "figures/heatmap_v1.png", path: "figures/heatmap_v1.png" },
      { name: "figures/heatmap_v2.png", path: "figures/heatmap_v2.png" },
      { name: "report.md", path: "report.md" },
    ]
    const result = filterLatestFileNodes(nodes)
    expect(result.deliverables.map((node) => node.name)).toEqual(["figures/heatmap_v2.png", "report.md"])
    expect(result.hiddenCount).toBe(1)
  })
})

describe("recent vs task file names", () => {
  test("collectRecentTurnFileNames only includes the latest user turn", () => {
    const messages = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
      { id: "u2", role: "user" },
      { id: "a2", role: "assistant" },
    ]
    const partsByMessage = {
      a1: [
        {
          type: "tool",
          tool: "bash",
          state: {
            metadata: {
              artifacts: [{ path: "result/old.png", verified: true }],
            },
          },
        },
      ] as unknown as PartType[],
      a2: [
        {
          type: "tool",
          tool: "bash",
          state: {
            metadata: {
              artifacts: [{ path: "result/new.png", verified: true }],
            },
          },
        },
      ] as unknown as PartType[],
    }
    expect(assistantMessagesForLastTurn(messages).map((message) => message.id)).toEqual(["a2"])
    expect([...collectRecentTurnFileNames({ messages, partsByMessage })]).toEqual(["new.png"])
    expect([...collectTaskFileNames({ messages, partsByMessage })].sort()).toEqual(["new.png", "old.png"])
  })

  test("collectInferredFileNamesFromTools reads write tool paths without verified metadata", () => {
    const message = { id: "a1", role: "assistant" }
    const names = collectInferredFileNamesFromTools({
      assistantMessages: [message],
      partsByMessage: {
        a1: [
          {
            type: "tool",
            tool: "write",
            state: { input: { filePath: "result/legacy_plot.png" } },
          },
        ] as unknown as PartType[],
      },
    })
    expect([...names]).toEqual(["legacy_plot.png"])
  })
})
