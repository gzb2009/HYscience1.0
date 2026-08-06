#!/usr/bin/env python3
"""Neighborhood enrichment analysis for spatial transcriptomics.

Input: qc-ed .h5ad with spatial coordinates + cluster annotation
Output: neighborhood_enrichment.csv + summary printed to stdout

Usage:
    python neighborhood_analysis.py --input qc.h5ad --cluster-key leiden --output-dir ./results
    python neighborhood_analysis.py --input qc.h5ad --cluster-key cell_type \\
        --n-neigh 8 --radius 200 --output-dir ./results
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import scanpy as sc
import squidpy as sq


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Spatial neighborhood enrichment analysis via Squidpy"
    )
    parser.add_argument("--input", required=True, help="QC-ed .h5ad file")
    parser.add_argument("--cluster-key", required=True,
                        help="Column in .obs with cluster/cell-type annotations")
    parser.add_argument("--n-neigh", type=int, default=6,
                        help="Number of neighbors for spatial graph (default: 6)")
    parser.add_argument("--radius", type=float, default=None,
                        help="Radius in spatial units for neighbor graph (overrides n_neigh)")
    parser.add_argument("--n-perms", type=int, default=100,
                        help="Permutations for enrichment test (default: 100)")
    parser.add_argument("--output-dir", default="./results", help="Output directory")
    return parser.parse_args()


def validate_input(adata: sc.AnnData, cluster_key: str) -> None:
    """Validate that required data is present."""
    if "spatial" not in adata.obsm:
        print("❌ 错误: .obsm['spatial'] 不存在。请先运行 spatial_qc.py。")
        sys.exit(1)
    if cluster_key not in adata.obs.columns:
        print(f"❌ 错误: 聚类键 '{cluster_key}' 在 .obs 中未找到。可用列: "
              f"{list(adata.obs.columns[:10])}...")
        sys.exit(1)


def build_spatial_graph(adata: sc.AnnData, n_neigh: int,
                        radius: float | None) -> None:
    """Build spatial neighbor graph."""
    kwargs = {"n_neighs": n_neigh}
    if radius is not None:
        kwargs["radius"] = radius
    else:
        kwargs["n_neighs"] = n_neigh

    print(f"📐 构建空间邻接图 (n_neighs={n_neigh}" +
          (f", radius={radius})..." if radius else ")..."))
    sq.gr.spatial_neighbors(adata, **kwargs)


def run_nhood_enrichment(adata: sc.AnnData, cluster_key: str,
                         n_perms: int) -> pd.DataFrame:
    """Run neighborhood enrichment analysis."""
    print(f"🔬 邻域富集分析 (cluster_key={cluster_key}, n_perms={n_perms})...")
    sq.gr.nhood_enrichment(adata, cluster_key=cluster_key, n_perms=n_perms)

    # Extract enrichment results
    if "nhood_enrichment" not in adata.uns:
        print("❌ 错误: 邻域富集分析未产生结果。")
        sys.exit(1)

    enrichment = adata.uns["nhood_enrichment"]
    df = pd.DataFrame(
        enrichment["zscore"],
        index=enrichment["cluster_labels"],
        columns=enrichment["cluster_labels"],
    )
    return df


def compute_morans_i(adata: sc.AnnData, cluster_key: str) -> pd.Series:
    """Compute Moran's I for each cluster to assess spatial autocorrelation."""
    print("📏 计算 Moran's I 空间自相关性...")
    sq.gr.spatial_autocorr(
        adata,
        mode="moran",
        genes=False,
        cluster_key=cluster_key,
        n_perms=100,
    )

    moran_key = "moranI" if "moranI" in adata.uns else "morani"
    if moran_key not in adata.uns:
        print("  ⚠ Moran's I 结果未找到，跳过此步骤。")
        return pd.Series(dtype=float)

    moran_results = adata.uns[moran_key]
    moran_series = pd.Series(moran_results, name="Morans_I")
    moran_series.index.name = "cluster"
    return moran_series


def main() -> None:
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ 错误: 输入文件不存在: {args.input}")
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"📂 加载数据: {args.input}")
    adata = sc.read_h5ad(args.input)
    print(f"  ▪ Spots: {adata.n_obs}, Genes: {adata.n_vars}")

    validate_input(adata, args.cluster_key)

    clusters = adata.obs[args.cluster_key].unique()
    print(f"  ▪ 聚类类型: {len(clusters)} → {sorted(clusters)[:5]}..."
          if len(clusters) > 5 else f"  ▪ 聚类类型: {sorted(clusters)}")

    # Build spatial graph
    build_spatial_graph(adata, args.n_neigh, args.radius)

    # Neighborhood enrichment
    enrichment_df = run_nhood_enrichment(adata, args.cluster_key, args.n_perms)

    # Moran's I
    moran_series = compute_morans_i(adata, args.cluster_key)

    # Save results
    enrichment_path = output_dir / "neighborhood_enrichment.csv"
    enrichment_df.to_csv(enrichment_path)
    print(f"💾 邻域富集矩阵 → {enrichment_path}")

    if not moran_series.empty:
        moran_path = output_dir / "morans_i.csv"
        moran_series.to_csv(moran_path)
        print(f"💾 Moran's I → {moran_path}")

    # Summary
    n_sig = (np.abs(enrichment_df.values) > 2).sum() // 2  # symmetric
    print(f"✅ 邻域分析完成: {n_sig}个显著空间富集 "
          f"(|z-score| > 2)")


if __name__ == "__main__":
    main()
