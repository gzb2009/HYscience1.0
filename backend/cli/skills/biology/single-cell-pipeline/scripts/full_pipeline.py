#!/usr/bin/env python3
"""
一键式单细胞分析管道。

Usage:
    python full_pipeline.py --input raw.h5ad --output-dir ./results --species human

流程: QC → 整合(可选) → 降维 → 聚类 → 注释 → 差异分析 → 报告
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import scanpy as sc

sc.settings.verbosity = 1
sc.settings.set_figure_params(dpi=100, facecolor="white")


def qc_and_filter(adata):
    """质量控制和过滤"""
    before = adata.n_obs
    sc.pp.filter_cells(adata, min_genes=200)
    sc.pp.filter_genes(adata, min_cells=3)

    adata.var["mt"] = adata.var_names.str.startswith("MT-")
    sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], percent_top=None, log1p=False)

    adata = adata[adata.obs.pct_counts_mt < 20, :].copy()
    adata = adata[adata.obs.n_genes_by_counts < 6000, :].copy()

    after = adata.n_obs
    print(f"✅ QC完成: {after}/{before} 个细胞通过质控 ({after/before*100:.0f}%)")
    return adata


def normalize_and_reduce(adata, n_hvg=2000, n_pcs=30):
    """归一化、高变基因、PCA、邻居图、UMAP"""
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)
    sc.pp.highly_variable_genes(adata, n_top_genes=n_hvg, flavor="seurat_v3")
    adata = adata[:, adata.var.highly_variable].copy()
    sc.pp.scale(adata, max_value=10)
    sc.tl.pca(adata, n_comps=n_pcs, svd_solver="arpack")
    sc.pp.neighbors(adata, n_pcs=n_pcs)
    sc.tl.umap(adata)
    return adata


def cluster(adata, resolution=0.8):
    """Leiden 聚类"""
    sc.tl.leiden(adata, resolution=resolution, key_added="cluster")
    n_clusters = adata.obs["cluster"].nunique()
    print(f"✅ 聚类完成: {n_clusters} 个类群")
    return adata


def annotate(adata, species="human"):
    """基于 marker 基因自动注释细胞类型"""
    # 内置 marker 基因库
    marker_dict = {
        "human": {
            "T细胞": ["CD3D", "CD3E", "CD3G"],
            "CD8+ T细胞": ["CD8A", "CD8B", "GZMK"],
            "CD4+ T细胞": ["CD4"],
            "NK细胞": ["NKG7", "GNLY", "KLRD1"],
            "B细胞": ["CD79A", "CD79B", "MS4A1"],
            "巨噬细胞": ["CD68", "CD14", "CSF1R"],
            "单核细胞": ["CD14", "FCGR3A", "S100A8"],
            "树突状细胞": ["CLEC4C", "FCER1A", "CLEC10A"],
            "上皮细胞": ["EPCAM", "KRT8", "KRT18"],
            "成纤维细胞": ["COL1A1", "COL1A2", "DCN"],
        },
        "mouse": {
            "T细胞": ["Cd3d", "Cd3e", "Cd3g"],
            "CD8+ T细胞": ["Cd8a", "Cd8b1", "Gzmk"],
            "CD4+ T细胞": ["Cd4"],
            "NK细胞": ["Nkg7", "Gzmb", "Klrd1"],
            "B细胞": ["Cd79a", "Cd79b", "Ms4a1"],
            "巨噬细胞": ["Cd68", "Adgre1", "Csf1r"],
            "单核细胞": ["Ly6c2", "Ccr2", "Cd14"],
            "树突状细胞": ["Siglech", "Itgax", "Flt3"],
            "上皮细胞": ["Epcam", "Krt8", "Krt18"],
            "成纤维细胞": ["Col1a1", "Col1a2", "Dcn"],
        },
    }

    markers = marker_dict.get(species, marker_dict["human"])
    sc.tl.rank_genes_groups(adata, "cluster", method="wilcoxon")

    # 对每个 cluster 打分，选最高分的细胞类型
    annotations = {}
    for cluster_id in sorted(adata.obs["cluster"].unique(), key=int):
        scores = {}
        for cell_type, genes in markers.items():
            overlap = sum(g in adata.var_names for g in genes)
            if overlap > 0:
                expr = adata[:, [g for g in genes if g in adata.var_names]].X.mean(axis=1)
                mask = adata.obs["cluster"] == cluster_id
                scores[cell_type] = float(np.mean(expr[mask])) if mask.sum() > 0 else 0
        best = max(scores, key=scores.get) if scores else "未知"
        annotations[cluster_id] = best

    # 获取每个 cluster 的 top marker 基因
    result = sc.get.rank_genes_groups_df(adata, group=None)
    top_markers = result.groupby("group").head(3)

    adata.obs["cell_type"] = adata.obs["cluster"].map(annotations)

    # 保存注释表
    annot_df = pd.DataFrame([
        {"cluster": c, "cell_type": t, "n_cells": int((adata.obs["cluster"] == c).sum())}
        for c, t in annotations.items()
    ])
    annot_df.to_csv("annotation_table.csv", index=False)

    for _, row in annot_df.iterrows():
        top = ", ".join(top_markers[top_markers["group"] == row["cluster"]]["names"].head(3).tolist())
        print(f"  {row['cluster']}: {row['cell_type']} ({row['n_cells']} 细胞) — {top}")

    print(f"✅ 注释完成: {len(annotations)} 个类群")
    return adata


def differential_expression(adata, groupby="cell_type", output_dir="."):
    """差异表达分析"""
    if groupby not in adata.obs.columns:
        return adata

    cell_types = sorted(adata.obs[groupby].unique())
    all_degs = []

    for ct in cell_types:
        adata.obs["is_ct"] = (adata.obs[groupby] == ct).astype(int)
        if adata.obs["is_ct"].sum() < 10 or (1 - adata.obs["is_ct"]).sum() < 10:
            continue
        sc.tl.rank_genes_groups(adata, "is_ct", method="wilcoxon")
        degs = sc.get.rank_genes_groups_df(adata, group="1")
        degs["cell_type"] = ct
        all_degs.append(degs)

    if all_degs:
        deg_df = pd.concat(all_degs, ignore_index=True)
        deg_df.to_csv(os.path.join(output_dir, "differential_expression.csv"), index=False)
        print(f"✅ 差异分析完成: {len(deg_df)} 个差异基因")

    return adata


def generate_report(adata, output_dir="."):
    """生成分析报告"""
    report = {
        "n_cells": int(adata.n_obs),
        "n_genes": int(adata.n_vars),
        "n_clusters": int(adata.obs["cluster"].nunique()) if "cluster" in adata.obs else 0,
        "cell_types": adata.obs["cell_type"].value_counts().to_dict() if "cell_type" in adata.obs else {},
        "samples": adata.obs["sample_id"].nunique() if "sample_id" in adata.obs else 1,
    }
    with open(os.path.join(output_dir, "analysis_report.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"✅ 报告已保存: analysis_report.json")


def main():
    parser = argparse.ArgumentParser(description="一键式单细胞分析管道")
    parser.add_argument("--input", required=True, help="输入 .h5ad 文件")
    parser.add_argument("--output-dir", default="./sc_results", help="输出目录")
    parser.add_argument("--species", default="human", choices=["human", "mouse"])
    parser.add_argument("--resolution", type=float, default=0.8)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    os.chdir(args.output_dir)

    print(f"📂 加载数据: {args.input}")
    adata = sc.read_h5ad(args.input)
    print(f"   {adata.n_obs} 细胞, {adata.n_vars} 基因")

    # Step 1: QC
    adata = qc_and_filter(adata)

    # Step 2: Normalize + Reduce
    adata = normalize_and_reduce(adata)

    # Step 3: Cluster
    adata = cluster(adata, resolution=args.resolution)

    # Step 4: Annotate
    adata = annotate(adata, species=args.species)

    # Step 5: Save
    out_path = os.path.join(args.output_dir, "processed.h5ad")
    adata.write(out_path)

    # Step 6: Diff expression + Report
    differential_expression(adata, output_dir=args.output_dir)
    generate_report(adata, output_dir=args.output_dir)

    print(f"\n✅ 管道完成! 输出: {args.output_dir}/processed.h5ad")
    return 0


if __name__ == "__main__":
    sys.exit(main())
