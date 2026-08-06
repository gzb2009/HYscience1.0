---
name: spatial-deconv
description: 空间转录组去卷积：用 cell2location (或 NNLS/correlation 回退) 从 scRNA-seq 参考映射细胞类型到空间位点。Use when you need to estimate cell type proportions per spatial spot from Visium/Slide-seq/MERFISH data.
category: biology
license: Apache-2.0
metadata:
  skill-author: HYscience
version: 1.0.0
tags: [Spatial, Deconvolution, cell2location, Visium, Slide-seq, scRNA-seq]
dependencies: ["scanpy>=1.10.0", "anndata>=0.10.0", "cell2location>=0.1.3", "scipy>=1.10.0", "numpy>=1.21.0"]
---

# 空间转录组去卷积 (Spatial Deconvolution)

## Overview

将空间转录组数据中的每个位点 (spot) 分解为多种细胞类型的比例。使用 scRNA-seq 参考数据估计细胞类型特异性表达谱，再映射到空间数据中。支持三种算法：**cell2location** (首选, Bayesian)、**NNLS** (非负最小二乘)、**相关性** (快速探索)。

## When to Use

- 有 scRNA-seq 参考数据 + 空间转录组数据 (Visium, Slide-seq 等)，需要估计每个 spot 的细胞组成
- 想了解肿瘤微环境的免疫浸润空间分布
- 需要识别特定细胞类型富集的空间区域
- 作为 cell-cell interaction / niche 分析的前置步骤

## Quick Start

```bash
python scripts/spatial_deconv.py \
  --spatial spatial_data.h5ad \
  --reference scrna_ref.h5ad \
  --cell-type-key cell_type \
  --output results/spatial_deconvolved.h5ad \
  --method auto
```

### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--spatial` | ✅ | 空间转录组 .h5ad 文件 |
| `--reference` | ✅ | scRNA-seq 参考 .h5ad 文件 |
| `--cell-type-key` | ✅ | scRNA-seq 参考中细胞类型注释的 .obs 列名 |
| `--output` | ❌ | 输出 .h5ad 路径 (默认: spatial_deconvolved.h5ad) |
| `--method` | ❌ | `auto` (默认), `cell2location`, `nnls`, `correlation` |
| `--n-cells-per-location` | ❌ | 每个 spot 平均细胞数 (默认: 8) |
| `--top-marker-genes` | ❌ | 每种细胞类型的 marker 基因数 (cell2location 用, 默认: 50) |

## Algorithms

### cell2location (首选)
基于负二项分布的贝叶斯模型，通过 Pyro/NumPyro 进行变分推断。准确率最高，能区分细微的细胞类型差异。需要 GPU 加速效果更好。

### NNLS (非负最小二乘)
用 scipy.optimize.nnls 求解，将每个 spot 的表达分解为细胞类型特征的线性组合。速度快，无需 GPU。

### Correlation (相关性)
计算每个 spot 与每种细胞类型平均表达谱的 Pearson/Spearman 相关性。最快，适合快速探索数据。

## 输出

- `{output}`: AnnData 文件
  - `.obsm['celltype_proportions']`: `N_spots × N_celltypes` 矩阵，每行和为 1
  - `.uns['deconv_params']`: 去卷积参数记录
  - `.uns['deconv_method']`: 实际使用的方法

## Common Pitfalls

1. **参考和空间数据的基因名不匹配**: 确保两者使用相同的基因命名体系 (如都使用 gene symbol)
2. **细胞类型过多导致 NNLS 不稳定**: 多于 20 种细胞类型时建议用 cell2location
3. **稀疏的空间数据**: 表达基因数过少 (<500/spot) 的 spot 建议先过滤
4. **cell2location 安装困难**: 如果 Pyro 安装失败，自动回退到 NNLS

## Verification Checklist

- [ ] 成功读取 spatial + reference .h5ad 文件
- [ ] `cell_type_key` 存在于 reference.obs 中
- [ ] 输出 .obsm['celltype_proportions'] 存在且形状正确 (N_spots × N_celltypes)
- [ ] 每行比例之和 ≈ 1.0
- [ ] print 出 "✅ 去卷积完成: N种细胞类型映射到M个空间位点"
