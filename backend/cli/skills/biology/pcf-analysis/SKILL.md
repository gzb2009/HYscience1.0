---
name: pcf-analysis
description: Protein Correlation Fingerprinting for spatial proteomics — co-expression matrices, fingerprint clustering, tissue microenvironment classification. Works on IMC/CODEX/MIBI multi-channel protein data.
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

- Analyzing protein co-expression patterns in IMC data
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
