---
name: single-cell-pipeline
description: One-click single-cell analysis pipeline — QC → integration → clustering → annotation → DEG → report. Agent-friendly entry point for scRNA-seq data.
category: biology
license: Apache-2.0
metadata:
  skill-author: HYscience
version: 1.0.0
tags: [Single-Cell, Pipeline, scRNA-seq, QC, Clustering, Annotation, DEG]
dependencies: ["scanpy>=1.10.0", "anndata>=0.10.0"]
---

# Single-Cell Analysis Pipeline

## Overview

一键式单细胞转录组分析管道。Agent 收到"分析单细胞数据"时调用此 skill，自动跑完 QC → 整合 → 降维 → 聚类 → 注释 → 差异分析 → 报告全流程。

## When to Use

- 用户说"分析这个单细胞数据"
- 需要快速获取细胞类型和差异基因概览
- 作为后续深度分析的起点

## Quick Start

```bash
python full_pipeline.py --input raw.h5ad --output-dir ./sc_results --species human
```
