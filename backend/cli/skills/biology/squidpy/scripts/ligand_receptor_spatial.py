#!/usr/bin/env python3
"""Spatial ligand-receptor analysis with distance constraints.

Input: .h5ad with spatial coordinates + cluster annotation + spatial neighbors
Output: spatial_lr_results.csv

Usage:
    python ligand_receptor_spatial.py --input qc.h5ad --cluster-key leiden --output-dir ./results
    python ligand_receptor_spatial.py --input qc.h5ad --cluster-key cell_type \\
        --distance 200 --n-perms 100 --output-dir ./results
"""

import argparse
import sys
from pathlib import Path

import pandas as pd
import scanpy as sc
import squidpy as sq


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Spatial ligand-receptor analysis via Squidpy"
    )
    parser.add_argument("--input", required=True, help="QC-ed .h5ad file")
    parser.add_argument("--cluster-key", required=True,
                        help="Column in .obs with cluster/cell-type annotations")
    parser.add_argument("--distance", type=float, default=None,
                        help="Maximum distance for spatial LR (default: auto from spatial graph)")
    parser.add_argument("--n-perms", type=int, default=100,
                        help="Permutations for significance test (default: 100)")
    parser.add_argument("--p-value", type=float, default=0.05,
                        help="P-value threshold for significance (default: 0.05)")
    parser.add_argument("--species", default="human",
                        choices=["human", "mouse"],
                        help="Species for ligand-receptor database (default: human)")
    parser.add_argument("--output-dir", default="./results", help="Output directory")
    return parser.parse_args()


def validate_input(adata: sc.AnnData, cluster_key: str) -> None:
    """Validate that required data is present."""
    if "spatial" not in adata.obsm:
        print("❌ 错误: .obsm['spatial'] 不存在。请先运行 spatial_qc.py。")
        sys.exit(1)
    if cluster_key not in adata.obs.columns:
        print(f"❌ 错误: 聚类键 '{cluster_key}' 在 .obs 中未找到。")
        sys.exit(1)
    if "spatial_neighbors" not in adata.uns:
        print("  ⚠ 'spatial_neighbors' 未找到，正在构建...")
        sq.gr.spatial_neighbors(adata, n_neighs=6)


def run_spatial_ligrec(adata: sc.AnnData, cluster_key: str,
                       distance: float | None, n_perms: int,
                       species: str) -> pd.DataFrame:
    """Run spatial ligand-receptor analysis with distance constraints."""
    distance_str = f"distance={distance}px" if distance else "distance=auto"
    print(f"🧬 空间配体-受体分析 (cluster={cluster_key}, {distance_str}, "
          f"species={species}, n_perms={n_perms})...")

    kwargs = {
        "cluster_key": cluster_key,
        "n_perms": n_perms,
        "use_raw": False,
        "corr_method": "fdr_bh",
        "confidence": 0.9,
    }
    if distance is not None:
        kwargs["use_spatial"] = True
        kwargs["spatial_radius"] = distance

    sq.gr.ligrec(adata, **kwargs)

    lr_key = f"{cluster_key}_ligrec"
    if lr_key not in adata.uns:
        print("❌ 错误: 配体-受体分析未产生结果。")
        sys.exit(1)

    # Extract results into a flat DataFrame
    lr_results = adata.uns[lr_key]
    if isinstance(lr_results, dict):
        pvals = lr_results.get("pvalues", None)
        means = lr_results.get("means", None)
    else:
        pvals = lr_results.get("pvalues", None)
        means = lr_results.get("means", None)

    if pvals is None:
        print("❌ 错误: 未找到 pvalues 结果。")
        sys.exit(1)

    records = []
    for src_cluster in pvals.index:
        for tgt_cluster in pvals.columns:
            pval = pvals.loc[src_cluster, tgt_cluster]
            if isinstance(pval, pd.DataFrame):
                pval = pval["pvalue"].min()
            if pd.isna(pval):
                continue
            mean_val = None
            if means is not None:
                mean = means.loc[src_cluster, tgt_cluster]
                if isinstance(mean, pd.DataFrame) and "means" in mean.columns:
                    mean_val = mean["means"].max()
            records.append({
                "source_cluster": src_cluster,
                "target_cluster": tgt_cluster,
                "pvalue": pval,
                "max_mean": mean_val,
            })

    df = pd.DataFrame(records)
    if not df.empty:
        df = df.sort_values("pvalue").reset_index(drop=True)
    return df


def filter_significant(df: pd.DataFrame, p_threshold: float) -> pd.DataFrame:
    """Filter to significant ligand-receptor pairs."""
    before = len(df)
    df = df[df["pvalue"] <= p_threshold].copy()
    after = len(df)
    if before > 0:
        print(f"  ▪ 显著配体-受体对 (p ≤ {p_threshold}): {after}/{before} "
              f"({after / before * 100:.1f}%)")
    return df


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
    print(f"  ▪ Spots: {adata.n_obs}, Clusters: "
          f"{adata.obs[args.cluster_key].nunique()}")

    validate_input(adata, args.cluster_key)

    # Run spatial ligand-receptor analysis
    lr_df = run_spatial_ligrec(
        adata, args.cluster_key, args.distance,
        args.n_perms, args.species,
    )

    # Filter significant
    lr_df = filter_significant(lr_df, args.p_value)

    # Save
    lr_path = output_dir / "spatial_lr_results.csv"
    lr_df.to_csv(lr_path, index=False)
    print(f"💾 空间配体-受体结果 → {lr_path}")

    # Summary
    top_pairs = lr_df.head(5)
    if not top_pairs.empty:
        print("  ▪ Top 5:")
        for _, row in top_pairs.iterrows():
            print(f"    {row['source_cluster']} → {row['target_cluster']}: "
                  f"p={row['pvalue']:.4f}")

    print(f"✅ 空间配体-受体分析完成")


if __name__ == "__main__":
    main()
