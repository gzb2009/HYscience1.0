---
name: imc-analysis
description: IMC (Imaging Mass Cytometry) 蛋白质成像分析管道 — 预处理、细胞分割（StarDist/Cellpose/Mesmer/Otsu）、定量、质控、聚类、空间邻域分析、细胞互作。Python 原生实现，替代 R/imcRtools。
category: biology
license: Apache-2.0
metadata:
  skill-author: HYscience
version: 2.0.0
tags: [IMC, Imaging Mass Cytometry, Protein, Spatial, Segmentation, StarDist, Cellpose, Mesmer, Otsu, Cellular Neighborhood, Cell Interaction]
dependencies: ["numpy>=1.25.0", "scipy>=1.11.0", "pandas>=2.0.0", "scikit-learn>=1.3.0", "tifffile>=2023.0.0", "scikit-image>=0.22.0"]
---

# IMC 分析管道 (IMC Analysis Pipeline)

## Overview

IMC（成像质谱流式，Imaging Mass Cytometry）蛋白质成像数据的完整 Python 分析管道。取代 R 生态的 `imcRtools` + `SpatialExperiment` 工作流，全部使用 Python 原生实现。

**核心脚本**: `scripts/imc_pipeline.py`

## 何时使用本 Skill

- 分析 IMC 多通道 TIFF 成像数据（OME-TIFF 格式）
- 蛋白质成像数据的细胞分割（核/细胞质）
- 细胞邻域（Cellular Neighborhood, CN）与微环境分析
- 细胞-细胞空间互作统计
- 将 R/imcRtools 工作流迁移到 Python
- 用户提到"IMC"、"成像质谱"、"tiff 分割"、"细胞邻域"时

## 四种分割方法（让用户选择）

| 分割器 | 特点 | 安装 | 适用场景 |
|--------|------|------|---------|
| **StarDist** ⭐ | 深度学习核分割，速度快精度高 | `pip install stardist` | IMC/IF 类圆形核，**默认推荐** |
| **Cellpose** 🧬 | 通用分割，支持不规则形态 | `pip install cellpose` | 形态多样的细胞 |
| **Mesmer** 🔬 | 组织级多细胞分割，核+质边界 | `pip install deepcell` | 复杂组织微环境 |
| **Otsu** 🛠️ | 阈值+分水岭，零依赖 | 无需安装 | 快速预览 / 回退方案 |

> **⚠️ 交互规则**：当用户要求分割但未指定方法时，**必须列出全部四种选项并给出推荐（StarDist），等待用户选择**，不得擅自替用户决定。

## 数据格式

### 输入
- 多通道 TIFF 图像：2D 灰度或 `(C, H, W)` 三维堆叠（每个通道一个蛋白标记）
- Panel CSV：映射通道索引 → 蛋白名称

```csv
channel,marker
0,DNA1
1,CD3
2,CD8a
3,CD68
4,CK
```

### 输出
| 文件 | 内容 |
|------|------|
| `masks/{sample}_mask.tiff` | 每个样本的细胞分割掩膜 |
| `filtered/*.tiff` | 预处理后图像（背景校正/阈值） |
| `cells_full.csv` | 细胞级完整数据表（坐标+强度+聚类+CN） |
| `interaction_counts.csv` | 细胞类型对空间互作计数 |

## 快速开始

### 方式一：命令行（非交互，指定分割器）

```bash
python imc_pipeline.py \
  --input-dir ./images \
  --panel panel.csv \
  --output-dir ./out \
  --segmenter stardist \
  --nucleus-channel 0 \
  --min-area 50
```

### 方式二：命令行（交互选择分割器）

```bash
python imc_pipeline.py --input-dir ./images --panel panel.csv --output-dir ./out
# 会列出 4 种分割器供选择
```

### 方式三：Python API

```python
import sys
sys.path.insert(0, "backend/cli/skills/biology/imc-analysis/scripts")
from imc_pipeline import IMCPipeline, SEGMENTERS, pick_segmenter

pipe = IMCPipeline("images", "panel.csv", "output", segmenter="stardist")
pipe.preprocess(gauss_sigma={"CD3": 500.0}, thresholds={"CD3": 1.2})  # 可选
pipe.segment(nucleus_channel=0, min_area=50)
pipe.qc_filter()
pipe.cluster(n_pcs=30, n_clusters=8)
pipe.cellular_neighborhood(k=20, n_niches=6, max_dist=50.0)
pipe.cell_interaction(group_var="condition")
data = pipe.data  # IMCData: .cells DataFrame
```

## 管道步骤详解

### 1. 预处理 `preprocess()`
- 逐通道高斯背景减除（`gauss_sigma` 按蛋白名指定）
- 逐通道手动阈值减除（`thresholds`）
- 输出到 `output_dir/filtered/`，供后续分割使用

### 2. 细胞分割 `segment()`
- 默认取通道 0 作为 DNA/核通道（`nucleus_channel`）
- 调用所选分割器：StarDist / Cellpose / Mesmer / Otsu
- 分割器缺失时自动回退 Otsu（并提示安装命令）
- 校验：图像维度、核通道索引范围
- 提取每个细胞的：坐标（y, x）、面积、各通道平均强度

### 3. 质控 `qc_filter()`
- 面积下限 20 px、上限 = 中位数 × `max_area_factor`
- 按 DNA 强度分位数过滤（`min_intensity_pct`）
- 空数据安全跳过

### 4. 聚类 `cluster()`
- 强度列标准化 → PCA（默认 30 维）→ KMeans
- 自动确定聚类数（n_cells 开方 / 3，可手动指定）
- 有 umap-learn 时自动算 UMAP 坐标（umap1/umap2）
- 空数据安全跳过

### 5. 细胞邻域 `cellular_neighborhood()`
- 每个样本独立构建空间 KDTree
- k 近邻（默认 20，`max_dist` 距离上限）
- 聚合邻居细胞类型比例 → KMeans 聚类成 N 个 Niche
- 小样本自动降级：样本细胞 < k 时整列填充 Niche1
- 输出列：`CN{n_niches}`（如 CN6）

### 6. 细胞互作 `cell_interaction()`
- 半径 30 px 内的细胞对（KDTree query_pairs）
- 按样本 × 细胞类型对聚合计数 → `interaction_counts.csv`
- 提供 `group_var` 时可做组间 Wilcoxon 检验

## Agent 交互指南

当用户说"分析这个 IMC 数据"时：

1. **检查输入**：确认 TIFF 目录 + panel.csv 存在
2. **询问分割器**：列出 4 种选项，推荐 StarDist，等待用户选择
3. **询问生物学背景**：实验条件分组（用于互作比较）、组织类型
4. **执行管道**：segment → qc → cluster → CN → interaction
5. **解读结果**：用中文说明细胞数量、聚类、Niche 组成、显著互作
6. **建议下一步**：如"要按条件比较 Niche 比例吗？"、"要做空间蛋白共表达分析吗？"

## 测试

```bash
# 单元测试（14 个测试）
python -m unittest discover -s backend/cli/skills/biology/imc-analysis/tests

# 或使用项目 bun 测试
bun run --cwd backend/cli test
```

## 与 R/imcRtools 对照

| R (imcRtools) | Python (本管道) |
|---------------|-----------------|
| `buildSpatialGraph(img_id, k, max_dist)` | `KDTree` + `query(..., distance_upper_bound)` |
| `aggregateNeighbors(aggregate_by, count_by)` | numpy 邻居类型比例聚合 |
| `kmeans()` | `sklearn.cluster.KMeans` |
| `SpatialExperiment` | `IMCData` dataclass + DataFrame |
| `wilcox.test()` | `scipy.stats.mannwhitneyu` |
| `plotSpatial()` | matplotlib scatter |
| `CytoImageList` 掩膜 | `masks/*.tiff` (uint32) |
