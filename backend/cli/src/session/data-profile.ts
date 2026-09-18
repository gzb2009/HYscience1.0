import path from "path"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { ProcessEnvironment } from "@/process/environment"
import { ThemeSlots } from "./theme-slots"

/**
 * Data profile — a deterministic, data-aware summary of files the user
 * attached or named (h5ad / csv / tsv). Runs a short stdlib-first Python
 * script so the agent sees real shape, columns, and QC hints instead of
 * inferring them from keywords. Silent when Python or the file is missing.
 */
export namespace DataProfile {
  const log = Log.create({ service: "data-profile" })
  const KEY = "data-profile"
  const EXT = /\.(h5ad|csv|tsv|mcd|ome\.tiff?|tiff?|vcf)(\.gz)?$/i
  const MENTION =
    /(?:^|[\s"'`(（])((?:~|\.{1,2})?\/?[\w./\-\u4e00-\u9fa5]+\.(?:h5ad|csv|tsv|mcd|ome\.tiff?|tiff?|vcf)(?:\.gz)?)\b/gi
  const TIMEOUT = 20_000
  const MAX_FILES = 3
  const cache = new Map<string, { mtime: number; summary: Summary }>()

  export type Summary =
    | {
        status: "ok"
        kind: "h5ad"
        n_obs: number
        n_vars: number
        obs: string[]
        var: string[]
        obsm: string[]
        layers: string[]
        raw: boolean
        mito_pct?: number
        genes_per_cell_median?: number
        backend: string
      }
    | {
        status: "ok"
        kind: "table"
        rows: number
        columns: string[]
        numeric: string[]
        sample: string[][]
        delimiter: string
        panel?: { channels: number; isotopes: string[]; duplicates: string[]; clone: boolean }
      }
    | { status: "ok"; kind: "image"; bytes: number; note: string }
    | { status: "ok"; kind: "vcf"; reference?: string; samples: number; variants?: number }
    | { status: "unavailable" | "error"; reason: string }

  const SCRIPT = String.raw`
import sys, json, os, csv
p = sys.argv[1]
out = {}
try:
    if p.lower().endswith(".h5ad"):
        try:
            import anndata as ad
            a = ad.read_h5ad(p, backed="r")
            out = {"status":"ok","kind":"h5ad","backend":"anndata","n_obs":int(a.n_obs),"n_vars":int(a.n_vars),
                   "obs":list(map(str,a.obs.columns))[:30],"var":list(map(str,a.var.columns))[:15],
                   "obsm":[k for k in a.obsm.keys() if isinstance(k, str)][:10],"layers":[k for k in a.layers.keys() if isinstance(k, str)][:10],"raw":a.raw is not None}
            try:
                import numpy as np
                names = np.array([str(v) for v in a.var_names])
                mt = np.array([n.upper().startswith("MT-") for n in names])
                n = min(a.n_obs, 2000)
                X = a[:n].to_memory().X
                tot = np.asarray(X.sum(axis=1)).ravel()
                if mt.any() and tot.sum() > 0:
                    out["mito_pct"] = round(float(np.asarray(X[:, mt].sum(axis=1)).ravel().sum() / tot.sum() * 100), 2)
                nz = np.asarray((X > 0).sum(axis=1)).ravel()
                out["genes_per_cell_median"] = int(np.median(nz))
            except Exception:
                pass
        except ImportError:
            try:
                import h5py
                f = h5py.File(p, "r")
                def keys(g): return list(f[g].keys())[:30] if g in f and hasattr(f[g], "keys") else []
                shape = None
                if "X" in f:
                    x = f["X"]
                    shape = list(x.attrs.get("shape", x.shape if hasattr(x, "shape") else [0, 0]))
                out = {"status":"ok","kind":"h5ad","backend":"h5py","n_obs":int(shape[0]) if shape else 0,"n_vars":int(shape[1]) if shape else 0,
                       "obs":keys("obs"),"var":keys("var"),"obsm":keys("obsm"),"layers":keys("layers"),"raw":"raw" in f}
            except ImportError:
                out = {"status":"unavailable","reason":"python has neither anndata nor h5py"}
    else:
        delim = "\t" if p.lower().endswith(".tsv") else ","
        with open(p, newline="", encoding="utf-8", errors="replace") as fh:
            rd = csv.reader(fh, delimiter=delim)
            header = next(rd, [])
            sample = []
            rows = 0
            numeric = [True] * len(header)
            for row in rd:
                rows += 1
                if rows <= 5: sample.append(row[:12])
                if rows <= 200:
                    for i, v in enumerate(row[:len(header)]):
                        if v == "" : continue
                        try: float(v)
                        except ValueError: numeric[i] = False
        out = {"status":"ok","kind":"table","rows":rows,"columns":header[:40],"delimiter":"tab" if delim == "\t" else "comma",
               "numeric":[h for h, ok in zip(header, numeric) if ok][:40],"sample":sample}
except Exception as e:
    out = {"status":"error","reason":f"{type(e).__name__}: {e}"[:200]}
print(json.dumps(out))
`

  function local(url: string) {
    if (url.startsWith("file://")) return decodeURIComponent(url.slice(7))
    if (url.startsWith("/")) return url
    return undefined
  }

  function accept(file: string, theme?: string) {
    if (EXT.test(file)) return true
    return ThemeSlots.extra(theme)?.test(file) ?? false
  }

  /** Candidate local files from attachments and explicit path mentions. */
  export function candidates(userMessage: MessageV2.WithParts, cwd = process.cwd(), theme?: string) {
    const out = new Set<string>()
    for (const part of userMessage.parts) {
      if (part.type === "file") {
        const file = local((part as MessageV2.FilePart).url)
        if (file && accept(file, theme)) out.add(file)
      }
      if (part.type === "text" && !(part as MessageV2.TextPart).hybio) {
        for (const match of (part as MessageV2.TextPart).text.matchAll(MENTION)) {
          const raw = match[1].replace(/^~/, process.env.HOME ?? "~")
          out.add(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw))
        }
      }
    }
    return [...out].slice(0, MAX_FILES)
  }

  async function peekVcf(file: string): Promise<Summary> {
    const raw = await Bun.file(file).arrayBuffer()
    const bytes = file.endsWith(".gz") ? Bun.gunzipSync(raw) : new Uint8Array(raw)
    const text = new TextDecoder().decode(bytes.slice(0, 256_000))
    const reference = text.match(/##reference=(\S+)/)?.[1]
    const chrom = text.split("\n").find((line) => line.startsWith("#CHROM"))
    const samples = chrom ? Math.max(0, chrom.split("\t").length - 9) : 0
    return { status: "ok", kind: "vcf", reference, samples }
  }

  function panelHint(columns: string[], sample: string[][]) {
    const isotopeAt = columns.findIndex((column) => /^(?:isotope|metal|channel|金属|同位素)$/i.test(column))
    if (isotopeAt < 0) return undefined
    const isotopes = sample.map((row) => row[isotopeAt]).filter(Boolean)
    const seen = new Map<string, number>()
    for (const value of isotopes) seen.set(value.toLowerCase(), (seen.get(value.toLowerCase()) ?? 0) + 1)
    return {
      channels: sample.length,
      isotopes,
      duplicates: [...seen].filter(([, n]) => n > 1).map(([id]) => id),
      clone: columns.some((column) => /^(?:clone|克隆)$/i.test(column)),
    }
  }

  export async function profile(file: string): Promise<Summary | undefined> {
    const stat = await Bun.file(file)
      .stat()
      .catch(() => undefined)
    if (!stat) return undefined
    const hit = cache.get(file)
    if (hit && hit.mtime === stat.mtimeMs) return hit.summary
    const lower = file.toLowerCase()
    const summary = await (async (): Promise<Summary> => {
      if (/\.(mcd|ome\.tiff?|tiff?)$/.test(lower)) {
        return {
          status: "ok",
          kind: "image",
          bytes: stat.size,
          note: "acquisition image — segmentation required before cells exist",
        }
      }
      if (/\.vcf(\.gz)?$/.test(lower)) {
        return peekVcf(file).catch((error) => ({
          status: "error" as const,
          reason: error instanceof Error ? error.message : "vcf peek failed",
        }))
      }
      const env = await ProcessEnvironment.resolve("notebook").catch(() => process.env)
      const proc = Bun.spawn(["python3", "-c", SCRIPT, file], { stdout: "pipe", stderr: "pipe", env })
      const timer = setTimeout(() => proc.kill(), TIMEOUT)
      const text = await new Response(proc.stdout).text().catch(() => "")
      await proc.exited
      clearTimeout(timer)
      const line = text.trim().split("\n").at(-1) ?? ""
      try {
        const parsed = JSON.parse(line) as Summary
        if (parsed.status === "ok" && parsed.kind === "table") {
          return { ...parsed, panel: panelHint(parsed.columns, parsed.sample) }
        }
        return parsed
      } catch {
        return { status: "error", reason: proc.exitCode === null ? "timed out" : "python did not return JSON" }
      }
    })()
    cache.set(file, { mtime: stat.mtimeMs, summary })
    return summary
  }

  export function render(file: string, summary: Summary) {
    const name = path.basename(file)
    if (summary.status !== "ok") {
      return `<${KEY} file="${name}" status="${summary.status}">${summary.reason}. Do not guess its contents; say what is needed to read it.</${KEY}>`
    }
    if (summary.kind === "image") {
      return [
        `<${KEY} file="${name}" kind="image" bytes="${summary.bytes}">`,
        summary.note,
        "Do not guess channel count or cell numbers from the filename.",
        `</${KEY}>`,
      ].join("\n")
    }
    if (summary.kind === "vcf") {
      return [
        `<${KEY} file="${name}" kind="vcf">`,
        summary.reference ? `##reference=${summary.reference}` : "no ##reference in the header peek",
        `${summary.samples} sample column(s) after FORMAT`,
        "Use this build; do not assume GRCh38.",
        `</${KEY}>`,
      ].join("\n")
    }
    if (summary.kind === "h5ad") {
      const spatial = summary.obsm.some((key) => /spatial/i.test(key))
      const lines = [
        `<${KEY} file="${name}" kind="h5ad" backend="${summary.backend}">`,
        `${summary.n_obs} cells × ${summary.n_vars} genes; raw=${summary.raw}`,
        summary.obs.length ? `obs: ${summary.obs.join(", ")}` : "",
        summary.obsm.length ? `obsm: ${summary.obsm.join(", ")}` : "",
        spatial ? "spatial coordinates: present in obsm" : "spatial coordinates: NOT in obsm",
        summary.layers.length ? `layers: ${summary.layers.join(", ")}` : "",
        summary.mito_pct !== undefined ? `mito fraction (first ≤2000 cells): ${summary.mito_pct}%` : "",
        summary.genes_per_cell_median !== undefined
          ? `median genes/cell (first ≤2000 cells): ${summary.genes_per_cell_median}`
          : "",
        "Use these measured facts; do not ask the user for shape or column names that appear here. Note whether QC/normalization already happened (obs columns, layers, raw) before proposing steps.",
        `</${KEY}>`,
      ]
      return lines.filter(Boolean).join("\n")
    }
    const panel = summary.panel
    return [
      `<${KEY} file="${name}" kind="table" delimiter="${summary.delimiter}">`,
      `${summary.rows} rows; columns: ${summary.columns.join(", ")}`,
      summary.numeric.length ? `numeric: ${summary.numeric.join(", ")}` : "",
      summary.sample.length ? `first rows: ${summary.sample.map((row) => row.join(" | ")).join(" ⏎ ")}` : "",
      panel
        ? `panel: ${panel.channels} listed channels; isotopes=${panel.isotopes.join(", ") || "none"}${panel.duplicates.length ? `; DUPLICATE isotopes: ${panel.duplicates.join(", ")}` : ""}; clone column=${panel.clone}`
        : "",
      "Use these measured facts; infer column roles (cluster id, gene symbol, logFC, p-value, pct, isotope) from the names and values above instead of asking.",
      `</${KEY}>`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  export async function inject(userMessage: MessageV2.WithParts, cwd?: string, theme?: string) {
    if (userMessage.parts.some((part) => part.type === "text" && part.hybio && part.text.includes(`<${KEY} `))) return
    const files = candidates(userMessage, cwd, theme)
    if (files.length === 0) return
    const blocks = await Promise.all(
      files.map(async (file) => {
        const summary = await profile(file).catch((error) => {
          log.warn("data profile failed", { file, error: error instanceof Error ? error.message : String(error) })
          return undefined
        })
        return summary ? render(file, summary) : undefined
      }),
    )
    for (const block of blocks) {
      if (!block) continue
      userMessage.parts.push({
        id: Identifier.ascending("part"),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: block,
        hybio: true,
      })
    }
  }
}
