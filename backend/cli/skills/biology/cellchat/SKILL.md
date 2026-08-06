---
name: cellchat
description: "Use when performing ligand-receptor (LR) interaction analysis on single-cell RNA-seq data. Uses liana-py (pure Python) instead of R CellChat for cell-cell communication inference from .h5ad files with cell type annotations."
dependencies:
  - liana-py
  - scanpy
  - pandas
category: biology
allowed-tools: [Read, Write, Edit, Bash]
---

# CellChat — 配体-受体互作分析

## 概述

本技能实现基于 **liana-py**（纯 Python）的配体-受体（Ligand-Receptor, LR）互作分析，替代传统的 R CellChat 工具。通过分析单细胞 RNA-seq 数据中的细胞间通讯信号，识别在特定细胞类型之间显著富集的配体-受体对。

**核心能力：**
- 从 `.h5ad` 文件中读取单细胞表达数据
- 利用 liana-py 的 `rank_aggregate` 方法进行 LR 互作推断
- 输出包含 source、target、ligand、receptor、magnitude、specificity 等字段的 CSV 结果

## 何时使用本技能

- 需要从 scRNA-seq 数据中推断细胞间通讯网络
- 分析肿瘤微环境中的细胞互作
- 发育生物学中的信号通路研究
- 免疫细胞与其他细胞类型之间的通讯分析
- 疾病状态下细胞间信号异常分析
- 需要纯 Python 工作流（避免 R 语言依赖）

## 快速开始

### 1. 准备输入数据

输入文件为 `.h5ad` 格式的 AnnData 对象，要求：

- `.X` 包含原始计数矩阵（raw counts，推荐）或 log-normalized 数据
- `.obs['cell_type']` 包含细胞类型注释

### 2. 运行分析

```bash
python scripts/lr_analysis.py \
    --input <path/to/input.h5ad> \
    --output <path/to/liana_results.csv> \
    --groupby cell_type
```

### 3. 输出解读

输出 CSV 文件 `liana_results.csv` 包含以下列：

| 列名 | 说明 |
|------|------|
| `source` | 发送信号的源细胞类型 |
| `target` | 接收信号的目标细胞类型 |
| `ligand` | 配体基因名称 |
| `receptor` | 受体基因名称 |
| `magnitude` | 互作强度（rank_aggregate 综合评分） |
| `specificity` | 互作特异性得分 |

## 药物靶点筛选典型工作流

以下是一个完整的药物靶点筛选工作流示例：

### 步骤 1: 整理数据

```python
import scanpy as sc

adata = sc.read_h5ad("tumor.h5ad")
# 确保 adata.obs 包含 'cell_type' 列
print(adata.obs['cell_type'].value_counts())
```

### 步骤 2: 运行 LR 分析

```bash
python scripts/lr_analysis.py --input tumor.h5ad --output liana_results.csv
```

控制台会打印：
```
✅ 配体-受体分析完成: 342 对显著互作
```

### 步骤 3: 筛选与靶点相关的互作对

使用 `pandas` 过滤结果，示例：

```python
import pandas as pd

df = pd.read_csv("liana_results.csv")

# 筛选肿瘤细胞作为 receiver 的互作
tumor_targets = df[df['target'].str.contains('Tumor|Malignant', case=False)]

# 筛选免疫细胞 -> 肿瘤细胞的互作（潜在免疫治疗靶点）
immune_to_tumor = df[
    df['source'].str.contains('T_cell|NK|Macrophage|DC', case=False) &
    df['target'].str.contains('Tumor|Malignant', case=False)
]

# 按互作强度排序
top_hits = tumor_targets.sort_values('magnitude', ascending=False).head(20)

# 获取唯一配体作为潜在药物靶点
candidate_targets = top_hits['ligand'].unique()
print(f"候选药物靶点: {candidate_targets}")

# 导出候选列表
top_hits.to_csv("drug_target_candidates.csv", index=False)
print(f"✅ 已导出 top {len(top_hits)} 候选互作对")
```

### 步骤 4: 交叉验证与优先级排序

```python
# 与已知药物靶点数据库交叉比对
known_targets = set(candidate_targets)
# 后续可结合 DrugBank、Open Targets 等数据库进行靶点可药性评估
```

## 高级用法

### 选择不同的方法

`lr_analysis.py` 默认使用 `rank_aggregate` 方法，合并多种 LR 方法的排序结果。如需使用特定方法：

```python
import liana as li

# 单一方法（例如 CellPhoneDB）
li.mt.cellphonedb(adata, groupby='cell_type', ...)

# 或使用其他方法
li.mt.natmi(adata, groupby='cell_type', ...)
li.mt.logfc(adata, groupby='cell_type', ...)
li.mt.connectome(adata, groupby='cell_type', ...)
```

### 使用配体-受体资源数据库

```python
li.mt.rank_aggregate(
    adata,
    groupby='cell_type',
    resource_name='consensus',  # 默认，还可以是 'cellphonedb', 'cellchatdb' 等
    expr_prop=0.1,              # 基因在细胞类型中的表达比例阈值
    verbose=True
)
```

## 常见问题

### Q: 需要使用 raw counts 还是 normalized data？

推荐使用 raw counts，liana-py 内部会进行适当的标准化处理。如果使用 log-normalized 数据，某些方法的结果可能不准确。

### Q: 结果中 magnitude 的含义是什么？

magnitude 是 `rank_aggregate` 方法通过合并多种 LR 推断方法（如 CellPhoneDB、NATMI、Connectome、LogFC 等）的排序结果计算出的综合得分，数值越高表示该配体-受体对的互作越显著。

### Q: 如何提高分析速度？

- 使用 `expr_prop` 参数过滤低表达基因（默认 0.1，即基因需在至少 10% 的细胞中表达）
- 使用 `n_perms` 参数减少置换检验次数
- 限制分析的细胞类型数量

### Q: 与 R CellChat 的区别？

| 特性 | R CellChat | liana-py (本技能) |
|------|-----------|-------------------|
| 语言 | R | Python |
| 方法 | 单一方法 | 多方法整合 (rank_aggregate) |
| 依赖 | 复杂 R 包依赖链 | 轻量级纯 Python |
| 输出 | R 对象 | 标准 CSV / AnnData |
| 与 scanpy 集成 | 需转换 | 原生支持 |

## 参考文献

- Dimitrov D, Türei D, Garrido-Rodriguez M, et al. Comparison of methods and resources for cell-cell communication inference from single-cell RNA-Seq data. *Nature Communications*, 2022.
- liana-py GitHub: https://github.com/saezlab/liana-py
