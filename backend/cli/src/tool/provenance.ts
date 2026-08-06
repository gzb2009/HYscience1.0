import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Provenance } from "../science/provenance/store"
import { Review } from "../science/provenance/review"
import { Instance } from "../project/instance"

/**
 * Agent-facing tools over the provenance DAG. Let the model record what it
 * produced and audit the lineage of any artifact/claim later.
 */

async function fileHash(rel: string) {
  const full = path.isAbsolute(rel) ? rel : path.join(Instance.directory, rel)
  if (!Instance.containsPath(full)) return undefined
  const file = Bun.file(full)
  if (!(await file.exists())) return undefined
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buf)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return { hash: hash.slice(0, 16), size: buf.byteLength, full }
}

export const ProvenanceRecordTool = Tool.define("provenance_record", {
  description: [
    "Record a node (and optional edge) in the provenance DAG.",
    "Use to log artifacts you produce (datasets, figures, models, reports) and the runs that made them.",
    "For figures/tables/notebooks, always pass path + code_path + env so Files → Provenance can show a reproducible unit.",
    "Nodes are content-addressed; recording identical content returns the same id.",
  ].join("\n"),
  parameters: z.object({
    kind: z.enum(["artifact", "run", "source", "claim"]).describe("Node kind"),
    label: z.string().describe("Human-readable label"),
    artifact_type: z
      .string()
      .optional()
      .describe("For artifact nodes: type e.g. 'dataset' | 'figure' | 'model' | 'report' | 'table' | 'notebook'"),
    path: z.string().optional().describe("On-disk path if the node is a materialized file"),
    tool: z.string().optional().describe("For run nodes: the tool/command that executed"),
    code_path: z.string().optional().describe("Script or notebook path that produced this artifact (reproducibility)"),
    env: z
      .string()
      .optional()
      .describe("Short environment summary, e.g. 'python3.11 + scanpy==1.10' or conda env name"),
    inputs_hash: z.string().optional().describe("Hash or id of primary input data (or comma-separated input paths)"),
    command: z.string().optional().describe("Exact command line used, if applicable"),
    meta: z.record(z.string(), z.any()).optional().describe("Arbitrary structured metadata"),
    derived_from: z
      .string()
      .optional()
      .describe("Optional id of a parent node this was derived from (creates a 'derived-from' edge)"),
  }),
  async execute(params, ctx) {
    const hashed = params.path ? await fileHash(params.path) : undefined
    const meta = {
      sessionID: ctx.sessionID,
      ...(params.code_path ? { codePath: params.code_path } : {}),
      ...(params.env ? { env: params.env } : {}),
      ...(params.inputs_hash ? { inputsHash: params.inputs_hash } : {}),
      ...(params.command ? { command: params.command } : {}),
      ...params.meta,
    }

    const node = await Provenance.record({
      kind: params.kind,
      label: params.label,
      ...(params.artifact_type ? { artifactType: params.artifact_type } : {}),
      ...(params.path ? { path: hashed?.full ?? params.path } : {}),
      ...(params.tool ? { tool: params.tool } : {}),
      ...(hashed ? { contentHash: hashed.hash, size: hashed.size } : {}),
      ...(params.kind === "run"
        ? {
            inputs: {
              ...(params.inputs_hash ? { inputsHash: params.inputs_hash } : {}),
              ...(params.code_path ? { codePath: params.code_path } : {}),
              ...(params.command ? { command: params.command } : {}),
              ...(params.env ? { env: params.env } : {}),
            },
          }
        : {}),
      meta,
    } as Parameters<typeof Provenance.record>[0])

    if (params.derived_from) {
      await Provenance.link({ from: node.id, to: params.derived_from, relation: "derived-from" })
    }

    return {
      title: `Recorded ${params.kind}: ${node.id}`,
      output: [
        `Recorded provenance node.`,
        `  id: ${node.id}`,
        `  kind: ${node.kind}`,
        `  label: ${node.label}`,
        params.path ? `  path: ${hashed?.full ?? params.path}` : "",
        hashed ? `  contentHash: ${hashed.hash} (${hashed.size} bytes)` : "",
        params.code_path ? `  code_path: ${params.code_path}` : "",
        params.env ? `  env: ${params.env}` : "",
        params.inputs_hash ? `  inputs_hash: ${params.inputs_hash}` : "",
        params.derived_from ? `  derived-from: ${params.derived_from}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { id: node.id, kind: params.kind, contentHash: hashed?.hash },
    }
  },
})

export const ProvenanceQueryTool = Tool.define("provenance_query", {
  description: [
    "Query the provenance DAG. With `id`, returns that node plus its lineage tree.",
    "Without `id`, lists all recorded nodes. Use to audit how an artifact or claim was produced.",
  ].join("\n"),
  parameters: z.object({
    id: z.string().optional().describe("Node id to trace lineage for. Omit to list everything."),
  }),
  async execute(params, _ctx) {
    if (!params.id) {
      const nodes = await Provenance.list()
      if (!nodes.length) {
        return { title: "Provenance", output: "No provenance nodes recorded yet.", metadata: { count: 0, edges: 0 } }
      }
      const rows = nodes.map((n) => {
        const art = n as { path?: string; contentHash?: string; meta?: Record<string, unknown> }
        const bits = [
          `**${n.id}** [${n.kind}] ${n.label}`,
          art.path ? `path=${art.path}` : "",
          art.contentHash ? `hash=${art.contentHash}` : "",
          art.meta?.codePath ? `code=${art.meta.codePath}` : "",
        ].filter(Boolean)
        return `- ${bits.join(" · ")}`
      })
      return {
        title: `Provenance (${nodes.length} nodes)`,
        output: rows.join("\n"),
        metadata: { count: nodes.length, edges: 0 },
      }
    }

    const { nodes, edges } = await Provenance.query(params.id)
    if (!nodes.length) {
      return { title: "Provenance", output: `No node "${params.id}".`, metadata: { count: 0, edges: 0 } }
    }
    const nodeRows = nodes.map((n) => {
      const art = n as {
        path?: string
        contentHash?: string
        tool?: string
        meta?: Record<string, unknown>
      }
      return [
        `- **${n.id}** [${n.kind}] ${n.label}`,
        art.path ? `  path: ${art.path}` : "",
        art.contentHash ? `  contentHash: ${art.contentHash}` : "",
        art.tool ? `  tool: ${art.tool}` : "",
        art.meta?.codePath ? `  code_path: ${art.meta.codePath}` : "",
        art.meta?.env ? `  env: ${art.meta.env}` : "",
        art.meta?.inputsHash ? `  inputs_hash: ${art.meta.inputsHash}` : "",
        art.meta?.sessionID ? `  session: ${art.meta.sessionID}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    })
    const edgeRows = edges.map((e) => `- ${e.from} --${e.relation}--> ${e.to}`)
    return {
      title: `Lineage: ${params.id}`,
      output: [
        `**Nodes** (${nodes.length}):`,
        nodeRows.join("\n"),
        "",
        `**Edges** (${edges.length}):`,
        edgeRows.join("\n") || "(none)",
      ].join("\n"),
      metadata: { count: nodes.length, edges: edges.length },
    }
  },
})

export const ProvenanceReviewTool = Tool.define("provenance_review", {
  description: [
    "Record a reviewer finding against a provenance node.",
    "Use to flag a claim, statistic, or figure that the evidence does not support (verdict 'refutes'),",
    "or to log a check that passed sound (verdict 'supports').",
    "Creates a content-addressed 'claim' node holding {claim, issue, severity, evidence} and links it",
    "to the target node with a 'refutes'/'supports' edge. Append-only audit trail — the artifact is not modified.",
  ].join("\n"),
  parameters: z.object({
    target: z
      .string()
      .describe("Provenance node id the finding is about (the claim / artifact / figure / run under review)"),
    claim: z.string().describe("The exact claim, number, or figure being evaluated (quote it)"),
    issue: z.string().describe("What is wrong with it — or 'verified' when the finding supports it"),
    severity: z
      .enum(["blocking", "major", "minor", "info"])
      .describe("Severity: blocking (invalidates a headline claim) | major | minor | info"),
    evidence: z
      .string()
      .describe("Concrete evidence: file:line, value, tool-output id, or provenance node id proving the finding"),
    verdict: z
      .enum(["refutes", "supports"])
      .default("refutes")
      .describe("'refutes' flags a defect (default); 'supports' records a verified-sound check"),
  }),
  async execute(params, ctx) {
    const { node, relation } = await Review.record({
      target: params.target,
      finding: {
        claim: params.claim,
        issue: params.issue,
        severity: params.severity,
        evidence: params.evidence,
      },
      verdict: params.verdict,
      reviewer: ctx.agent,
      sessionID: ctx.sessionID,
    })
    return {
      title: `Review ${relation}: ${node.id}`,
      output: [
        `Recorded reviewer finding.`,
        `  finding id: ${node.id}`,
        `  target:     ${params.target}`,
        `  relation:   ${node.id} --${relation}--> ${params.target}`,
        `  severity:   ${params.severity}`,
        `  claim:      ${params.claim}`,
        `  issue:      ${params.issue}`,
        `  evidence:   ${params.evidence}`,
      ].join("\n"),
      metadata: { id: node.id, target: params.target, relation, severity: params.severity },
    }
  },
})

export const ProvenanceTools = [ProvenanceRecordTool, ProvenanceQueryTool, ProvenanceReviewTool]

export const PROVENANCE_TOOL_IDS = new Set(["provenance_record", "provenance_query", "provenance_review"])
