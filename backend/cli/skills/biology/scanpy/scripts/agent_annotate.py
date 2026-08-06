#!/usr/bin/env python3
"""
单细胞自动注释脚本 (Agent-Friendly)

接收已聚类的 .h5ad 文件，查找每个类群的标记基因 (Wilcoxon 检验)，
根据内置的免疫/基质细胞标记基因知识库自动分配细胞类型。

支持 --species human / mouse 切换基因名大小写约定。

输出:
  - annotated.h5ad   (含 .obs['cell_type'] 和 .obs['marker_genes'])
  - annotation_table.csv (含 cluster, marker_genes, cell_type 列)

用法:
    python agent_annotate.py --input clustered.h5ad --output annotated.h5ad
    python agent_annotate.py --input clustered.h5ad --output annotated.h5ad --species mouse
"""

from __future__ import annotations

import argparse
import os
import sys

# ---------------------------------------------------------------------------
# 内置标记基因知识库 (基因符号 → 细胞类型)
# 基于 Human Primary Cell Atlas (HPCA) 和 PBMC 标准标记
# ---------------------------------------------------------------------------
_MARKER_TO_CELLTYPE: dict[str, str] = {
    # ── T 细胞 ──
    "CD3D": "T细胞", "CD3E": "T细胞", "CD3G": "T细胞",
    "CD4": "CD4+ T细胞", "CD8A": "CD8+ T细胞", "CD8B": "CD8+ T细胞",
    "FOXP3": "调节性T细胞", "IL2RA": "调节性T细胞",
    "IL7R": "CD4+ 记忆T细胞", "CCR7": "初始T细胞",
    # ── B 细胞 ──
    "MS4A1": "B细胞", "CD19": "B细胞",
    "CD79A": "B细胞", "CD79B": "B细胞", "PAX5": "B细胞",
    "MZB1": "浆细胞", "SDC1": "浆细胞", "JCHAIN": "浆细胞",
    # ── NK 细胞 ──
    "NKG7": "NK细胞", "GNLY": "NK细胞",
    "KLRD1": "NK细胞", "KLRF1": "NK细胞", "NCAM1": "NK细胞",
    # ── 单核/巨噬 ──
    "CD14": "单核细胞", "LYZ": "单核/巨噬细胞",
    "S100A8": "单核细胞", "S100A9": "单核细胞",
    "FCGR3A": "非经典单核细胞",
    "CSF1R": "巨噬细胞", "CD68": "巨噬细胞",
    "C1QA": "巨噬细胞", "C1QB": "巨噬细胞",
    "IL1B": "M1巨噬细胞", "TNF": "M1巨噬细胞",
    "CD163": "M2巨噬细胞", "MRC1": "M2巨噬细胞",
    # ── 树突状细胞 ──
    "FCER1A": "树突状细胞", "CST3": "树突状细胞", "CLEC10A": "树突状细胞",
    "CLEC4C": "浆细胞样树突状细胞", "LILRA4": "浆细胞样树突状细胞",
    "BATF3": "cDC1", "CLEC9A": "cDC1",
    "CD1C": "cDC2",
    # ── 造血干细胞/祖细胞 ──
    "CD34": "造血干细胞/祖细胞", "KIT": "造血干细胞/祖细胞",
    "GATA2": "造血干细胞/祖细胞",
    # ── 红细胞 ──
    "HBB": "红细胞", "HBA1": "红细胞", "HBA2": "红细胞", "GYPA": "红细胞",
    # ── 巨核细胞/血小板 ──
    "PPBP": "巨核细胞/血小板", "PF4": "巨核细胞/血小板",
    "ITGA2B": "巨核细胞/血小板", "GP9": "巨核细胞/血小板",
    # ── 肥大细胞 ──
    "TPSAB1": "肥大细胞", "CPA3": "肥大细胞",
    # ── 基质/成纤维 ──
    "COL1A1": "成纤维细胞", "COL1A2": "成纤维细胞",
    "DCN": "成纤维细胞", "LUM": "成纤维细胞",
    "ACTA2": "肌成纤维细胞", "TAGLN": "肌成纤维细胞",
    # ── 内皮 ──
    "PECAM1": "内皮细胞", "CDH5": "内皮细胞",
    "VWF": "内皮细胞", "ENG": "内皮细胞", "CLDN5": "内皮细胞",
    # ── 上皮 ──
    "EPCAM": "上皮细胞",
    "KRT5": "基底上皮细胞", "KRT14": "基底上皮细胞",
    "KRT8": "管腔上皮细胞", "KRT18": "管腔上皮细胞", "KRT19": "管腔上皮细胞",
    # ── 增殖细胞 ──
    "MKI67": "增殖细胞", "TOP2A": "增殖细胞",
    "PCNA": "增殖细胞", "STMN1": "增殖细胞", "TYMS": "增殖细胞",
}

# mouse → human 等价映射 (仅用于优先匹配时的大写转换)
_MOUSE_TO_HUMAN: dict[str, str] = {
    "Cd3d": "CD3D", "Cd3e": "CD3E", "Cd3g": "CD3G",
    "Cd4": "CD4", "Cd8a": "CD8A", "Cd8b1": "CD8B",
    "Foxp3": "FOXP3", "Il2ra": "IL2RA",
    "Nkg7": "NKG7", "Gzmb": "GZMB", "Klrd1": "KLRD1",
    "Cd79a": "CD79A", "Cd79b": "CD79B", "Ms4a1": "MS4A1",
    "Mzb1": "MZB1", "Sdc1": "SDC1",
    "Cd14": "CD14", "Ly6c2": "LY6C2", "Ccr2": "CCR2",
    "Cd68": "CD68", "Adgre1": "ADGRE1", "Csf1r": "CSF1R",
    "Itgax": "ITGAX", "Siglech": "SIGLECH", "Flt3": "FLT3",
    "Epcam": "EPCAM", "Krt5": "KRT5", "Krt8": "KRT8",
    "Krt14": "KRT14", "Krt18": "KRT18", "Krt19": "KRT19",
    "Col1a1": "COL1A1", "Col1a2": "COL1A2", "Dcn": "DCN",
    "Pecam1": "PECAM1", "Cdh5": "CDH5", "Vwf": "VWF",
    "Kit": "KIT", "Tpsab1": "TPSAB1",
}


def _resolve_marker_map(species: str) -> dict[str, str]:
    """返回当前物种适用的 基因→细胞类型 映射。"""
    if species == "mouse":
        # mouse: 将 mouse 基因名转换成大写版本再查表
        merged = dict(_MARKER_TO_CELLTYPE)
        for mouse_gene, human_gene in _MOUSE_TO_HUMAN.items():
            ct = _MARKER_TO_CELLTYPE.get(human_gene)
            if ct and mouse_gene not in merged:
                merged[mouse_gene] = ct
        return merged
    return dict(_MARKER_TO_CELLTYPE)


def _infer_cell_type(top_genes: list[str], marker_map: dict[str, str]) -> str:
    """根据 top 标记基因推断细胞类型。

    策略:
      1. 遍历 top 基因，统计每个细胞类型的命中次数。
      2. 选命中次数最多的；平局时优先更特异的亚型。
      3. 完全无法匹配时，用 top1 基因名 + '(未分类)'。
    """
    hits: dict[str, int] = {}
    for gene in top_genes:
        # 尝试多种匹配方式
        ct = (
            marker_map.get(gene)
            or marker_map.get(gene.upper())
            or marker_map.get(gene.capitalize())
        )
        if ct:
            hits[ct] = hits.get(ct, 0) + 1

    if not hits:
        top1 = top_genes[0] if top_genes else "未知"
        return f"{top1}(未分类)"

    best = max(hits, key=lambda k: (hits[k], -_category_rank(k)))
    return best


def _category_rank(cell_type: str) -> int:
    """亚型排名 (越小越特异)，用于平局时打破僵局。"""
    specific = {
        "CD4+ T细胞": 1, "CD8+ T细胞": 1, "调节性T细胞": 1,
        "CD4+ 记忆T细胞": 1, "初始T细胞": 1,
        "浆细胞": 2,
        "cDC1": 3, "cDC2": 3, "浆细胞样树突状细胞": 3,
        "非经典单核细胞": 4, "M1巨噬细胞": 4, "M2巨噬细胞": 4,
        "肌成纤维细胞": 5,
        "基底上皮细胞": 6, "管腔上皮细胞": 6,
        "造血干细胞/祖细胞": 7,
        "巨核细胞/血小板": 8,
        "增殖细胞": 9,
    }
    for key, rank in specific.items():
        if key in cell_type:
            return rank
    return 100


def run_annotation(
    input_path: str,
    output_path: str,
    groupby: str = "leiden",
    species: str = "human",
    n_markers: int = 5,
) -> None:
    """查找每个类群的标记基因并自动注释细胞类型。"""
    import scanpy as sc
    import pandas as pd

    # ── 1. 加载 ──
    print(f"📂 正在加载数据: {input_path}")
    adata = sc.read_h5ad(input_path)
    print(f"   输入数据: {adata.n_obs} 个细胞 × {adata.n_vars} 个基因 (species={species})")

    if groupby not in adata.obs.columns:
        print(f"❌ .obs 中找不到分组列 '{groupby}'", file=sys.stderr)
        print(f"   可用列: {list(adata.obs.columns)}", file=sys.stderr)
        sys.exit(2)

    clusters = sorted(
        adata.obs[groupby].unique(),
        key=lambda x: (x.isdigit(), int(x) if x.isdigit() else str(x)),
    )
    n_clusters = len(clusters)
    marker_map = _resolve_marker_map(species)

    if n_clusters < 2:
        print(f"⚠️  只有 {n_clusters} 个类群，无法进行差异表达分析，跳过")
        # 即使只有 1 个类群，也尝试用表达量最高的基因标注
        marker_table: list[dict] = []
        for c in clusters:
            mask = adata.obs[groupby] == c
            sub = adata[mask]
            # 取平均表达量 top 基因
            if hasattr(sub.X, "toarray"):
                mean_expr = sub.X.toarray().mean(axis=0)
            else:
                mean_expr = sub.X.mean(axis=0)
            top_idx = mean_expr.argsort()[::-1][:n_markers]
            top_genes = [adata.var_names[i] for i in top_idx]
            top_str = ",".join(str(g) for g in top_genes)
            cell_type = _infer_cell_type(top_genes, marker_map)
            adata.obs.loc[adata.obs[groupby] == c, "cell_type"] = cell_type
            adata.obs.loc[adata.obs[groupby] == c, "marker_genes"] = top_str
            marker_table.append(
                {"cluster": str(c), "marker_genes": top_str, "cell_type": cell_type}
            )
    else:
        # ── 2. 差异表达分析 ──
        print(f"🔬 正在查找标记基因 (Wilcoxon, {n_clusters} 个类群) ...")
        sc.tl.rank_genes_groups(
            adata, groupby=groupby, method="wilcoxon",
        )

        # ── 3. 提取 top 标记基因并自动注释 ──
        marker_table = []
        for cluster_id in clusters:
            try:
                df = sc.get.rank_genes_groups_df(adata, group=str(cluster_id))
            except (KeyError, ValueError):
                df = pd.DataFrame(columns=["names"])

            top_genes = df["names"].head(n_markers).tolist() if "names" in df.columns else []
            top_str = ",".join(str(g) for g in top_genes)
            cell_type = _infer_cell_type(top_genes, marker_map)

            marker_table.append({
                "cluster": str(cluster_id),
                "marker_genes": top_str,
                "cell_type": cell_type,
            })
            print(f"   Cluster {cluster_id}: {cell_type}  ←  {top_str}")

        # ── 4. 写入 .obs ──
        cluster_to_type = {r["cluster"]: r["cell_type"] for r in marker_table}
        cluster_to_markers = {r["cluster"]: r["marker_genes"] for r in marker_table}
        adata.obs["cell_type"] = adata.obs[groupby].astype(str).map(cluster_to_type)
        adata.obs["marker_genes"] = adata.obs[groupby].astype(str).map(cluster_to_markers)

    # ── 5. 保存 .h5ad ──
    print(f"💾 正在保存结果: {output_path}")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    adata.write_h5ad(output_path)

    # ── 6. 保存 annotation_table.csv ──
    import pandas as pd

    csv_path = os.path.splitext(output_path)[0] + "_annotation_table.csv"
    df_out = pd.DataFrame(marker_table, columns=["cluster", "marker_genes", "cell_type"])
    # 添加 n_cells 列帮助下游判断
    n_cells_map = adata.obs[groupby].value_counts().to_dict()
    df_out["n_cells"] = df_out["cluster"].map(lambda c: int(n_cells_map.get(c, 0)))
    df_out.to_csv(csv_path, index=False, encoding="utf-8-sig")
    print(f"📊 注释表已保存: {csv_path}")

    # ── 7. 摘要 ──
    n_types = df_out["cell_type"].nunique()
    print(f"✅ 注释完成: {n_clusters} 个类群 → {n_types} 种细胞类型")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="单细胞自动注释 (Agent-Friendly)"
    )
    parser.add_argument(
        "--input", required=True, help="输入文件路径 (已聚类的 .h5ad)"
    )
    parser.add_argument(
        "--output",
        default="annotated.h5ad",
        help="输出文件路径 (默认: annotated.h5ad)",
    )
    parser.add_argument(
        "--groupby",
        default="leiden",
        help="细胞分组的 .obs 列名 (默认: leiden)",
    )
    parser.add_argument(
        "--species",
        default="human",
        choices=["human", "mouse"],
        help="物种 (默认: human, 影响标记基因名大小写匹配)",
    )
    parser.add_argument(
        "--n-markers",
        type=int,
        default=5,
        help="每个类群展示的 top 标记基因数 (默认: 5)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ 输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(2)

    try:
        run_annotation(
            input_path=args.input,
            output_path=args.output,
            groupby=args.groupby,
            species=args.species,
            n_markers=args.n_markers,
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
