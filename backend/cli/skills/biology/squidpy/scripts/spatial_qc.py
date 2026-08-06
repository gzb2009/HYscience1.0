#!/usr/bin/env python3
"""Spatial QC: compute spatial metrics, check spot coverage, filter low-quality spots.

Input: .h5ad with spatial coordinates in .obsm['spatial']
Output: qc-ed .h5ad

Usage:
    python spatial_qc.py --input raw.h5ad --output qc.h5ad
    python spatial_qc.py --input raw.h5ad --output qc.h5ad \\
        --min-counts 500 --min-genes 200 --max-mito 0.2
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import scanpy as sc
import squidpy as sq


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Spatial QC for transcriptomics data (Visium/MERFISH/Xenium/Slide-seq)"
    )
    parser.add_argument("--input", required=True, help="Input .h5ad file")
    parser.add_argument("--output", required=True, help="Output qc-ed .h5ad file")
    parser.add_argument("--min-counts", type=float, default=500,
                        help="Minimum total counts per spot (default: 500)")
    parser.add_argument("--min-genes", type=int, default=200,
                        help="Minimum number of genes expressed per spot (default: 200)")
    parser.add_argument("--max-mito", type=float, default=0.2,
                        help="Maximum mitochondrial gene fraction (default: 0.2)")
    return parser.parse_args()


def validate_spatial_coords(adata: sc.AnnData) -> None:
    """Check that spatial coordinates exist and have correct shape."""
    if "spatial" not in adata.obsm:
        print("❌ 错误: .obsm['spatial'] 不存在。请确保空间坐标已加载。")
        sys.exit(1)
    coords = adata.obsm["spatial"]
    if coords.ndim != 2 or coords.shape[1] != 2:
        print(f"❌ 错误: 空间坐标形状应为 (n_obs, 2)，当前形状: {coords.shape}")
        sys.exit(1)
    if not np.issubdtype(coords.dtype, np.number):
        print(f"❌ 错误: 空间坐标类型应为数值型，当前类型: {coords.dtype}")
        sys.exit(1)


def compute_spatial_metrics(adata: sc.AnnData) -> None:
    """Compute spot-level spatial quality metrics."""
    # Total counts per spot
    sc.pp.calculate_qc_metrics(adata, inplace=True)
    adata.obs["log_total_counts"] = np.log1p(adata.obs["total_counts"])

    # Spot coverage: number of unique spatial positions
    coords = adata.obs[["x", "y"]] if "x" in adata.obs and "y" in adata.obs else None
    if coords is None and "spatial" in adata.obsm:
        adata.obs["x"] = adata.obsm["spatial"][:, 0]
        adata.obs["y"] = adata.obsm["spatial"][:, 1]

    unique_spots = len(set(zip(adata.obs["x"].round(1), adata.obs["y"].round(1))))
    print(f"  ▪ 唯一点位数: {unique_spots}/{adata.n_obs}")

    # Compute mito fraction if not already present
    if "pct_counts_mt" not in adata.obs:
        adata.var["mt"] = adata.var_names.str.startswith("MT-")
        sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True, log1p=False)
        adata.obs["pct_counts_mt"] = adata.obs["pct_counts_mt"].fillna(0)
    # Rename to consistent name
    if "pct_counts_mt" in adata.obs and "mito_frac" not in adata.obs:
        adata.obs["mito_frac"] = adata.obs["pct_counts_mt"] / 100.0


def filter_low_quality(adata: sc.AnnData, min_counts: float,
                       min_genes: int, max_mito: float) -> sc.AnnData:
    """Filter out low-quality spots based on QC thresholds."""
    n_before = adata.n_obs

    mask = (
        (adata.obs["total_counts"] >= min_counts)
        & (adata.obs["n_genes_by_counts"] >= min_genes)
        & (adata.obs["mito_frac"] <= max_mito)
    )

    if mask.sum() == n_before:
        print("  ▪ 所有 spots 均通过 QC 过滤")
        return adata

    removed = (~mask).sum()
    adata = adata[mask].copy()
    print(f"  ▪ 移除低质量 spots: {removed} ({(removed / n_before * 100):.1f}%)")

    return adata


def main() -> None:
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ 错误: 输入文件不存在: {args.input}")
        sys.exit(1)

    print(f"📂 加载数据: {args.input}")
    adata = sc.read_h5ad(args.input)
    print(f"  ▪ Spots: {adata.n_obs}, Genes: {adata.n_vars}")

    # Validate spatial coordinates
    validate_spatial_coords(adata)

    # Compute spatial metrics
    print("📊 计算空间 QC 指标...")
    compute_spatial_metrics(adata)

    # Print summary stats
    print(f"  ▪ 总计数中位数: {adata.obs['total_counts'].median():.0f}")
    print(f"  ▪ 基因数中位数: {adata.obs['n_genes_by_counts'].median():.0f}")
    print(f"  ▪ 线粒体比例中位数: {adata.obs['mito_frac'].median():.3f}")

    # Filter low-quality spots
    print(f"🔍 过滤低质量 spots (min_counts={args.min_counts}, "
          f"min_genes={args.min_genes}, max_mito={args.max_mito})...")
    adata = filter_low_quality(adata, args.min_counts, args.min_genes, args.max_mito)

    # Ensure spatial coordinates are preserved after filtering
    if "spatial" not in adata.obsm:
        adata.obsm["spatial"] = np.column_stack([adata.obs["x"].values,
                                                  adata.obs["y"].values])

    # Save
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    adata.write_h5ad(output_path)
    print(f"✅ 空间QC完成: {adata.n_obs} spots保留 → {output_path}")


if __name__ == "__main__":
    main()
