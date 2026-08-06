#!/usr/bin/env python3
"""配体-受体 (Ligand-Receptor) 互作分析脚本

使用 liana-py 对单细胞 RNA-seq 数据进行细胞间通讯推断。
输入: .h5ad 文件，需包含 .obs['cell_type'] 细胞类型注释。
输出: liana_results.csv，包含 source, target, ligand, receptor, magnitude, specificity 列。

用法:
    python lr_analysis.py --input data.h5ad --output liana_results.csv
    python lr_analysis.py --input data.h5ad --output results.csv --groupby cell_type --resource consensus
"""

import argparse
import logging
import sys
from pathlib import Path

import liana as li
import pandas as pd
import scanpy as sc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(
        description="配体-受体互作分析 — 基于 liana-py",
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        type=Path,
        help="输入 .h5ad 文件路径",
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        type=Path,
        help="输出 CSV 文件路径",
    )
    parser.add_argument(
        "--groupby",
        default="cell_type",
        help=".obs 中用于分组的列名 (默认: cell_type)",
    )
    parser.add_argument(
        "--resource",
        default="consensus",
        choices=["consensus", "cellphonedb", "cellchatdb", "omnipathdb"],
        help="配体-受体资源数据库 (默认: consensus)",
    )
    parser.add_argument(
        "--expr-prop",
        type=float,
        default=0.1,
        help="基因在细胞类型中的最低表达比例 (默认: 0.1)",
    )
    parser.add_argument(
        "--min-cells",
        type=int,
        default=5,
        help="细胞类型最少细胞数，低于此值的类型将被过滤 (默认: 5)",
    )
    parser.add_argument(
        "--n-perms",
        type=int,
        default=None,
        help="置换检验次数 (默认: liana 内部默认值)",
    )
    return parser.parse_args()


def validate_adata(adata, groupby):
    """验证 AnnData 对象是否包含所需信息。"""
    if groupby not in adata.obs.columns:
        available = ", ".join(adata.obs.columns.tolist())
        raise ValueError(
            f".obs 中缺少 '{groupby}' 列。可用列: {available}"
        )

    counts = adata.obs[groupby].value_counts()
    small_types = counts[counts < 1].index.tolist()
    if small_types:
        log.warning(f"以下细胞类型细胞数过少: {small_types}")

    log.info(f"细胞类型分布:\n{counts.to_string()}")
    return counts


def filter_rare_types(adata, groupby, min_cells):
    """过滤细胞数过少的细胞类型。"""
    counts = adata.obs[groupby].value_counts()
    keep = counts[counts >= min_cells].index.tolist()
    removed = counts[counts < min_cells].index.tolist()

    if removed:
        log.warning(
            f"过滤掉 {len(removed)} 个细胞数 <{min_cells} 的类型: {removed}"
        )
        adata = adata[adata.obs[groupby].isin(keep)].copy()
        log.info(f"保留 {adata.n_obs} 个细胞, {len(keep)} 个类型")

    return adata


def run_liana(adata, groupby, resource, expr_prop, n_perms):
    """运行 liana-py rank_aggregate 分析。"""
    log.info("开始运行 liana rank_aggregate ...")
    log.info(f"  分组列: {groupby}")
    log.info(f"  资源库: {resource}")
    log.info(f"  表达比例阈值: {expr_prop}")
    if n_perms:
        log.info(f"  置换次数: {n_perms}")

    kwargs = {
        "adata": adata,
        "groupby": groupby,
        "resource_name": resource,
        "expr_prop": expr_prop,
        "verbose": True,
    }
    if n_perms:
        kwargs["n_perms"] = n_perms

    result = li.mt.rank_aggregate(**kwargs)
    return result


def format_output(result):
    """将 liana 输出整理为标准格式。

    Returns:
        pd.DataFrame: 包含 source, target, ligand, receptor,
                      magnitude, specificity 列的数据框。
    """
    cols_map = {
        "source": "source",
        "target": "target",
        "ligand": "ligand",
        "receptor": "receptor",
        "magnitude": "magnitude",
        "specificity": "specificity",
    }

    # rank_aggregate 返回的常见列名映射
    for col in cols_map:
        if col not in result.columns:
            # 尝试在 liana >= 1.0 的新列名中查找
            candidates = [c for c in result.columns if col in c.lower()]
            if candidates:
                cols_map[col] = candidates[0]
                log.info(f"列名映射: {col} -> {candidates[0]}")

    out = result[[cols_map[c] for c in cols_map]].copy()
    out.columns = list(cols_map.keys())

    # 按 magnitude 降序排列
    out = out.sort_values("magnitude", ascending=False).reset_index(drop=True)
    return out


def main():
    args = parse_args()

    # 1. 读取数据
    log.info(f"读取输入文件: {args.input}")
    adata = sc.read_h5ad(args.input)
    log.info(f"数据集: {adata.n_obs} 个细胞, {adata.n_vars} 个基因")

    # 2. 验证
    validate_adata(adata, args.groupby)

    # 3. 过滤稀有类型
    adata = filter_rare_types(adata, args.groupby, args.min_cells)

    if adata.n_obs == 0:
        log.error("过滤后无剩余细胞，请降低 --min-cells 阈值")
        sys.exit(1)

    # 4. 运行 LR 分析
    raw = run_liana(
        adata,
        args.groupby,
        args.resource,
        args.expr_prop,
        args.n_perms,
    )

    # 5. 格式化输出
    out = format_output(raw)

    # 6. 保存结果
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, index=False)
    log.info(f"结果已保存至: {args.output}")

    # 7. 打印摘要
    n_pairs = len(out)
    n_sources = out["source"].nunique()
    n_targets = out["target"].nunique()
    n_ligands = out["ligand"].nunique()
    n_receptors = out["receptor"].nunique()

    print(f"\n{'='*50}")
    print(f"✅ 配体-受体分析完成: {n_pairs} 对显著互作")
    print(f"{'='*50}")
    print(f"  源细胞类型: {n_sources}")
    print(f"  目标细胞类型: {n_targets}")
    print(f"  唯一配体: {n_ligands}")
    print(f"  唯一受体: {n_receptors}")
    print(f"{'='*50}")

    # 打印 top 10 互作对
    print(f"\n🔝 互作强度 Top 10:")
    print(out.head(10).to_string(index=False))


if __name__ == "__main__":
    main()
