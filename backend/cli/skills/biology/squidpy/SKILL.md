---
name: squidpy
description: Use when analyzing spatial transcriptomics data. Squidpy spatial QC, neighborhood enrichment, Moran's I, and ligand-receptor analysis for Visium/MERFISH/Xenium/Slide-seq data.
category: biology
license: Apache-2.0
metadata:
  skill-author: HYscience
version: 1.0.0
tags: [Spatial Transcriptomics, Squidpy, Visium, MERFISH, Xenium, Slide-seq, Neighborhood Analysis, Ligand-Receptor]
dependencies: ["squidpy>=1.4.0", "scanpy>=1.10.0", "anndata>=0.10.0"]
---

# Squidpy 空间转录组分析

## Overview

Squidpy 是空间转录组学数据分析的核心工具包。此 skill 提供三个标准化脚本：空间QC、邻域富集分析、空间配体-受体分析。所有脚本接收 `.h5ad` 格式输入，打印中文状态信息，输出分析结果。

## When to Use

- 用户说"做空间转录组分析"或"跑 Squidpy"
- 需要对 Visium、MERFISH、Xenium、Slide-seq 数据进行空间QC
- 分析细胞类型在空间上的共定位和邻域富集
- 探究配体-受体对在空间距离约束下的相互作用

## Supported Data Formats

| 平台 | 空间坐标位置 | 说明 |
|------|------------|------|
| Visium (10x) | `.obsm['spatial']` | 点阵坐标，每个 spot 直径 55 μm |
| MERFISH (Vizgen) | `.obsm['spatial']` | 单分子空间坐标，高分辨率 |
| Xenium (10x) | `.obsm['spatial']` | 亚细胞分辨率原位测序 |
| Slide-seq | `.obsm['spatial']` | 珠子阵列空间坐标 |

> 所有平台的空间坐标必须存储在 `.obsm['spatial']` 中，格式为 `n_obs × 2` 的 `numpy.ndarray`。

## Quick Start

```bash
# Step 1: 空间QC
python scripts/spatial_qc.py --input raw.h5ad --output qc.h5ad

# Step 2: 邻域分析
python scripts/neighborhood_analysis.py --input qc.h5ad --cluster-key leiden --output-dir ./results

# Step 3: 空间配体-受体分析
python scripts/ligand_receptor_spatial.py --input qc.h5ad --cluster-key leiden --output-dir ./results
```

## Scripts

### `scripts/spatial_qc.py`
对空间数据进行质量控制和过滤。计算每个 spot 的空间度量（总计数、高表达基因数、线粒体比例），检查 spot 覆盖度，移除低质量 spots。输出清洗后的 `.h5ad` 文件。

### `scripts/neighborhood_analysis.py`
基于空间邻接图进行邻域富集分析。运行 `squidpy.gr.spatial_neighbors` 构建空间邻接图，`squidpy.gr.nhood_enrichment` 计算细胞类型间空间富集，并计算 Moran's I 评估细胞类型空间自相关性。输出邻域富集矩阵 CSV。

### `scripts/ligand_receptor_spatial.py`
利用空间距离约束进行配体-受体相互作用分析。使用 `squidpy.gr.ligrec` 在指定距离范围内筛选显著的配体-受体对。输出空间约束的配体-受体结果 CSV。

## Common Pitfalls

1. **空间坐标缺失** — 确保 `.obsm['spatial']` 存在且为 `n_obs × 2` 的 float 数组。若坐标在 `X`、`Y` 列中，先执行 `adata.obsm['spatial'] = adata.obs[['X', 'Y']].values`。
2. **坐标单位不匹配** — `spatial_neighbors` 默认 `n_neigh=6`，对不同平台需调整 `n_neigh` 和 `radius` 参数。
3. **ligrec 内存不足** — 大量配体-受体对计算时可能出现内存问题，建议使用 `n_perms=100` 而非默认 1000。
4. **cluster key 不存在** — 确保 `--cluster-key` 指向 `.obs` 中存在的聚类注释列。

## Verification Checklist

- [ ] `.h5ad` 中包含 `.obsm['spatial']` 空间坐标
- [ ] 空间坐标形状为 `(n_obs, 2)`，类型为 float
- [ ] 聚类注释列存在于 `.obs` 中
- [ ] 输出目录存在且可写
- [ ] QC 脚本完成后 spots 数合理（通常保留 80-95%）
