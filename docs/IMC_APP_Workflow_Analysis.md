# HYScience IMC/PCF Analysis App — Complete Workflow Analysis

## Overview

**HYScience** is a Shiny R web application for IMC (Imaging Mass Cytometry) and PCF (proteomics) spatial protein data analysis. It runs as a `shiny::shinyApp(ui, server)` with a custom glassmorphism HTML/CSS theme (no shinydashboard dependency). The app supports both **IMC** (single-cell mass cytometry imaging) and **PCF** (pixel-classification) project types, with data loaded either from the Steinbock pipeline or pre-saved RDS files.

**Architecture**: `app.R` → `ui.R` + `server.R` → 30+ modular UI/server pairs under `modules/` → ~100+ analysis scripts under `scripts/` → helper functions under `helpers/`.

---

## Complete R Package Inventory & Python Equivalents

### Core Biology/Imaging Packages

| R Package                | Purpose                                                                                                         | Python Equivalent                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **SpatialExperiment**    | Spatial single-cell container (extending SingleCellExperiment)                                                  | `spatialdata` + `SpatialData`                      |
| **imcRtools**            | IMC-specific tools: spillover correction, patchDetection, minDistToCells, aggregateNeighbors, buildSpatialGraph | `imcRtools` logic via `scipy.spatial` + `networkx` |
| **cytomapper**           | Multi-channel image visualization, plotPixels, normalize images                                                 | `napari` + `skimage`                               |
| **CATALYST**             | Mass cytometry: spillover compensation, isotope_list, debarcoding                                               | `cytomulate` / custom numpy                        |
| **FlowSOM**              | Self-organizing map clustering for cytometry                                                                    | `FlowSOM` (Python port: `flowsom` pip)             |
| **SingleCellExperiment** | Base single-cell container                                                                                      | `anndata` / `AnnData`                              |
| **scater/scuttle/scran** | Single-cell normalization, QC metrics                                                                           | `scanpy`                                           |

### Dimensionality Reduction & Batch Correction

| R Package           | Purpose                  | Python Equivalent                                |
| ------------------- | ------------------------ | ------------------------------------------------ |
| **batchelor**       | fastMNN batch correction | `scanpy.external.pp.mnn_correct` / `scvi-tools`  |
| **scater::runUMAP** | UMAP embedding           | `scanpy.tl.umap` / `umap-learn`                  |
| **BiocSingular**    | Exact SVD for fastMNN    | `scipy.linalg.svd` / `sklearn.decomposition.PCA` |

### Clustering

| R Package   | Purpose                                                 | Python Equivalent                                       |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------- |
| **bluster** | SNNGraphParam, clusterSweep, silhouette, neighborPurity | `scanpy.tl.leiden` + `sklearn.metrics.silhouette_score` |
| **igraph**  | Graph clustering backend                                | `networkx` / `igraph` (python-igraph)                   |

### Cell-Cell Interaction

| R Package                         | Purpose                                                         | Python Equivalent                              |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| **imcRtools::testInteractions**   | Permutation-based cell-cell interaction testing (binomial test) | `squidpy.gr.spatial_neighbors` + `scipy.stats` |
| **imcRtools::aggregateNeighbors** | Neighborhood composition                                        | Custom with `scipy.spatial.cKDTree`            |
| **imcRtools::minDistToCells**     | Distance to nearest cell of target type                         | `scipy.spatial.distance.cdist`                 |
| **imcRtools::buildSpatialGraph**  | kNN / expansion graph on spatial coordinates                    | `squidpy.gr.spatial_neighbors`                 |

### Spatial Patch Analysis

| R Package                     | Purpose                                  | Python Equivalent                               |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------- |
| **imcRtools::patchDetection** | Detect contiguous patches of a cell type | `scipy.ndimage.label` + `skimage.measure.label` |
| **imcRtools::patchSize**      | Compute patch areas                      | `skimage.measure.regionprops`                   |

### Visualization

| R Package             | Purpose                                                           | Python Equivalent                      |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| **ggplot2**           | Grammar of graphics                                               | `plotnine` / `seaborn` / `matplotlib`  |
| **dittoSeq**          | Single-cell visualization helper (dittoDimPlot, dittoScatterPlot) | `scanpy.pl` functions                  |
| **ComplexHeatmap**    | Advanced heatmaps                                                 | `seaborn.clustermap` / `plotly`        |
| **patchwork/cowplot** | Plot composition                                                  | `matplotlib.gridspec` / `plt.subplots` |
| **ggridges**          | Ridge plots                                                       | `seaborn` (joyplot-style)              |
| **ggpubr**            | Statistical annotation (stat_compare_means)                       | `scipy.stats` + manual annotation      |
| **viridis**           | Colorblind-friendly palettes                                      | `matplotlib.cm.viridis`                |
| **ggnewscale**        | Multiple fill scales in one ggplot                                | Multiple axes in matplotlib            |
| **ggforce**           | Extended ggplot geometries                                        | `matplotlib` patches                   |
| **ggsci**             | Scientific journal palettes                                       | Manual color palettes                  |
| **corrplot**          | Correlation visualization                                         | `seaborn.heatmap`                      |

### Data Manipulation

| R Package                                              | Purpose            | Python Equivalent            |
| ------------------------------------------------------ | ------------------ | ---------------------------- |
| **tidyverse (dplyr/tidyr/purrr/readr/ggplot2/tibble)** | Data wrangling     | `pandas` + `numpy`           |
| **BiocParallel**                                       | Parallel computing | `multiprocessing` / `joblib` |
| **foreach/doParallel**                                 | Parallel for loops | `concurrent.futures`         |
| **future/promises**                                    | Async in Shiny     | `asyncio`                    |

### UI (R-specific)

| R Package             | Purpose             |
| --------------------- | ------------------- |
| **shiny**             | Web framework       |
| **shinyjs**           | JS integration      |
| **shinyWidgets**      | Advanced inputs     |
| **DT**                | Interactive tables  |
| **sortable**          | Drag-and-drop       |
| **shinyFiles**        | File system browser |
| **showtext/sysfonts** | Custom fonts        |

---

## Analysis Workflow Stage by Stage

### STAGE 0: Data Loading & Preprocessing

**Scripts**: `helpers/data_loading_pipelines.R`, `modules/data_loading_server.R`, `modules/raw_data_proc_server.R`

#### 0.1 Steinbock Pipeline Load

```
Input: steinbock/ directory with:
  - intensities/  (CSV pixel intensities)
  - regionprops/  (CSV cell measurements)
  - panel.csv     (channel metadata)
  - images.csv    (image metadata)
  - img/          (multi-channel TIFF images)
  - masks_deepcell/ or masks/ (single-channel segmentation masks)
```

**Algorithm**:

1. `read_steinbock("data/")` → `SpatialExperiment` object with `counts` assay
2. Filter empty cells: `spe <- spe[, colSums(counts(spe)) > 0]`
3. Set colnames to `{sample_id}_{ObjectNumber}`, rownames to sanitized marker names
4. Add `rowData(spe)$use_channel` = logical excluding DNA/Histone channels
5. Transform: `assay(spe, "exprs") <- asinh(counts(spe)/1)` (cofactor=1 for IMC, =5 for PCF)
6. Merge `images.csv` metadata (batch_id from source_file.mcd, acquisition_description/roi) into colData
7. Load multi-channel images: `loadImages("data/img/")` → `CytoImageList`
8. Load masks: `loadImages("data/masks_deepcell/", as.is=TRUE)` → `CytoImageList`
9. Align image/mask names with acquisition_description from images.csv

**Input Format**: Steinbock output directory
**Output**: `SpatialExperiment` (spe) + `CytoImageList` (images) + `CytoImageList` (masks)
**Key R Packages**: SpatialExperiment, imcRtools, cytomapper, scuttle

#### 0.2 RDS File Load

Load pre-saved RDS files (either a list `{spe, masks, images}` or a single `SpatialExperiment` object).

---

### STAGE 1: QC (Quality Control)

**Scripts**: `scripts/QC_plotPixels.R`, `scripts/QC_plotPixels_all_marker.R`, `scripts/F01_4_cell_area.R`

#### 1.1 Pixel QC Visualization (`QC_plotPixels`)

**Function**: `QC_plotPixels(obj_images, QC_path)`

**Algorithm**:

1. Sanitize channel names: replace `[- /]` with `_`
2. Adaptive sampling of images:
   - If total ≤ 15 images → use all
   - If 10% < 15 → use 15 images
   - Else → use 10% of images
3. For each sampled image:
   - Normalize each channel to [0, 1] range (`separateImages=TRUE`)
   - Clip to [0, 0.2] to suppress noise
   - Auto-select display channel: DAPI > DNA1 > first channel
   - `plotPixels` with cell mask overlay, black→blue gradient, white background
4. Save as PDF per image

**Input**: `CytoImageList` + masks
**Output**: PDF files in `QC_path/plotPixels/`
**Key R Packages**: cytomapper

**Python Equivalent**:

- Image normalization: `skimage.exposure.rescale_intensity`
- Mask overlay: `matplotlib` + `skimage.segmentation.mark_boundaries`

#### 1.2 All-Marker Pixel QC (`QC_plotPixels_all_marker`)

Same as above but iterates over **all channels** per image (not just DNA). Used for comprehensive marker QC.

#### 1.3 Cell Area Filter (`cell_area`)

**Function**: `cell_area(spe, QC_path, area_size1, area_size2)`

**Algorithm**:

1. Plot cell area distribution (histogram) per sample
2. Filter cells: keep those with area ∈ [area_size1, area_size2] (default [5, 3000] pixels²)
3. Return filtered `spe`

**Python Equivalent**: `scanpy.pp.filter_cells` with area column / manual boolean indexing

---

### STAGE 2: Batch Correction & Dimensionality Reduction

**Scripts**: `scripts/F01_2_QC_UMAP_immune.R`, `scripts/F01_2_QC_UMAP.R`

#### 2.1 Batch Correction + UMAP (`QC_UMAP`)

**Function**: `QC_UMAP(spe, dir_save, fastMNN_d, sample_frac, batch_var, n_cores)`

**Algorithm**:

1. Downsample cells to `sample_frac` fraction for computational efficiency
2. **Uncorrected UMAP**: `runUMAP(spe_sub, exprs_values="zscore", subset_row=use_channel)` on immune channels
3. **fastMNN batch correction**:
   - `fastMNN(spe, batch=batch_var, d=fastMNN_d, subset.row=use_channel_immune, BSPARAM=ExactParam())`
   - Stores result in `reducedDim(spe, "fastMNN")`
4. **Corrected UMAP**: `runUMAP(spe_sampled, dimred="fastMNN")` → `reducedDim(spe, "UMAP_mnnCorrected")`
5. Side-by-side before/after visualizations: `dittoDimPlot` colored by batch variable
6. Save PDFs with and without legends

**Rationale**: fastMNN (Mutual Nearest Neighbors) aligns cells from different experimental batches in a shared low-dimensional space, removing technical variation while preserving biological signal. It uses the SVD of MNN pairs to compute correction vectors.

**Input**: `SpatialExperiment` with `zscore` assay and `use_channel/use_channel_immune` rowData flags
**Output**: SPE with `fastMNN`, `UMAP_mnnCorrected` reducedDims; before/after PDFs
**Key R Packages**: batchelor, scater, BiocSingular, dittoSeq, patchwork

**Python Equivalent**:

- fastMNN: `scanpy.external.pp.mnn_correct()` or `scvi-tools` (scVI)
- UMAP: `scanpy.tl.umap()` / `umap-learn`
- Visualization: `scanpy.pl.umap(color=batch_var)`

---

### STAGE 3: Clustering

**Scripts**: `scripts/F01_3_cluster.R`, `scripts/02_cluster_result_NoGroup_select_marker.R`

#### 3.1 Cluster Parameter Sweep (`SNN`)

**Function**: `SNN(object, k, type, dir_save, n_cores, seed)`

**Algorithm** (in `F01_3_cluster.R`):

1. Extract `fastMNN` corrected embeddings as the clustering matrix
2. `clusterSweep(mat, BLUSPARAM=SNNGraphParam(), k=c(20,30), type="rank", cluster.fun="louvain")`
   - Tests combinations of k (nearest neighbors) and type (rank/jaccard)
3. For each combination, compute:
   - **Average silhouette width** via `approxSilhouette(mat, clusters)`: measures cluster separation
   - **Neighborhood purity** via `neighborPurity(mat, clusters)`: measures local cluster consistency
4. Plot and save evaluation metrics → user selects best parameters

**Python Equivalent**:

- `scanpy.tl.leiden(neighbors_key, resolution=...)` with parameter sweep
- `sklearn.metrics.silhouette_score`
- Neighborhood purity: custom implementation

#### 3.2 Final Clustering (`02_cluster_result_NoGroup_select_marker.R`)

**Function**: Executes the full clustering + visualization pipeline

**Algorithm**:

1. `clusterCells(spe, assay.type="exprs", use.dimred="fastMNN", BLUSPARAM=SNNGraphParam(k=20, type="rank", cluster.fun="louvain"))`
2. Store cluster assignments in `spe$nn_clusters`
3. Assign 72+ color palette via `metadata(spe)$color_vectors$nn_clusters`

**Post-clustering outputs**:

- **UMAP by cluster**: `dittoDimPlot(spe, var="nn_clusters")` with cluster labels
- **Feature plots**: One UMAP per marker, colored by expression
- **Heatmaps**:
  - Raw expression mean per cluster
  - Percentile-normalized (95th, 99th) expression
  - Z-score transformed expression
  - All via `ComplexHeatmap::Heatmap`
- **Ridge plots**: Marker expression distributions per cluster/group
- **Cell frequency bar plots** per sample/cluster

**Key R Packages**: bluster (SNNGraphParam), scran/scater, ComplexHeatmap, dittoSeq, ggridges, patchwork

---

### STAGE 4: Cellular Neighborhood (CN/Niche) Analysis

**Scripts**: `scripts/F03_5_CN.R`, `scripts/F03_5_density_boxplot_add0.R`, `scripts/F03_5_CN_group_heatmap.R`, `scripts/F03_5_CN_boxplot_sig.R`, `scripts/F03_5_CN_bar.R`, `scripts/F03_5_CN_SC.R`, `scripts/F03_5_CN_cluster_freq_bar.R`

#### 4.1 CN Computation (`CN_result`)

**Function**: `CN_result(object, c, seed, type, k)`

**Algorithm**:

1. **Build spatial kNN graph**: `buildSpatialGraph(object, img_id="sample_id", type="knn", k=k_num, max_dist=50)`
   - For each cell, find k nearest neighbors within 50-pixel radius
2. **Aggregate neighbors**: `aggregateNeighbors(object, colPairName="knn_interaction_graph", aggregate_by="metadata", count_by="celltype")`
   - For each cell, compute the fraction of each cell type among its k neighbors
   - Result: each cell has a vector of celltype proportions in its local neighborhood
3. **K-means clustering**: `kmeans(object$aggregatedNeighbors, centers=c)`
   - Cluster cells based on their neighborhood composition vectors
   - k = user-specified number of niches (typically 5-20)
4. **Label niches**: `object$CN <- factor(paste0("Niche", cn_1$cluster))`

**Rationale**: Cellular neighborhoods (CNs) are defined by the local composition of cell types. K-means on the neighbor composition vector groups cells that share similar microenvironments — e.g., "immunosuppressive niche" (Tregs + Macrophages), "tumor-stroma interface", etc.

**Key R Packages**: imcRtools, stats (kmeans)

**Python Equivalent**:

```python
from sklearn.neighbors import NearestNeighbors
from sklearn.cluster import KMeans
# Build kNN
nbrs = NearestNeighbors(n_neighbors=k, radius=50).fit(coords)
# Aggregate neighbor cell types → composition matrix
# K-means on composition
kmeans = KMeans(n_clusters=c).fit(composition_matrix)
```

#### 4.2 CN Visualization

- **Spatial scatter**: `plotSpatial(object, node_color_by="CN")` → cells colored by niche membership
- **Faceted spatial plots**: `ggplot2` with `facet_wrap(~sample_id)`, 6-column grid
- **CN-celltype heatmap**: `prop.table(table(CN, celltype), margin=1)` → `ComplexHeatmap::Heatmap`
  - Row-normalized: each CN row sums to 1 (celltype composition)
  - Z-score variant also generated
  - Hierarchical clustering on rows and columns
- **CN frequency boxplots**: Per niche, per group; Wilcoxon rank-sum tests with significance stars; paired design support

---

### STAGE 5: Cell Type Density & Frequency Analysis

**Scripts**: `scripts/F03_5_density_boxplot_add0.R`, `scripts/F03_2_density_bar.R`, `scripts/F03_2_freq_bar.R`, `scripts/F03_3_freq_point.R`

#### 5.1 Density Boxplot (`density_boxplot_add0`)

**Function**: `density_boxplot_add0(object, meta_df, group_info, groups_to_analyze, freq_dir, ...)`

**Algorithm**:

1. Extract `width_px` and `height_px` per sample from colData
2. Compute sample area: `sample_area = (width_px/1000) * (height_px/1000)` → mm²
3. Count cells per sample per celltype (including zeros via `complete()`)
4. Compute density: `density = n_cells / sample_area` → cells/mm²
5. Per celltype × per group variable:
   - Boxplot with jittered points
   - **Paired design support**: detect `{group_var}_paired_id` column, add connecting lines, use paired Wilcoxon
   - Statistical test: Wilcoxon rank-sum (or t.test), configurable
   - Significance annotation: `ggpubr::stat_compare_means`
6. Combined multi-panel plot via `patchwork::wrap_plots`

**Python Equivalent**: `pandas.groupby` + `seaborn.boxplot` + `scipy.stats.mannwhitneyu` / `scipy.stats.wilcoxon`

---

### STAGE 6: Cell-Cell Interaction Analysis

**Scripts**: `scripts/F03_6_Interaction_total.R`, `scripts/F03_7_Interaction_group.R`, `scripts/F03_8_Interaction_ct_vs.R`, `scripts/F03_9_Interaction_sig_vs.R`, `modules/interaction_calc_server.R`

#### 6.1 Interaction Testing

The interaction analysis uses `imcRtools::testInteractions()` which performs a **permutation-based binomial test**:

**Core Algorithm**:

1. For each sample, build a spatial graph connecting neighboring cells (kNN or expansion graph)
2. For each pair of cell types (A, B):
   - Count observed interactions (A-B edges in the graph)
   - Permute cell type labels N times (e.g., 1000)
   - Count interactions in permuted graphs
   - Test: is the observed count significantly different from the null distribution?
   - Output: `sigval` = (obs - expected) / expected → positive=attraction, negative=avoidance
   - Output: `ct` = number of observed interactions (count)

#### 6.2 Signal Aggregation (`summed_sigvals`)

**Function**: `summed_sigvals(out, object)`

**Algorithm**:

1. Group interaction results by `(from_label, to_label)` pair
2. Compute: `sum_sigval = sum(sigval)` across all ROIs
3. Compute: `roi_sum = n()` (number of ROIs with this interaction)
4. Normalize: `norm_sigval = sum_sigval / roi_sum`
5. Classify: `Interaction_type` ∈ {Interaction (>0), Avoidance (<0), no_Interaction (=0)}
6. Compute: `mean_counts = sum(ct) / roi_sum`

**Visualization**: Bubble plot — `ggplot2::geom_point` with:

- Size ∝ |norm_sigval| (interaction strength)
- Color: orange=Interaction, purple=Avoidance
- Grid: celltype × celltype matrix

#### 6.3 Group Comparison (`ct_vs`)

**Function**: `ct_vs(out_with_groups, object, group_var, I_group_dir)`

**Algorithm**:

1. For each pair of group levels (e.g., Treatment vs Control):
2. Filter interaction data to those two groups
3. **Wilcoxon rank-sum test** per (from_label, to_label) on interaction counts (`ct`)
4. Build heatmap-like plot with **split triangles**:
   - Upper triangle: Group A interaction counts (gradient fill)
   - Lower triangle: Group B interaction counts (gradient fill)
5. Overlay significance stars (`, p<0.05; *, p<0.01; **, p<0.001; ***`)
6. Separate color scales per triangle using `ggnewscale::new_scale_fill()`

**Python Equivalent**:

- Interaction testing: `squidpy.gr.spatial_neighbors` + `squidpy.gr.nhood_enrichment` or custom permutation
- Statistical comparison: `scipy.stats.mannwhitneyu`

---

### STAGE 7: Spatial Patch (Tumor Nest) Analysis

**Scripts**: `scripts/patch_main.R`, `scripts/patch_spatial.R`, `scripts/patch_density_by_sample.R`, `scripts/patch_density_by_sample_border.R`, `scripts/patch_density_by_sample_out_patch100.R`, `scripts/patch_ridge.R`, `scripts/patch_boundary_plotcells.R`, `scripts/patch_spatial_line_inpatch.R`, `scripts/patch_spatial_line_patch50.R`

#### 7.1 Patch Detection (`patch_main.R`)

**Function**: Executes the full spatial patch analysis pipeline

**Algorithm**:

1. **Define patch cells**: Create `celltype_patch` column — typically "Tumor" cells are the "patch cells", all others are "immune"
2. **Build spatial graph**: `buildSpatialGraph(spe, img_id="sample_id", type="expansion", threshold=50)`
   - Connect cells within 50-pixel radius
3. **Detect patches**: `patchDetection(spe, patch_cells=spe$celltype_patch=="Tumor", expand_by=1, min_patch_size=5, colPairName="expansion_interaction_graph")`
   - Identifies contiguous regions ("patches" / "nests") of Tumor cells
   - `expand_by=1`: dilate the patch by 1 layer for detection
   - `min_patch_size=5`: ignore patches with < 5 cells
   - Assign each cell a `patch_id` (NA for non-patch cells)
4. **Compute patch size**: `patchSize(spe, "patch_id")` → area per patch
5. **Expand patches**: Run `patchDetection` with `expand_by=50` and `expand_by=100` to create buffer zones
   - `expand_by=50`: 50-pixel buffer around the tumor core
   - `expand_by=100`: 100-pixel buffer
6. **Border zone analysis**:
   - Zone 1: `patch_id` (core tumor, expand_by=1)
   - Zone 2: in `expand50` but not in core → "border 1-50"
   - Zone 3: in `expand100` but not in `expand50` → "border 50-100"
   - Zone 4: outside `expand100` → "out_patch" / "100+"
7. **Density by border zone**: For each immune celltype, compute density (cells/mm²) in each zone, group-comparison boxplots

**Python Equivalent**:

```python
from scipy.ndimage import label, binary_dilation
# Patch detection on a grid: label tumor regions
# expand_by: dilate with structure element of radius=expand_by
# min_patch_size: filter labels by region area
```

#### 7.2 Distance Analysis

**Function**: `patch_ridge` in `scripts/patch_ridge.R`

**Algorithm**:

1. `minDistToCells(spe, x_cells=!is.na(spe$patch_id))` → distance from each cell to nearest tumor patch cell
2. Ridge plots per immune celltype, split by group → immune infiltration gradients

#### 7.3 Patch Spatial Visualization

- **Spatial plots**: `plotSpatial(spe, node_color_by="patch_id")` with random colors
- **Grouped spatial plots**: faceted by experimental groups
- **Celltype-in-patch spatial lines**: Plot spatial coordinates colored by celltype, with arrows/lines connecting immune cells to nearest tumor patch

#### 7.4 Patch Size Comparison

- Boxplot: patch area distribution per group
- Sum patch area per sample per group

**Output files**:

```
result/patch/
├── 1.Spatial plot/
├── 2.patch size boxplot/
├── 3.patch expend 1-50 density/
├── 4.patch expend 50-100 density/
├── 5.patch expend 100+ density/
├── 6.distToCells_ridges/
├── 7.boundary_plotcells/
├── 8.spatial line in patch/
└── 9.spatial line in patch expand1-50/
```

**Key R Packages**: imcRtools, cytomapper, ggplot2, ggridges, ggpubr, viridis, RColorBrewer

---

### STAGE 8: Spillover Correction

**Scripts**: `scripts/F01_1_spillover_correction.R`, `scripts/compensation2.R`

#### 8.1 Spillover Correction (`compensation`)

**Function**: `compensation(object, images, masks, sce, comp_result, minevents, panel_info)`

**Algorithm**:

1. Read single-metal calibration data: `readSCEfromTXT("data/compensation/")`
2. Transform: `assay(sce, "exprs") <- asinh(counts(sce)/5)`
3. Optionally bin pixels: `binAcrossPixels(sce, bin_size=10)` for weak signals
4. **Debarcode**: `assignPrelim` → `estCutoffs` → `applyCutoffs` → `filterPixels(minevents=40)`
   - Assign each pixel to a mass tag based on barcode signal
   - Filter out pixels with ambiguous barcode assignment
5. **Compute spillover matrix**: `computeSpillmat(sce, interactions="all", method="classic", trim=0.3)`
   - Measures signal leakage between channels using the single-metal calibration data
   - Uses trimmed mean to be robust to outliers
6. **Apply to single-cell data**: `compCytof(spe, sm, transform=TRUE, cofactor=1, isotope_list)`
   - Compensate the single-cell expression matrix
   - Replace `counts` and `exprs` assays with compensated versions
7. **Apply to images**:
   - `adaptSpillmat(sm_matrix, channelNames(images), isotope_list)` → adapt matrix to available channels
   - `compImage(images, adapted_sm)` → compensate individual pixels in multi-channel images (multicore)

**Rationale**: In mass cytometry, signal from one metal isotope can "spill over" into adjacent mass channels. A compensation matrix, computed from single-metal calibration beads, mathematically removes this spillover.

**Key R Packages**: CATALYST, imcRtools, cytomapper

**Python Equivalent**:

- CATALYST's `compCytof` logic → custom numpy matrix multiplication
- `computeSpillmat` → linear regression on calibration data
- `compImage` → numpy element-wise matrix multiplication on image arrays

---

### STAGE 9: Additional Analyses

#### 9.1 Cell Classification (Label Transfer)

**Scripts**: `scripts/Train_classifier.R`, `modules/cell_classify_server.R`

- Train classifier on annotated reference data
- Predict cell types on new datasets
- Cross-validation performance metrics

#### 9.2 Survival Analysis

**Scripts**: `scripts/surv_hd.R`

- Cox proportional hazards models linking cell type proportions/densities to survival outcomes

#### 9.3 Correlation Analysis

**Scripts**: `scripts/corr.R`, `modules/correlation_server.R`

- Marker-marker correlation matrices
- Cell type frequency correlations

#### 9.4 Forest Plot (Odds Ratios)

**Scripts**: `scripts/forestplot_OR.R`, `scripts/forestplot_patch_density_OR.R`

- Odds ratios for patch density / cell type frequency across groups

#### 9.5 Fold Change Heatmap

**Scripts**: `scripts/Fold Change Heatmap.R`

- Log2 fold change in cell type density between groups as heatmap

#### 9.6 Reclustering

**Scripts**: `scripts/recluster_celltype.R`

- Subset cells of a specific type, re-run clustering for finer subpopulations

#### 9.7 Pixel Filtering & Enhancement

**Scripts**: `scripts/marker_filter.R`, `modules/pixel_filter_v2_server.R`, `modules/pixel_enhance_server.R`

- Interactive threshold-based filtering of marker expression at the pixel level
- Brightness/gamma enhancement for image visualization

---

## Data Structure: SpatialExperiment (SPE)

The central data object is a `SpatialExperiment`, an extension of `SingleCellExperiment` that adds spatial coordinates:

```
SpatialExperiment
├── assays: counts, exprs (asinh-transformed), zscore
├── rowData: channel names, use_channel (logical), cluster_channel, channel_name
├── colData:
│   ├── sample_id (sample/ROI ID)
│   ├── ObjectNumber (cell ID within sample)
│   ├── celltype (assigned cell type)
│   ├── nn_clusters (SNN/Louvain cluster ID)
│   ├── CN (Cellular Niche ID)
│   ├── patch_id (tumor patch identifier)
│   ├── patch_size (patch area)
│   ├── width_px, height_px (ROI dimensions)
│   ├── Group_* (experimental group columns)
│   └── distToCells (distance to target cells)
├── spatialCoords: x, y pixel coordinates per cell
├── reducedDims: UMAP, fastMNN, UMAP_mnnCorrected
├── colPairs: knn_interaction_graph, expansion_interaction_graph
├── metadata:
│   ├── color_vectors: color maps for each categorical variable
│   ├── aggregatedNeighbors: neighborhood composition matrix
│   └── spillover_matrix: compensation matrix
└── images: loaded as separate CytoImageList objects
```

---

## Complete Analysis Pipeline Summary

```
Raw Data (.mcd / .tiff / Steinbock)
    │
    ▼
[0. Data Loading] ─── read_steinbock / readRDS
    │
    ▼
[1. QC] ─── pixel visualization, cell area filter
    │
    ▼
[2. Spillover Correction] ─── CATALYST compensation (optional)
    │
    ▼
[3. Batch Correction] ─── fastMNN → UMAP
    │
    ▼
[4. Clustering] ─── SNN/Louvain parameter sweep → final clustering
    │
    ▼
[5. Celltype Annotation] ─── manual / classifier-based
    │
    ├────────────────────┬─────────────────────┬──────────────────┐
    ▼                    ▼                      ▼                  ▼
[6. CN/Niche]      [7. Interactions]    [8. Patch Analysis]  [9. Statistics]
 kNN graph →        testInteractions →   patchDetection →    density boxplots
 aggregateNeighbors summed_sigvals       expand borders      freq bars
 k-means → CN      ct_vs comparison     distToCells         survival analysis

    │                    │                      │                  │
    ▼                    ▼                      ▼                  ▼
[10. Visualization] ─── UMAP, heatmaps, ridge plots, spatial plots, bar/pie/box/violin
```

---

## Key Algorithm Details

### 1. fastMNN Batch Correction

- **Method**: Mutual Nearest Neighbors (MNN)
- **Steps**: (a) Find MNN pairs between batches, (b) Compute correction vectors from pair differences, (c) Smooth correction vectors via Gaussian kernel, (d) Apply to all cells
- **Parameters**: `d=30` (output dimensions), `auto.merge=TRUE`, `BSPARAM=ExactParam()`

### 2. SNN + Louvain Clustering

- **Method**: Shared Nearest Neighbor graph + Louvain community detection
- **Parameters**: `k=20` (neighbors), `type="rank"` (SNN edge weighting)
- **Evaluation**: silhouette width + neighborhood purity sweep

### 3. Cellular Neighborhood (K-means on neighbor composition)

- **Input**: Per-cell vector of celltype proportions among k nearest neighbors
- **K-means**: `kmeans(centers=c)` where c is user-defined number of niches
- **Distance**: Euclidean on composition vector

### 4. Patch Detection

- **Method**: Connected components on spatial adjacency graph of same-type cells
- **Parameters**: `expand_by=1` (dilation to merge nearby patches), `min_patch_size=5`
- **Border analysis**: Multi-level buffer zones (1-50px, 50-100px, 100+px)

### 5. Cell-Cell Interaction Testing

- **Method**: Permutation-based binomial test via `imcRtools::testInteractions`
- **Output per pair**: `sigval` (enrichment/depletion), `ct` (raw count), `p.val`
- **Comparison**: Wilcoxon test on interaction counts across experimental groups

---

## R Package Dependency Summary

### Critical (core functionality):

SpatialExperiment, imcRtools, cytomapper, CATALYST, batchelor, bluster, scater, scuttle, scran, SingleCellExperiment, BiocParallel

### Visualization:

ggplot2, dittoSeq, ComplexHeatmap, patchwork, cowplot, viridis, ggridges, ggpubr, ggnewscale, ggforce, ggsci, corrplot, RColorBrewer, circlize, scales

### Data Wrangling:

tidyverse (dplyr, tidyr, purrr, readr, tibble, stringr, forcats, ggplot2), data.table

### UI/App:

shiny, shinyjs, shinyWidgets, shinyFiles, DT, sortable, showtext, sysfonts, htmlwidgets

### Parallel/Async:

BiocParallel, foreach, doParallel, future, promises

### Statistics:

stats (base R), psych, igraph, randomcoloR, colorspace

---

## Python Migration Path

For porting to Python, the recommended stack:

| Component                | Python Library                                                          |
| ------------------------ | ----------------------------------------------------------------------- |
| Data container           | `spatialdata` + `AnnData` (via `anndata`)                               |
| Image I/O                | `tifffile`, `skimage.io`                                                |
| Spatial graphs           | `squidpy.gr.spatial_neighbors`                                          |
| Batch correction         | `scanpy.external.pp.mnn_correct` or `scvi-tools`                        |
| Clustering               | `scanpy.tl.leiden` (Leiden algorithm)                                   |
| Dimensionality reduction | `scanpy.tl.umap`, `scanpy.tl.pca`                                       |
| Niche analysis           | Custom: `sklearn.cluster.KMeans` + `sklearn.neighbors.NearestNeighbors` |
| Patch detection          | `scipy.ndimage.label` + `skimage.measure.regionprops`                   |
| Interaction testing      | `squidpy.gr.nhood_enrichment` + custom permutation                      |
| Statistical tests        | `scipy.stats` (mannwhitneyu, wilcoxon, ttest_ind)                       |
| Visualization            | `matplotlib` + `seaborn` + `scanpy.pl`                                  |
| Web framework            | `Streamlit` / `Dash` / `Panel`                                          |

### Key Migration Challenges:

1. **SpatialExperiment → AnnData**: SpatialExperiment stores spatialCoords and colPairs (graphs) natively. AnnData requires `obsm['spatial']` for coordinates and `obsp` for spatial graphs.
2. **fastMNN**: The R implementation uses exact SVD with BiocSingular. Python's `mnn_correct` in scanpy is functionally equivalent but may have subtle differences.
3. **CytoImageList**: No direct Python equivalent. Use numpy arrays + metadata.
4. **Spillover compensation**: No off-the-shelf Python equivalent for CATALYST's full pipeline. Must implement debarcoding, spillover matrix computation, and compensation from scratch.
5. **ComplexHeatmap**: `seaborn.clustermap` provides similar functionality but with fewer options.
6. **BiocParallel/multicore**: Python's `multiprocessing` or `joblib` with careful memory management (R's fork-based parallelism is simpler for read-heavy workloads).
