#!/usr/bin/env python3
"""
单细胞RNA-seq数据质量控制脚本 (Agent-Friendly)

对原始 .h5ad 文件执行自动化质量控制:
  - 过滤条件: min_genes=200, min_cells=3, pct_mt<20
  - 计算指标: n_genes_by_counts, total_counts, pct_counts_mt
  - 输出: qc.h5ad + qc_metrics.json

用法:
    python agent_qc.py --input raw.h5ad --output qc.h5ad
    python agent_qc.py --input raw.h5ad --output qc.h5ad --min-genes 500 --max-mt 10
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def run_qc(
    input_path: str,
    output_path: str,
    min_genes: int = 200,
    min_cells: int = 3,
    max_mt: float = 20.0,
) -> None:
    """执行单细胞 QC 流程，保存过滤后的数据及指标 JSON。"""
    import scanpy as sc

    # ---------- 1. 加载数据 ----------
    print(f"📂 正在加载数据: {input_path}")
    adata = _load_adata(input_path)
    n_before_cells = adata.n_obs
    n_before_genes = adata.n_vars
    print(f"   原始数据: {n_before_cells} 个细胞 × {n_before_genes} 个基因")

    # ---------- 2. 标记线粒体基因 ----------
    adata.var["mt"] = adata.var_names.str.startswith(("MT-", "mt-", "Mt-"))

    # ---------- 3. 计算 QC 指标 ----------
    sc.pp.calculate_qc_metrics(
        adata, qc_vars=["mt"], percent_top=None, log1p=False, inplace=True
    )

    # ---------- 4. 过滤 ----------
    sc.pp.filter_cells(adata, min_genes=min_genes)
    sc.pp.filter_genes(adata, min_cells=min_cells)
    if "pct_counts_mt" in adata.obs:
        adata = adata[adata.obs["pct_counts_mt"] < max_mt, :].copy()

    n_after_cells = adata.n_obs
    n_after_genes = adata.n_vars
    pct_retained = (n_after_cells / n_before_cells * 100) if n_before_cells else 0.0

    # ---------- 5. 保存 ----------
    print(f"💾 正在保存结果: {output_path}")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    adata.write_h5ad(output_path)

    # ---------- 6. 写指标 JSON ----------
    metrics_path = os.path.splitext(output_path)[0] + "_metrics.json"
    metrics = {
        "before": int(n_before_cells),
        "after": int(n_after_cells),
        "pct_retained": round(pct_retained, 2),
        "filter_params": {
            "min_genes": min_genes,
            "min_cells": min_cells,
            "max_mt_pct": max_mt,
        },
    }
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print(f"📊 指标已保存: {metrics_path}")

    # ---------- 7. 摘要 ----------
    print(f"✅ QC完成: {n_after_cells} 个细胞通过质控 ({pct_retained:.1f}% 保留)")


def _load_adata(path: str):
    """根据文件扩展名 / 类型加载 AnnData。"""
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
    raise SystemExit(f"❌ 不支持的文件格式: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="单细胞 RNA-seq 自动质量控制 (Agent-Friendly)"
    )
    parser.add_argument(
        "--input", required=True, help="输入文件路径 (.h5ad / .h5 / .csv / 10X 目录)"
    )
    parser.add_argument(
        "--output", default="qc.h5ad", help="输出文件路径 (默认: qc.h5ad)"
    )
    parser.add_argument(
        "--min-genes", type=int, default=200, help="每个细胞最少基因数 (默认: 200)"
    )
    parser.add_argument(
        "--min-cells", type=int, default=3, help="每个基因最少细胞数 (默认: 3)"
    )
    parser.add_argument(
        "--max-mt",
        type=float,
        default=20.0,
        help="线粒体基因最大百分比 (默认: 20)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ 输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(2)

    try:
        run_qc(
            input_path=args.input,
            output_path=args.output,
            min_genes=args.min_genes,
            min_cells=args.min_cells,
            max_mt=args.max_mt,
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
