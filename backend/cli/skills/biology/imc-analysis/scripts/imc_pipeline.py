#!/usr/bin/env python3
"""
IMC/PCF Analysis Pipeline — Python rewrite of R/imcRtools workflows.

支持三种深度学习分割器，并内置 Otsu 回退:
  --segmenter stardist   StarDist (基于深度学习的核分割, 推荐)
  --segmenter cellpose   Cellpose (通用细胞分割, 支持自定义模型)
  --segmenter mesmer     DeepCell Mesmer (组织级多细胞分割)
  --segmenter otsu       Otsu + 分水岭 (无需额外安装)

Usage:
    python imc_pipeline.py --input-dir <dir> --panel <panel.csv> --output-dir <out> --segmenter stardist

如不指定 --segmenter，会列出选项供交互选择。
"""

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import ndimage
from scipy.spatial import KDTree
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

try:
    import tifffile
    HAS_TIFFFILE = True
except ImportError:
    HAS_TIFFFILE = False

try:
    from skimage import measure
    HAS_SKIMAGE = True
except ImportError:
    HAS_SKIMAGE = False


# ══════════════════════════════════════════════════════════════════════════════
# Available Segmenters
# ══════════════════════════════════════════════════════════════════════════════

SEGMENTERS = {
    "stardist": {
        "name": "StarDist",
        "description": "基于深度学习的细胞核分割，适合类圆形核，速度快、精度高。推荐用于 IMC/IF 数据。",
        "pip": "stardist",
        "import": "stardist",
    },
    "cellpose": {
        "name": "Cellpose",
        "description": "通用细胞分割，支持细胞质/细胞核，可加载自定义模型。适合不规则形态细胞。",
        "pip": "cellpose",
        "import": "cellpose",
    },
    "mesmer": {
        "name": "DeepCell Mesmer",
        "description": "组织级多细胞分割，能同时分割核和细胞质边界。适合复杂组织微环境分析。",
        "pip": "deepcell",
        "import": "deepcell",
    },
    "otsu": {
        "name": "Otsu + Watershed",
        "description": "内置阈值分割，无需额外安装，适合快速预览或作为回退方法。",
        "pip": "",
        "import": "skimage",
    },
}


def list_segmenters():
    """列出可用分割器供用户选择。"""
    print("\n请选择细胞分割方法：\n")
    for i, info in enumerate(SEGMENTERS.values(), 1):
        print(f"  [{i}] {info['name']}")
        print(f"      {info['description']}")
        install = f"pip install {info['pip']}" if info.get("pip") else "无需额外安装"
        print(f"      {install}")
        print()
    print("  [q] 退出")


def pick_segmenter(choice: str = None) -> str:
    """交互式选择或从 CLI 参数返回分割器名称。"""
    if choice and choice in SEGMENTERS:
        return choice
    if choice:
        print(f"❌ 未知分割器: '{choice}'")
        print(f"   可用: {', '.join(SEGMENTERS.keys())}")
    list_segmenters()
    keys = list(SEGMENTERS.keys())
    while True:
        sel = input(f"请输入编号 (1-{len(keys)}) 或名称 ({'/'.join(keys)}): ").strip().lower()
        if sel in ("q", "quit", ""):
            sys.exit(0)
        if sel in SEGMENTERS:
            return sel
        if sel.isdigit() and 1 <= int(sel) <= len(keys):
            return keys[int(sel) - 1]
        print(f"❌ 无效选择: '{sel}'，请重新输入")


# ══════════════════════════════════════════════════════════════════════════════
# Segmentation Backends
# ══════════════════════════════════════════════════════════════════════════════

def segment_otsu(dna_channel: np.ndarray) -> np.ndarray:
    """Otsu 阈值 + 分水岭 (fallback, 无需额外安装)。"""
    positive = dna_channel[dna_channel > 0]
    threshold = float(positive.mean()) if positive.size else 10.0
    mask = dna_channel > threshold
    dist = ndimage.distance_transform_edt(mask)
    markers, _ = ndimage.label(mask)
    from skimage.segmentation import watershed
    return watershed(-dist, markers, mask=mask).astype(np.int32)


def segment_stardist(dna_channel: np.ndarray) -> np.ndarray:
    """StarDist 核分割（2D，预训练模型）。"""
    try:
        from stardist.models import StarDist2D
        from csbdeep.utils import normalize

        model = StarDist2D.from_pretrained("2D_versatile_fluo")
        img_norm = normalize(dna_channel.astype(np.float32))
        labels, _ = model.predict_instances(img_norm, n_tiles=1)
        return labels.astype(np.int32)
    except Exception as exc:
        print(f"⚠️  StarDist 分割不可用 ({exc})，回退到 Otsu 分割...")
        return segment_otsu(dna_channel)


def segment_cellpose(dna_channel: np.ndarray, diameter: float = None) -> np.ndarray:
    """Cellpose 分割（nuclei 模型）。"""
    try:
        from cellpose import models

        model = models.Cellpose(gpu=False, model_type="nuclei")
        masks, _, _, _ = model.eval(
            dna_channel.astype(np.float32),
            diameter=diameter,
            channels=[0, 0],
        )
        return masks.astype(np.int32)
    except Exception as exc:
        print(f"⚠️  Cellpose 分割不可用 ({exc})，回退到 Otsu 分割...")
        return segment_otsu(dna_channel)


def segment_mesmer(dna_channel: np.ndarray, membrane_channels: np.ndarray = None) -> np.ndarray:
    """DeepCell Mesmer 组织级多细胞分割。"""
    try:
        from deepcell.applications import Mesmer

        app = Mesmer()
        # Mesmer expects (H, W, C) with nuclear + membrane channels.
        membrane = membrane_channels if (
            membrane_channels is not None
            and membrane_channels.ndim == 2
            and membrane_channels.shape == dna_channel.shape
        ) else dna_channel
        img_input = np.stack([dna_channel, membrane], axis=-1)[None, ...]
        labels = np.asarray(app.predict(img_input, image_mpp=0.5))
        if labels.ndim == 4:
            return labels[0, :, :, 0].astype(np.int32)
        if labels.ndim == 3:
            return labels[0].astype(np.int32)
        raise ValueError(f"Mesmer 输出 shape 不是 (1,H,W[,C]): {labels.shape}")
    except Exception as exc:
        print(f"⚠️  Mesmer 分割不可用 ({exc})，回退到 Otsu 分割...")
        return segment_otsu(dna_channel)


# ══════════════════════════════════════════════════════════════════════════════
# Data Structures
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class IMCData:
    cells: pd.DataFrame = field(default_factory=pd.DataFrame)
    samples: list = field(default_factory=list)
    coords: np.ndarray = field(default_factory=lambda: np.zeros((0, 2)))
    channel_names: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


# ══════════════════════════════════════════════════════════════════════════════
# Core Pipeline
# ══════════════════════════════════════════════════════════════════════════════

class IMCPipeline:
    """IMC 分析管道 (QC → 分割 → 定量 → 聚类 → CN → 交互)。"""

    def __init__(self, input_dir: str, panel_csv: str, output_dir: str,
                 segmenter: str = None):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.panel = self._load_panel(panel_csv)
        self.data = IMCData()
        self.channel_names = self.panel["marker"].tolist()
        self.data.channel_names = self.channel_names

        # 选择分割器
        self.segmenter = pick_segmenter(segmenter) if segmenter is None else segmenter
        if self.segmenter not in SEGMENTERS:
            raise ValueError(f"未知分割器: {self.segmenter}")
        info = SEGMENTERS[self.segmenter]
        print(f"\n🔬 使用分割方法: {info['name']}")
        print(f"   {info['description']}")

    def _load_panel(self, path: str) -> pd.DataFrame:
        df = pd.read_csv(path)
        if "channel" not in df.columns or "marker" not in df.columns:
            raise ValueError("panel.csv 必须有 'channel' 和 'marker' 列")
        return df

    def _tiff_files(self) -> list:
        filt_dir = self.output_dir / "filtered"
        if filt_dir.exists():
            filtered = sorted(filt_dir.glob("*.tiff")) + sorted(filt_dir.glob("*.tif"))
            if filtered:
                return filtered
        return sorted(self.input_dir.glob("*.tiff")) + sorted(self.input_dir.glob("*.tif"))

    # ── Preprocessing ─────────────────────────────────────────────────

    def preprocess(self, gauss_sigma: dict = None, thresholds: dict = None):
        filt_dir = self.output_dir / "filtered"
        filt_dir.mkdir(parents=True, exist_ok=True)
        if not HAS_TIFFFILE:
            raise ImportError("需要 tifffile: pip install tifffile")

        for tiff_path in sorted(self.input_dir.glob("*.tiff")) + sorted(self.input_dir.glob("*.tif")):
            img = tifffile.imread(tiff_path).astype(np.float32)
            if img.ndim == 2:
                img = img[np.newaxis, ...]
            elif img.ndim != 3:
                raise ValueError(f"{tiff_path.name}: 仅支持 2D 或 (C,H,W) TIFF，实际 shape {img.shape}")
            for ch_idx in range(img.shape[0]):
                ch_name = self.channel_names[ch_idx] if ch_idx < len(self.channel_names) else f"ch{ch_idx}"
                sigma = (gauss_sigma or {}).get(ch_name, 0)
                if sigma > 0:
                    bg = ndimage.gaussian_filter(img[ch_idx], sigma=sigma)
                    img[ch_idx] = np.clip(img[ch_idx] - bg, 0, None)
                thresh = (thresholds or {}).get(ch_name, 0)
                if thresh > 0:
                    img[ch_idx] = np.clip(img[ch_idx] - thresh, 0, None)
            tifffile.imwrite(filt_dir / tiff_path.name, img, photometric="minisblack")
            print(f"  ✓ {tiff_path.name}")
        return self

    # ── Segmentation ──────────────────────────────────────────────────

    def segment(self, nucleus_channel: int = 0, min_area: int = 50):
        if not HAS_TIFFFILE:
            raise ImportError("需要 tifffile: pip install tifffile")
        if not HAS_SKIMAGE:
            raise ImportError("需要 scikit-image: pip install scikit-image")

        mask_dir = self.output_dir / "masks"
        mask_dir.mkdir(parents=True, exist_ok=True)
        all_cells = []

        # 选择分割函数
        seg_fn = {
            "stardist": segment_stardist,
            "cellpose": segment_cellpose,
            "mesmer": segment_mesmer,
            "otsu": segment_otsu,
        }[self.segmenter]

        def channel_means(regionmask, intensity_image):
            return np.mean(intensity_image[regionmask], axis=0)

        tiff_files = self._tiff_files()
        for tiff_path in tiff_files:
            img = tifffile.imread(tiff_path).astype(np.float32)
            if img.ndim == 2:
                img = img[np.newaxis, ...]
            elif img.ndim != 3:
                raise ValueError(f"{tiff_path.name}: 仅支持 2D 或 (C,H,W) TIFF，实际 shape {img.shape}")
            sample_id = tiff_path.stem
            n_ch = img.shape[0]
            if not 0 <= nucleus_channel < n_ch:
                raise ValueError(f"{sample_id}: nucleus_channel {nucleus_channel} 超出 0..{n_ch-1}")
            dna = img[nucleus_channel]

            # 调用选定的分割器
            labels = seg_fn(dna)

            # 提取细胞特征
            props = measure.regionprops_table(
                labels,
                intensity_image=np.stack([img[c] for c in range(n_ch)], axis=-1),
                properties=["label", "centroid", "area"],
                extra_properties=(channel_means,),
            )
            cell_df = pd.DataFrame(props)
            renames = {"label": "cell_id", "centroid-0": "y", "centroid-1": "x", "area": "area"}
            for c in range(n_ch):
                renames[f"channel_means-{c}"] = f"ch_{c}"
            cell_df = cell_df.rename(columns=renames)
            cell_df["sample_id"] = sample_id
            cell_df = cell_df[cell_df["area"] >= min_area]
            cell_df["cell_id"] = [f"{sample_id}_{i}" for i in range(len(cell_df))]

            all_cells.append(cell_df)
            tifffile.imwrite(mask_dir / f"{sample_id}_mask.tiff", labels.astype(np.uint32))
            print(f"  ✓ {sample_id}: {len(cell_df)} 细胞 ({self.segmenter})")

        empty_cols = ["cell_id", "y", "x", "area"]
        empty_cols += [f"ch_{c}" for c in range(len(self.channel_names))]
        empty_cols.append("sample_id")
        self.data.cells = pd.concat(all_cells, ignore_index=True) if all_cells else pd.DataFrame(columns=empty_cols)
        self.data.samples = self.data.cells["sample_id"].unique().tolist()

        # 重命名通道列为蛋白名称
        renames = {}
        for c in range(len(self.channel_names)):
            old = f"ch_{c}"
            if old in self.data.cells.columns:
                renames[old] = f"intensity_{self.channel_names[c]}"
        if renames:
            self.data.cells = self.data.cells.rename(columns=renames)

        return self

    # ── QC ────────────────────────────────────────────────────────────

    def qc_filter(self, min_intensity_pct: float = 0.01, max_area_factor: float = 3.0):
        cells = self.data.cells
        if len(cells) == 0:
            print("  ⚠ 无细胞数据，跳过 QC")
            return self
        if "area" not in cells.columns:
            print("  ⚠ 缺少 area 列，跳过 QC")
            return self
        area_median = cells["area"].median()
        mask = (cells["area"] >= 20) & (cells["area"] <= area_median * max_area_factor)
        dna_cols = [c for c in cells.columns if c.startswith("intensity_DNA")]
        if dna_cols:
            mask &= cells[dna_cols[0]] > cells[dna_cols[0]].quantile(min_intensity_pct)
        before = len(cells)
        self.data.cells = cells[mask].reset_index(drop=True)
        after = len(self.data.cells)
        print(f"  ✓ QC: {before} → {after} 细胞 ({after/before*100:.0f}% 保留)")
        return self

    # ── Clustering ────────────────────────────────────────────────────

    def cluster(self, n_pcs: int = 30, n_clusters: int = None):
        cells = self.data.cells
        if len(cells) == 0:
            print("  ⚠ 无细胞数据，跳过聚类")
            return self
        ch_cols = [c for c in cells.columns if c.startswith("intensity_") and "DNA" not in c]
        if not ch_cols:
            print("  ⚠ 未找到强度列")
            return self
        X = StandardScaler().fit_transform(cells[ch_cols].values)
        pca = PCA(n_components=min(n_pcs, X.shape[1]))
        X_pca = pca.fit_transform(X)
        n = n_clusters or max(5, int(len(cells) ** 0.5 / 3))
        km = KMeans(n_clusters=min(n, len(cells)), random_state=42, n_init=10)
        cells["cluster"] = km.fit_predict(X_pca).astype(str)
        try:
            import umap
            emb = umap.UMAP(random_state=42).fit_transform(X_pca)
            cells["umap1"] = emb[:, 0]
            cells["umap2"] = emb[:, 1]
        except ImportError:
            pass
        print(f"  ✓ 聚类: {n} 个类群")
        return self

    # ── CN Analysis ───────────────────────────────────────────────────

    def cellular_neighborhood(self, k: int = 20, n_niches: int = 6, max_dist: float = 50.0):
        cells = self.data.cells
        if len(cells) == 0 or "cluster" not in cells.columns:
            print("  ⚠ 无数据或未聚类，跳过 CN")
            return self
        cn_col = f"CN{n_niches}"
        for sample in cells["sample_id"].unique():
            mask = cells["sample_id"] == sample
            coords = cells.loc[mask, ["x", "y"]].values
            if len(coords) < k:
                continue
            tree = KDTree(coords)
            dists, indices = tree.query(coords, k=min(k + 1, len(coords)), distance_upper_bound=max_dist)
            ctypes = cells.loc[mask, "cluster"].values
            unique_ct = sorted(cells["cluster"].dropna().unique())
            ct_to_idx = {ct: i for i, ct in enumerate(unique_ct)}
            neigh = np.zeros((len(coords), len(unique_ct)))
            for i, nbrs in enumerate(indices):
                nbrs = nbrs[(nbrs < len(coords)) & (dists[i] <= max_dist)]
                nbrs = nbrs[nbrs != i]
                for nbr in nbrs:
                    if ctypes[nbr] in ct_to_idx:
                        neigh[i, ct_to_idx[ctypes[nbr]]] += 1
                total = neigh[i].sum()
                if total > 0:
                    neigh[i] /= total
            n_clust = min(n_niches, len(coords))
            km = KMeans(n_clusters=n_clust, random_state=22, n_init=10)
            cells.loc[mask, cn_col] = [f"Niche{i+1}" for i in km.fit_predict(neigh)]
        cells[cn_col] = cells[cn_col].fillna("Niche1") if cn_col in cells.columns else "Niche1"
        print(f"  ✓ CN: {n_niches} Niches")
        return self

    # ── Cell Interaction ─────────────────────────────────────────────

    def cell_interaction(self, group_var: str = None):
        cells = self.data.cells
        if len(cells) == 0 or "cluster" not in cells.columns:
            print("  ⚠ 无数据或未聚类，跳过细胞交互")
            return self
        interactions = []
        for sample in cells["sample_id"].unique():
            mask = cells["sample_id"] == sample
            coords = cells.loc[mask, ["x", "y"]].values
            ctypes = cells.loc[mask, "cluster"].values
            if len(coords) < 2:
                continue
            tree = KDTree(coords)
            pairs = tree.query_pairs(r=30.0, output_type="ndarray")
            for i, j in pairs:
                interactions.append({
                    "sample_id": sample,
                    "from_label": ctypes[i],
                    "to_label": ctypes[j],
                })
        if interactions:
            int_df = pd.DataFrame(interactions)
            counts = int_df.groupby(["sample_id", "from_label", "to_label"]).size().reset_index(name="ct")
            counts.to_csv(self.output_dir / "interaction_counts.csv", index=False)
            print(f"  ✓ 交互矩阵: {len(counts)} 对")
        return self

    # ── Run ───────────────────────────────────────────────────────────

    def run(self, preprocess: bool = False, nucleus_channel: int = 0):
        if preprocess:
            self.preprocess()
        self.segment(nucleus_channel=nucleus_channel)
        self.qc_filter()
        self.cluster()
        self.cellular_neighborhood()
        self.cell_interaction()
        self.data.cells.to_csv(self.output_dir / "cells_full.csv", index=False)
        print(f"\n✅ 管道完成: {self.output_dir}")
        return self.data


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="IMC 分析管道 (StarDist / Cellpose / Mesmer / Otsu)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
分割器:
  stardist  StarDist 核分割 (推荐, pip install stardist)
  cellpose  Cellpose 通用分割 (pip install cellpose)
  mesmer    Mesmer 组织分割 (pip install deepcell)
  otsu      Otsu + 分水岭 (无需额外安装)

示例:
  python imc_pipeline.py --input-dir ./images --panel panel.csv --output-dir ./out --segmenter stardist
  python imc_pipeline.py --input-dir ./images --panel panel.csv --output-dir ./out  # 交互选择
        """,
    )
    parser.add_argument("--input-dir", required=True, help="TIFF 图像目录")
    parser.add_argument("--panel", required=True, help="Panel CSV (channel → marker)")
    parser.add_argument("--output-dir", required=True, help="输出目录")
    parser.add_argument("--segmenter", choices=list(SEGMENTERS.keys()),
                        help="分割方法 (不指定则交互选择)")
    parser.add_argument("--nucleus-channel", type=int, default=0)
    parser.add_argument("--preprocess", action="store_true")
    parser.add_argument("--k", type=int, default=20)
    parser.add_argument("--n-niches", type=int, default=6)
    parser.add_argument("--min-area", type=int, default=50)
    parser.add_argument("--non-interactive", action="store_true",
                        help="非交互模式，未指定 --segmenter 时回退到 Otsu")
    args = parser.parse_args()

    if not os.path.isdir(args.input_dir):
        print(f"❌ 目录不存在: {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    if args.segmenter is None and args.non_interactive:
        print("⚠️  非交互模式，使用 Otsu 分割 (--segmenter 未指定)")
    segmenter = args.segmenter
    if segmenter is None and args.non_interactive:
        segmenter = "otsu"
    if segmenter is None and not args.non_interactive:
        segmenter = pick_segmenter()

    pipe = IMCPipeline(args.input_dir, args.panel, args.output_dir, segmenter=segmenter)
    if args.preprocess:
        pipe.preprocess()
    pipe.segment(nucleus_channel=args.nucleus_channel, min_area=args.min_area)
    pipe.qc_filter()
    pipe.cluster()
    pipe.cellular_neighborhood(k=args.k, n_niches=args.n_niches)
    pipe.cell_interaction()
    pipe.data.cells.to_csv(pipe.output_dir / "cells_full.csv", index=False)
    print(f"\n✅ 管道完成: {pipe.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
