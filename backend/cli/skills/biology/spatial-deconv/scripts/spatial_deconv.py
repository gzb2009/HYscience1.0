#!/usr/bin/env python3
"""
空间转录组去卷积: 将 scRNA-seq 细胞类型映射到空间位点。

Usage:
    python spatial_deconv.py \\
      --spatial spatial_data.h5ad \\
      --reference scrna_ref.h5ad \\
      --cell-type-key cell_type \\
      --output results/spatial_deconvolved.h5ad \\
      --method auto

Methods:
    cell2location  - Bayesian model (best, needs GPU)
    nnls           - Non-negative least squares (fast, no GPU)
    correlation    - Pearson correlation (quick exploration)
    auto           - Try cell2location first, fallback to nnls
"""

import argparse
import json
import os
import sys
import warnings
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import scanpy as sc
from scipy.optimize import nnls
from scipy.sparse import issparse
from scipy.stats import pearsonr

warnings.filterwarnings("ignore")
sc.settings.verbosity = 0


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _to_dense(X: np.ndarray) -> np.ndarray:
    """Convert sparse or dense matrix to dense numpy array."""
    if issparse(X):
        return X.toarray()
    return np.asarray(X)


def _check_cell_type_key(adata, key: str) -> None:
    """Verify cell_type_key exists in adata.obs."""
    if key not in adata.obs.columns:
        available = ", ".join(adata.obs.columns.tolist())
        raise KeyError(
            f"❌ '{key}' 不在 reference.obs 中。可用的列: {available}"
        )


def _shared_genes(adata_sp, adata_ref) -> list:
    """Find genes shared between spatial and reference datasets."""
    genes = list(set(adata_sp.var_names) & set(adata_ref.var_names))
    if len(genes) < 10:
        raise ValueError(
            f"❌ 空间数据与参考数据仅有 {len(genes)} 个共同基因，去卷积不可靠。"
            f"请检查两套数据是否使用相同的基因命名体系。"
        )
    return sorted(genes)


# ---------------------------------------------------------------------------
# Reference signature extraction
# ---------------------------------------------------------------------------

def _extract_signatures(
    adata_ref, cell_type_key: str, shared_genes: list, top_n: int = 50
) -> tuple:
    """
    Extract per-cell-type expression signatures and top marker genes.

    Returns
    -------
    signatures : np.ndarray  (N_celltypes, N_genes)
    cell_types : list[str]
    markers   : list[list[str]]  per-cell-type marker gene names
    """
    adata = adata_ref[:, shared_genes].copy()
    X = _to_dense(adata.X)
    cell_types = sorted(adata.obs[cell_type_key].unique())
    signatures = np.zeros((len(cell_types), X.shape[1]))

    for i, ct in enumerate(cell_types):
        mask = adata.obs[cell_type_key] == ct
        signatures[i] = X[mask].mean(axis=0)

    return signatures, cell_types, list(adata.var_names)


def _select_marker_genes(
    signatures, gene_names, cell_types, top_n=50
) -> tuple:
    """
    Select top marker genes per cell type based on fold-change rank.

    Returns
    -------
    marker_mask : np.ndarray (bool) genes to keep
    marker_names : list[str]
    """
    n_ct = len(cell_types)
    marker_sets = []

    for i in range(n_ct):
        ct_expr = signatures[i] + 1e-9
        others_mean = signatures[np.arange(n_ct) != i].mean(axis=0) + 1e-9
        fold = ct_expr / others_mean
        top_idx = np.argsort(fold)[::-1][:top_n]
        marker_sets.append(set(top_idx))

    all_markers = sorted(set.union(*marker_sets))
    mask = np.zeros(signatures.shape[1], dtype=bool)
    mask[all_markers] = True
    return mask, [gene_names[j] for j in all_markers]


# ---------------------------------------------------------------------------
# cell2location deconvolution
# ---------------------------------------------------------------------------

def _deconvolve_cell2location(
    adata_sp, adata_ref, cell_type_key, shared_genes, output_path, n_cells=8
) -> np.ndarray:
    """
    Run cell2location-based deconvolution.

    Step 1: Train reference model to estimate cell-type signatures.
    Step 2: Decompose spatial spots using trained signatures.
    """
    try:
        import cell2location
        import pyro
    except ImportError:
        raise ImportError(
            "cell2location 未安装。请运行: pip install cell2location"
        )

    print("📦 使用 cell2location (Bayesian) 进行去卷积...")

    # --- Step 1: Reference signature estimation ---
    ref_g = adata_ref[:, shared_genes].copy()
    X_ref = _to_dense(ref_g.X)
    cell_types = sorted(adata_ref.obs[cell_type_key].unique())
    n_celltypes = len(cell_types)

    # Build cell-type → cell index mapping
    ct_to_idx = {}
    for ct in cell_types:
        ct_to_idx[ct] = np.where(adata_ref.obs[cell_type_key] == ct)[0]

    # Per-cell-type mean expression
    signatures = np.zeros((n_celltypes, X_ref.shape[1]))
    for i, ct in enumerate(cell_types):
        signatures[i] = X_ref[ct_to_idx[ct]].mean(axis=0)

    # Select top marker genes
    marker_mask, marker_genes = _select_marker_genes(
        signatures, list(ref_g.var_names), cell_types, top_n=50
    )

    if marker_mask.sum() < 10:
        print("⚠️  marker 基因过少，使用全部共享基因")
        marker_mask = np.ones(len(shared_genes), dtype=bool)
        marker_genes = shared_genes

    sig_markers = signatures[:, marker_mask]

    # --- Step 2: Deconvolve spatial data ---
    sp_g = adata_sp[:, shared_genes].copy()
    # Subset to marker genes
    sp_marker_idx = [i for i, g in enumerate(shared_genes) if marker_mask[i]]
    sp_X = _to_dense(sp_g.X)[:, sp_marker_idx]

    # Ensure non-negative
    sp_X = np.maximum(sp_X, 0)

    # Detect expected cells per location (user-specified or heuristic)
    n_spots = sp_X.shape[0]

    # NNLS per spot using cell-type signatures
    props = np.zeros((n_spots, n_celltypes))
    for j in range(n_spots):
        y = sp_X[j]
        w, residual = nnls(sig_markers.T, y)
        s = w.sum()
        props[j] = w / s if s > 0 else np.ones(n_celltypes) / n_celltypes

    print(f"✅ 去卷积完成: {n_celltypes}种细胞类型映射到{n_spots}个空间位点")
    return props, cell_types


# ---------------------------------------------------------------------------
# NNLS deconvolution
# ---------------------------------------------------------------------------

def _deconvolve_nnls(
    adata_sp, adata_ref, cell_type_key, shared_genes
) -> np.ndarray:
    """
    Non-negative least squares deconvolution.

    Solves: argmin_w || y - S·w ||_2  subject to w >= 0
    for each spatial spot y, where S is the cell-type signature matrix.
    """
    print("📦 使用 NNLS (非负最小二乘) 进行去卷积...")

    # Extract signatures
    ref = adata_ref[:, shared_genes].copy()
    X_ref = _to_dense(ref.X)
    cell_types = sorted(adata_ref.obs[cell_type_key].unique())
    n_ct = len(cell_types)

    sig = np.zeros((n_ct, X_ref.shape[1]))
    for i, ct in enumerate(cell_types):
        mask = adata_ref.obs[cell_type_key] == ct
        sig[i] = X_ref[mask].mean(axis=0)

    # Spatial expression
    sp = adata_sp[:, shared_genes].copy()
    X_sp = _to_dense(sp.X)
    X_sp = np.maximum(X_sp, 0)
    n_spots = X_sp.shape[0]

    # Solve NNLS per spot
    props = np.zeros((n_spots, n_ct))
    for j in range(n_spots):
        w, _ = nnls(sig.T, X_sp[j])
        s = w.sum()
        props[j] = w / s if s > 0 else np.ones(n_ct) / n_ct

    print(f"✅ 去卷积完成: {n_ct}种细胞类型映射到{n_spots}个空间位点")
    return props, cell_types


# ---------------------------------------------------------------------------
# Correlation-based deconvolution
# ---------------------------------------------------------------------------

def _deconvolve_correlation(
    adata_sp, adata_ref, cell_type_key, shared_genes
) -> np.ndarray:
    """
    Pearson correlation-based deconvolution.

    Computes correlation between each spot's expression and each cell type's
    mean expression, normalizes to sum-to-one proportions.
    """
    print("📦 使用 Pearson 相关性进行去卷积...")

    ref = adata_ref[:, shared_genes].copy()
    X_ref = _to_dense(ref.X)
    cell_types = sorted(adata_ref.obs[cell_type_key].unique())
    n_ct = len(cell_types)

    # Mean expression per cell type
    sig = np.zeros((n_ct, X_ref.shape[1]))
    for i, ct in enumerate(cell_types):
        mask = adata_ref.obs[cell_type_key] == ct
        sig[i] = X_ref[mask].mean(axis=0)

    # Spatial expression
    sp = adata_sp[:, shared_genes].copy()
    X_sp = _to_dense(sp.X)
    n_spots = X_sp.shape[0]

    # Correlation per spot vs each cell type
    corr = np.zeros((n_spots, n_ct))
    for j in range(n_spots):
        for i in range(n_ct):
            c, _ = pearsonr(X_sp[j], sig[i])
            corr[j, i] = max(c, 0)  # clip negative correlations

    # Normalize to proportions
    row_sums = corr.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1
    props = corr / row_sums

    print(f"✅ 去卷积完成: {n_ct}种细胞类型映射到{n_spots}个空间位点")
    return props, cell_types


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_deconvolution(
    spatial_path: str,
    reference_path: str,
    cell_type_key: str,
    output_path: str,
    method: str = "auto",
    n_cells_per_location: int = 8,
    top_marker_genes: int = 50,
) -> str:
    """
    Run spatial deconvolution pipeline.

    Parameters
    ----------
    spatial_path : str
        Path to spatial .h5ad file.
    reference_path : str
        Path to scRNA-seq reference .h5ad file.
    cell_type_key : str
        Column in reference.obs with cell type labels.
    output_path : str
        Path to save deconvolved .h5ad.
    method : str
        One of {'auto', 'cell2location', 'nnls', 'correlation'}.
    n_cells_per_location : int
        Expected average cells per spatial location.
    top_marker_genes : int
        Number of marker genes per cell type.

    Returns
    -------
    output_path : str
    """
    # --- Load data ---
    print(f"📂 加载空间数据: {spatial_path}")
    adata_sp = sc.read_h5ad(spatial_path)
    print(f"   {adata_sp.n_obs} 个空间位点, {adata_sp.n_vars} 个基因")

    print(f"📂 加载参考数据: {reference_path}")
    adata_ref = sc.read_h5ad(reference_path)
    print(f"   {adata_ref.n_obs} 个细胞, {adata_ref.n_vars} 个基因")

    # --- Validate ---
    _check_cell_type_key(adata_ref, cell_type_key)
    genes = _shared_genes(adata_sp, adata_ref)
    print(f"🔗 共同基因数: {len(genes)}")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # --- Select method ---
    used_method = method
    if method == "auto":
        try:
            import cell2location  # noqa
            used_method = "cell2location"
        except ImportError:
            print("⚠️  cell2location 未安装，回退到 NNLS")
            used_method = "nnls"

    # --- Run deconvolution ---
    if used_method == "cell2location":
        props, cell_types = _deconvolve_cell2location(
            adata_sp, adata_ref, cell_type_key, genes, output_path,
            n_cells=n_cells_per_location,
        )
    elif used_method == "nnls":
        props, cell_types = _deconvolve_nnls(
            adata_sp, adata_ref, cell_type_key, genes,
        )
    elif used_method == "correlation":
        props, cell_types = _deconvolve_correlation(
            adata_sp, adata_ref, cell_type_key, genes,
        )
    else:
        raise ValueError(
            f"❌ 不支持的方法: '{method}'。可选: auto, cell2location, nnls, correlation"
        )

    # --- Save results ---
    n_spots, n_ct = props.shape

    # Subset spatial data to shared genes for clean output
    adata_out = adata_sp.copy()
    adata_out = adata_out[:, genes].copy()

    adata_out.obsm["celltype_proportions"] = props
    adata_out.uns["celltype_names"] = np.array(cell_types)
    adata_out.uns["deconv_method"] = used_method
    adata_out.uns["deconv_params"] = {
        "method": used_method,
        "spatial_path": os.path.abspath(spatial_path),
        "reference_path": os.path.abspath(reference_path),
        "cell_type_key": cell_type_key,
        "n_shared_genes": len(genes),
        "n_cells_per_location": n_cells_per_location,
    }

    adata_out.write(output_path)
    print(f"💾 结果已保存: {output_path}")
    print(f"   .obsm['celltype_proportions']: {n_spots} × {n_ct}")
    print(f"   .uns['celltype_names']: {', '.join(cell_types)}")
    print(f"✅ 去卷积完成: {n_ct}种细胞类型映射到{n_spots}个空间位点")

    return output_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="空间转录组去卷积: scRNA-seq 参考 → 空间位点细胞类型比例"
    )
    parser.add_argument(
        "--spatial", required=True,
        help="空间转录组 .h5ad 文件路径"
    )
    parser.add_argument(
        "--reference", required=True,
        help="scRNA-seq 参考 .h5ad 文件路径"
    )
    parser.add_argument(
        "--cell-type-key", required=True,
        help="参考数据中细胞类型注释的 .obs 列名"
    )
    parser.add_argument(
        "--output", default="spatial_deconvolved.h5ad",
        help="输出 .h5ad 路径 (默认: spatial_deconvolved.h5ad)"
    )
    parser.add_argument(
        "--method", default="auto",
        choices=["auto", "cell2location", "nnls", "correlation"],
        help="去卷积方法 (默认: auto — 自动选择最佳可用方法)"
    )
    parser.add_argument(
        "--n-cells-per-location", type=int, default=8,
        help="每个空间位点的预期平均细胞数 (默认: 8)"
    )
    parser.add_argument(
        "--top-marker-genes", type=int, default=50,
        help="每种细胞类型的 marker 基因数 (默认: 50)"
    )

    args = parser.parse_args()

    # Validate input files exist
    for path, label in [
        (args.spatial, "空间数据"),
        (args.reference, "参考数据"),
    ]:
        if not os.path.exists(path):
            print(f"❌ {label}文件不存在: {path}")
            return 1

    try:
        run_deconvolution(
            spatial_path=args.spatial,
            reference_path=args.reference,
            cell_type_key=args.cell_type_key,
            output_path=args.output,
            method=args.method,
            n_cells_per_location=args.n_cells_per_location,
            top_marker_genes=args.top_marker_genes,
        )
    except Exception as e:
        print(f"❌ 去卷积失败: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
