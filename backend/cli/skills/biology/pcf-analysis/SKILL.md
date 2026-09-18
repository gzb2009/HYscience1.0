---
name: pcf-analysis
description: Computational Protein Correlation Fingerprinting on already-confirmed multiplex protein tables (IMC/CODEX/MIBI). Do not use this skill to interpret the acronym PCF — ask first; PCF often means PhenoCycler-Fusion.
category: biology
license: Apache-2.0
metadata:
  skill-author: HYscience
version: 1.0.0
tags: [PCF, Protein Correlation, Spatial Proteomics, IMC, CODEX, MIBI, Microenvironment]
dependencies: ["numpy>=1.25.0", "scipy>=1.11.0", "pandas>=2.0.0", "scikit-learn>=1.3.0", "matplotlib>=3.7.0", "seaborn>=0.12.0"]
---

# PCF — Protein Correlation Fingerprinting

## Overview

Protein Correlation Fingerprinting quantifies the spatial co-expression relationships among protein markers in multiplexed imaging data (IMC/CODEX/MIBI). It computes per-cell protein correlation matrices, clusters cells into functional microenvironments, and identifies tissue architecture patterns.

## When to Use This Skill

BLOCKING: If the user only wrote "PCF" (e.g. 做PCF的panel), do not assume this method. Ask whether they mean PhenoCycler-Fusion (Akoya, formerly CODEX) or this fingerprinting analysis.

- Analyzing protein co-expression patterns in IMC data after the user confirmed this method
- Identifying functional tissue microenvironments (TME compartments)
- Comparing protein correlation networks between conditions
- Replacing R-based PCF workflows with Python

## Quick Start

```python
from pcf_analysis import PCFFingerprinter

pcf = PCFFingerprinter(cells_df)
pcf.protein_correlation(method="spearman")
pcf.microenvironment_clustering(n_mes=8)
pcf.plot_correlation_network()
pcf.compare_conditions(group_var="condition")
```
