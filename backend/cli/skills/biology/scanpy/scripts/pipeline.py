#!/usr/bin/env python3
"""
Deterministic scRNA-seq golden-path pipeline (scanpy).

Stages (fixed order — do not skip):
  load → QC → normalize/log1p → HVG → PCA → neighbors → leiden → rank_genes → write

Outputs under --output-dir:
  adata.h5ad
  figures/umap_leiden.png
  figures/qc_violin.png
  markers.csv
  _script_manifest.jsonl

Usage:
  python pipeline.py --input data.h5ad --output-dir ./scrna_out
  python pipeline.py --input data.h5ad --output-dir ./scrna_out --min-genes 200 --resolution 0.5
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone


STAGES = (
    "load",
    "qc",
    "normalize",
    "hvg",
    "pca",
    "neighbors",
    "leiden",
    "rank_genes",
    "write",
)

REQUIRED_OUTPUTS = (
    "adata.h5ad",
    "figures/umap_leiden.png",
    "figures/qc_violin.png",
    "markers.csv",
    "_script_manifest.jsonl",
)


def validate_output_dir(output_dir: str) -> str:
    cwd = os.path.realpath(os.getcwd())
    resolved = os.path.realpath(os.path.join(cwd, output_dir))
    if not resolved.startswith(cwd + os.sep) and resolved != cwd:
        print("ERROR: Output directory escapes working directory.", file=sys.stderr)
        print(f"  CWD: {cwd}", file=sys.stderr)
        print(f"  out: {resolved}", file=sys.stderr)
        sys.exit(2)
    os.makedirs(resolved, exist_ok=True)
    os.makedirs(os.path.join(resolved, "figures"), exist_ok=True)
    return resolved


def validate_output(output_dir: str) -> int:
    cwd = os.path.realpath(os.getcwd())
    resolved = os.path.realpath(os.path.join(cwd, output_dir))
    if not resolved.startswith(cwd + os.sep) and resolved != cwd:
        print("ERROR: Validation directory escapes working directory.", file=sys.stderr)
        return 2

    missing = [rel for rel in REQUIRED_OUTPUTS if not os.path.isfile(os.path.join(resolved, rel))]
    completed = set()
    statuses = {}
    manifest = os.path.join(resolved, "_script_manifest.jsonl")
    if os.path.isfile(manifest):
        with open(manifest, encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                stage = row.get("stage")
                if stage:
                    completed.add(stage)
                    statuses[stage] = row.get("status")

    failed_stages = [stage for stage in STAGES if statuses.get(stage) not in ("ok", "warn")]
    missing_stages = [stage for stage in STAGES if stage not in completed]
    errors = [f"missing file: {rel}" for rel in missing]
    errors.extend(f"missing manifest stage: {stage}" for stage in missing_stages)
    errors.extend(f"failed/warn stage: {stage}" for stage in failed_stages)

    if errors:
        print(f"VALIDATION FAILED: {output_dir}", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print(f"VALIDATION OK: {output_dir}")
    print(f"  stages: {', '.join(STAGES)}")
    print(f"  outputs: {len(REQUIRED_OUTPUTS)} required files present")
    return 0


def log_manifest(output_dir: str, stage: str, status: str, **extra):
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "pipeline": "scanpy-scrna",
        "stage": stage,
        "status": status,
        **extra,
    }
    path = os.path.join(output_dir, "_script_manifest.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_adata(path: str):
    import scanpy as sc

    lower = path.lower()
    if lower.endswith(".h5ad"):
        return sc.read_h5ad(path)
    if lower.endswith(".h5") or lower.endswith(".hdf5"):
        return sc.read_10x_h5(path)
    if os.path.isdir(path):
        return sc.read_10x_mtx(path)
    if lower.endswith(".csv"):
        return sc.read_csv(path)
    raise SystemExit(f"Unsupported input: {path}")


def run(args: argparse.Namespace) -> int:
    try:
        import scanpy as sc
        import pandas as pd
    except ImportError as e:
        print(f"ERROR: missing dependency: {e}", file=sys.stderr)
        print("Install: pip install 'scanpy>=1.10' anndata pandas matplotlib", file=sys.stderr)
        return 1

    out = validate_output_dir(args.output_dir)
    sc.settings.verbosity = 2
    sc.settings.set_figure_params(dpi=120, facecolor="white")
    sc.settings.figdir = os.path.join(out, "figures") + os.sep

    t0 = time.time()
    log_manifest(out, "start", "ok", input=os.path.abspath(args.input))

    # load
    adata = load_adata(args.input)
    log_manifest(out, "load", "ok", n_obs=int(adata.n_obs), n_vars=int(adata.n_vars))

    # qc
    adata.var["mt"] = adata.var_names.str.upper().str.startswith("MT-")
    sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], percent_top=None, log1p=False, inplace=True)
    sc.pp.filter_cells(adata, min_genes=args.min_genes)
    sc.pp.filter_genes(adata, min_cells=args.min_cells)
    if "pct_counts_mt" in adata.obs and args.max_mt is not None:
        adata = adata[adata.obs["pct_counts_mt"] < args.max_mt].copy()
    try:
        sc.pl.violin(
            adata,
            ["n_genes_by_counts", "total_counts", "pct_counts_mt"],
            jitter=0.4,
            multi_panel=True,
            show=False,
            save="_qc_violin.png",
        )
        # scanpy prefixes figdir; normalize name
        src = os.path.join(out, "figures", "violin_qc_violin.png")
        dst = os.path.join(out, "figures", "qc_violin.png")
        if os.path.exists(src):
            os.replace(src, dst)
    except Exception as e:
        log_manifest(out, "qc", "warn", note=f"qc plot failed: {e}")
    log_manifest(out, "qc", "ok", n_obs=int(adata.n_obs), n_vars=int(adata.n_vars))

    # normalize
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)
    adata.raw = adata
    log_manifest(out, "normalize", "ok")

    # hvg
    sc.pp.highly_variable_genes(adata, n_top_genes=args.n_hvg, subset=False)
    adata = adata[:, adata.var["highly_variable"]].copy()
    log_manifest(out, "hvg", "ok", n_hvg=int(adata.n_vars))

    # pca / neighbors / leiden
    sc.pp.scale(adata, max_value=10)
    sc.tl.pca(adata, svd_solver="arpack")
    log_manifest(out, "pca", "ok")
    sc.pp.neighbors(adata, n_neighbors=args.n_neighbors, n_pcs=args.n_pcs)
    log_manifest(out, "neighbors", "ok")
    sc.tl.leiden(adata, resolution=args.resolution, key_added="leiden")
    log_manifest(out, "leiden", "ok", n_clusters=int(adata.obs["leiden"].nunique()))
    sc.tl.umap(adata)
    try:
        sc.pl.umap(adata, color="leiden", show=False, save="_leiden.png")
        src = os.path.join(out, "figures", "umap_leiden.png")
        alt = os.path.join(out, "figures", "umap_leiden.png")
        # scanpy may write umap_leiden.png already via save=
        if not os.path.exists(alt):
            cand = os.path.join(out, "figures", "umap_leiden.png")
            if os.path.exists(cand):
                pass
    except Exception as e:
        log_manifest(out, "umap", "warn", note=str(e))

    # rank genes
    sc.tl.rank_genes_groups(adata, "leiden", method="wilcoxon")
    try:
        markers = sc.get.rank_genes_groups_df(adata, group=None)
        markers.to_csv(os.path.join(out, "markers.csv"), index=False)
    except Exception:
        # older scanpy fallback
        result = adata.uns["rank_genes_groups"]
        groups = result["names"].dtype.names
        rows = []
        for g in groups:
            for i, gene in enumerate(result["names"][g][:50]):
                rows.append({"cluster": g, "gene": gene, "rank": i})
        pd.DataFrame(rows).to_csv(os.path.join(out, "markers.csv"), index=False)
    log_manifest(out, "rank_genes", "ok", markers=os.path.join(out, "markers.csv"))

    # write
    adata.write_h5ad(os.path.join(out, "adata.h5ad"))
    log_manifest(
        out,
        "write",
        "ok",
        adata=os.path.join(out, "adata.h5ad"),
        elapsed_s=round(time.time() - t0, 2),
        stages=list(STAGES),
    )
    print(f"OK: wrote {out}/adata.h5ad and markers.csv ({time.time() - t0:.1f}s)")
    return 0


def main():
    p = argparse.ArgumentParser(description="Deterministic scanpy scRNA golden-path pipeline")
    p.add_argument("--input", help="h5ad / 10x h5 / 10x mtx dir / csv")
    p.add_argument("--output-dir", help="Output directory (must stay under CWD)")
    p.add_argument("--validate", metavar="OUTPUT_DIR", help="Validate an existing golden-path output directory")
    p.add_argument("--min-genes", type=int, default=200)
    p.add_argument("--min-cells", type=int, default=3)
    p.add_argument("--max-mt", type=float, default=20.0, help="Max %% mitochondrial counts")
    p.add_argument("--n-hvg", type=int, default=2000)
    p.add_argument("--n-neighbors", type=int, default=15)
    p.add_argument("--n-pcs", type=int, default=40)
    p.add_argument("--resolution", type=float, default=0.5)
    args = p.parse_args()
    if args.validate:
        sys.exit(validate_output(args.validate))
    if not args.input or not args.output_dir:
        p.error("--input and --output-dir are required unless --validate is used")
    if not os.path.exists(args.input):
        print(f"ERROR: input not found: {args.input}", file=sys.stderr)
        sys.exit(2)
    sys.exit(run(args))


if __name__ == "__main__":
    main()
