#!/usr/bin/env python3
"""
单细胞 Leiden 聚类脚本 (Agent-Friendly)

接收已质控的 .h5ad 文件，执行标准聚类流程:
  normalize_total → log1p → highly_variable_genes → PCA → neighbors → UMAP → leiden

参数:
  n_top_genes = 2000, n_pcs = 30, resolution = 0.8

用法:
    python agent_cluster.py --input qc.h5ad --output clustered.h5ad
    python agent_cluster.py --input qc.h5ad --output clustered.h5ad --resolution 0.5
"""

from __future__ import annotations

import argparse
import os
import sys


def run_clustering(
    input_path: str,
    output_path: str,
    n_top_genes: int = 2000,
    n_pcs: int = 30,
    n_neighbors: int = 15,
    resolution: float = 0.8,
) -> None:
    """执行标准化 → HVG → PCA → 邻居图 → UMAP → Leiden 聚类。"""
    import scanpy as sc

    # sc.settings.verbosity = 1

    # ---------- 1. 加载 ----------
    print(f"📂 正在加载数据: {input_path}")
    adata = sc.read_h5ad(input_path)
    print(f"   输入数据: {adata.n_obs} 个细胞 × {adata.n_vars} 个基因")

    # ---------- 2. 标准化 & log1p ----------
    print("🔧 正在标准化 (normalize_total → log1p) ...")
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)
    adata.raw = adata

    # ---------- 3. 高变基因 ----------
    print(f"🧬 正在筛选高变基因 (top {n_top_genes}) ...")
    sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, subset=False)
    n_hvg = int(adata.var["highly_variable"].sum())
    adata = adata[:, adata.var["highly_variable"]].copy()
    print(f"   保留 {n_hvg} 个高变基因")

    # ---------- 4. PCA ----------
    print(f"📐 正在运行 PCA (n_pcs={n_pcs}) ...")
    sc.pp.scale(adata, max_value=10)
    sc.tl.pca(adata, svd_solver="arpack", n_comps=n_pcs)

    # ---------- 5. 邻居图 ----------
    print(f"🔗 正在构建邻居图 (n_neighbors={n_neighbors}, n_pcs={n_pcs}) ...")
    sc.pp.neighbors(adata, n_neighbors=n_neighbors, n_pcs=n_pcs)

    # ---------- 6. UMAP ----------
    print("🗺️  正在计算 UMAP ...")
    sc.tl.umap(adata)

    # ---------- 7. Leiden 聚类 ----------
    print(f"🧩 正在运行 Leiden 聚类 (resolution={resolution}) ...")
    sc.tl.leiden(adata, resolution=resolution, key_added="leiden")

    n_clusters = int(adata.obs["leiden"].nunique())
    print(f"   识别出 {n_clusters} 个类群")

    # ---------- 8. 保存 ----------
    print(f"💾 正在保存结果: {output_path}")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    adata.write_h5ad(output_path)

    # ---------- 9. 摘要 ----------
    print(f"✅ 聚类完成: {adata.n_obs} 个细胞, {n_clusters} 个类群")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="单细胞 Leiden 聚类 (Agent-Friendly)"
    )
    parser.add_argument(
        "--input", required=True, help="输入文件路径 (已质控的 .h5ad)"
    )
    parser.add_argument(
        "--output",
        default="clustered.h5ad",
        help="输出文件路径 (默认: clustered.h5ad)",
    )
    parser.add_argument(
        "--n-top-genes",
        type=int,
        default=2000,
        help="高变基因数量 (默认: 2000)",
    )
    parser.add_argument(
        "--n-pcs",
        type=int,
        default=30,
        help="PCA 主成分数 (默认: 30)",
    )
    parser.add_argument(
        "--n-neighbors",
        type=int,
        default=15,
        help="邻居数量 (默认: 15)",
    )
    parser.add_argument(
        "--resolution",
        type=float,
        default=0.8,
        help="Leiden 聚类分辨率 (默认: 0.8)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ 输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(2)

    try:
        run_clustering(
            input_path=args.input,
            output_path=args.output,
            n_top_genes=args.n_top_genes,
            n_pcs=args.n_pcs,
            n_neighbors=args.n_neighbors,
            resolution=args.resolution,
        )
    except ImportError as e:
        print(f"❌ 缺少依赖: {e}", file=sys.stderr)
        print("   请安装: pip install 'scanpy>=1.10' anndata pandas", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ 运行错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
