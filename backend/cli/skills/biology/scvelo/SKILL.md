---
name: scvelo
description: RNA velocity analysis with scVelo. Estimate cell-fate transitions from spliced/unspliced counts in single-cell data.
category: biology
license: MIT
metadata:
    skill-author: HYscience
dependencies:
    - scvelo>=1.0
    - scanpy
    - anndata
    - numpy
---

# scVelo — RNA Velocity Analysis

## Overview

scVelo estimates RNA velocity — the direction and speed of transcriptional changes in single-cell RNA-seq data — by modeling splicing kinetics from spliced and unspliced read counts. It generalizes the steady-state model of velocyto with dynamical and stochastic inference, enabling trajectory reconstruction, latent-time ordering, and cell-fate prediction.

## When to Use

- **RNA velocity estimation**: Infer future transcriptional state of individual cells from spliced/unspliced ratios.
- **Pseudotime / latent time**: Order cells along differentiation or reprogramming trajectories.
- **Terminal-state identification**: Detect lineage endpoints and root cells.
- **Dynamical modeling**: Recover full transcriptional kinetics (transcription, splicing, degradation rates) via the dynamical model.
- **Trajectory visualization**: Project velocity vectors onto UMAP/t-SNE/PCA embeddings.

## Important

**This skill requires `.h5ad` files with spliced/unspliced layers.** The input AnnData object MUST contain `spliced` and `unspliced` layers — typically produced by `velocyto run10x` or `alevin-fry`. If your data lacks these layers, run velocyto CLI first.

## Installation

```bash
pip install scvelo>=1.0 scanpy anndata numpy
```

## Quick Start

### Basic Velocity Pipeline

```bash
python scripts/compute_velocity.py \
  --input data.h5ad \
  --output data_with_velocity.h5ad
```

### With Dynamical Model

```bash
python scripts/compute_velocity.py \
  --input data.h5ad \
  --output result.h5ad \
  --mode dynamical \
  --n_top_genes 3000
```

### From Loom File

```bash
python scripts/compute_velocity.py \
  --input data_with_clusters.h5ad \
  --loom velocyto_output.loom \
  --output result.h5ad
```

## Core Workflows

### 1. RNA Velocity Estimation (`scripts/compute_velocity.py`)

Computes velocity vectors from spliced/unspliced counts, embeds them in a low-dimensional space, and saves the results back to the AnnData file.

**Required parameters:**
- `--input PATH`: Input `.h5ad` file (must contain `spliced`/`unspliced` layers, OR pair with `--loom`).
- `--output PATH`: Output `.h5ad` file with velocity layers added.

**Optional parameters:**
- `--loom PATH`: Path to velocyto `.loom` file (if spliced/unspliced not yet in `.h5ad`).
- `--mode {stochastic,dynamical}`: Velocity model (default: `stochastic`).
- `--n_top_genes N`: Number of highly variable genes for velocity (default: 2000).
- `--n_pcs N`: Number of PCs for neighborhood graph (default: 30).
- `--n_neighbors N`: Number of neighbors (default: 30).
- `--basis KEY`: Embedding basis for velocity projection (default: `umap`).

### 2. Latent Time Computation

After running the basic pipeline, compute latent time with the dynamical model:

```python
import scvelo as scv
import scanpy as sc

adata = sc.read('data_with_velocity.h5ad')
scv.tl.recover_dynamics(adata)
scv.tl.latent_time(adata)
scv.pl.scatter(adata, color='latent_time')
```

### 3. PAGA Trajectory Analysis

```python
scv.tl.paga(adata, groups='cell_type')
scv.pl.paga(adata, basis='umap', color='cell_type')
```

## Script Reference

| Script | Purpose | Key Inputs |
|--------|---------|------------|
| `compute_velocity.py` | Run RNA velocity pipeline (moments → velocity → velocity_graph → embedding) | `.h5ad` with spliced/unspliced layers, optional `.loom` |

## API Reference

### Pipeline Steps (executed in order by `compute_velocity.py`)

| Step | Function | Description |
|------|----------|-------------|
| 1. Preprocess | `scv.pp.filter_and_normalize` | Filter genes, normalize counts. |
| 2. Moments | `scv.pp.moments` | Compute first/second-order moments (k-nearest neighbor pooling). |
| 3. Velocity | `scv.tl.velocity` | Estimate RNA velocity (stochastic or dynamical). |
| 4. Velocity Graph | `scv.tl.velocity_graph` | Build a graph encoding velocity transitions. |
| 5. Embedding | `scv.tl.velocity_embedding` | Project velocity vectors into low-dimensional embedding. |

### Key Functions

```python
import scvelo as scv

# Load data
adata = scv.read('data.h5ad')

# Filter and normalize
scv.pp.filter_and_normalize(adata, min_shared_counts=20, n_top_genes=2000)

# Compute moments
scv.pp.moments(adata, n_pcs=30, n_neighbors=30)

# Estimate velocity
scv.tl.velocity(adata, mode='stochastic')  # or 'dynamical'

# Build velocity graph
scv.tl.velocity_graph(adata)

# Project onto embedding
scv.tl.velocity_embedding(adata, basis='umap')

# Save results
adata.write('result.h5ad')
```

### Visualisation

```python
# Velocity stream plot
scv.pl.velocity_embedding_stream(adata, basis='umap', color='cell_type')

# Velocity grid plot
scv.pl.velocity_embedding_grid(adata, basis='umap', color='cell_type')

# Latent time
scv.pl.scatter(adata, color='latent_time', basis='umap')
```

## Input Format

| Format | Extension | Required Content |
|--------|-----------|-----------------|
| AnnData (h5ad) | `.h5ad` | Must have `spliced` and `unspliced` layers (unless paired with `--loom`) |
| velocyto Loom | `.loom` | Spliced/unspliced counts from velocyto CLI |

## Output

The script adds these fields to the output `.h5ad`:

| Field | Key | Description |
|-------|-----|-------------|
| Velocity | `adata.layers['velocity']` | Per-gene velocity values |
| Velocity vectors | `adata.obsm['velocity_{basis}']` | Projected velocity vectors in embedding space |
| Velocity graph | `adata.uns['velocity_graph']` | Sparse graph of velocity transitions |
| Velocity graph neg | `adata.uns['velocity_graph_neg']` | Reverse transitions confidence |
| Moments | `adata.layers['Ms']`, `adata.layers['Mu']` | First/second-order moments for spliced/unspliced |

## Troubleshooting

**"No spliced/unspliced layers found"**: Use `--loom` to provide a velocyto loom file, or ensure your `.h5ad` was generated by `velocyto run10x`.

**"NaN or infinite values in expression matrix"**: Increase `min_shared_counts` in `scv.pp.filter_and_normalize` (edit `compute_velocity.py` or call the function manually).

**"Velocity embedding fails"**: Ensure `scv.tl.velocity_graph` ran successfully first — the graph is required for embedding. Try reducing `n_pcs` or `n_neighbors`.

**Memory issues**: Reduce `n_top_genes` (2000 → 1000), use fewer PCs, or pre-filter cells to a manageable size.
