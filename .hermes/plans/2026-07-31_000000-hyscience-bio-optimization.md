# HYscience 1.0 — 高级生物分析平台优化计划

> **For Hermes:** 使用 subagent-driven-development skill 按任务逐步实现。

**Goal:** 将 HYscience 1.0 升级为单细胞测序、空间转录组、IMC/PCF 蛋白技术的一站式分析平台，让生物医学科研工作者更轻松、便捷、准确地进行多组学研究。

**Architecture:** 在现有 skill + connector + kernel 架构基础上，补充 3 大平台专用 skills（单细胞进阶、空间组学、蛋白组学），新增科学数据库 connectors，打造预置分析模板（pipeline templates），并增强前端科学渲染能力（空间热力图、蛋白互作网络）。

**Tech Stack:** TypeScript + Bun (backend), Python (kernel/skills), SolidJS (frontend). 现有依赖：scanpy, scvi-tools, anndata, pydeseq2.

---

## 现状分析

### 已有优势

- scanpy skill（QC、降维、聚类、可视化）
- scvi-tools skill（深度生成模型、批次校正、多模态集成）
- pydeseq2 skill（差异表达分析）
- 流式细胞术 & 免疫学 assays skills
- Omics connectors：GTEx, HPA, GEO, Expression Atlas, DepMap, Single Cell Atlas
- Science 渲染器：分子结构、基因组轨道、图像
- Biology agent 专家模式

### 关键缺失

| 领域             | 缺失内容                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| **单细胞进阶**   | RNA velocity (scVelo), cell-cell communication (CellChat), regulons (SCENIC+), multi-sample integration |
| **空间转录组**   | squidpy, spatial alignment, deconvolution, niche analysis, 空间可视化                                   |
| **IMC/PCF 蛋白** | IMC 数据分析管道，steinbock, imcRtools, 蛋白空间互作分析                                                |
| **自动管道**     | 预置分析模板（一键式 QC → 聚类 → 注释 → 差异分析）                                                      |
| **可视化增强**   | 空间热力图、蛋白共表达网络、交互式 UMAP                                                                 |

---

## 实施计划

### Phase 1: 单细胞测序进阶能力 (scAdvanced)

#### Task 1.1: scVelo — RNA Velocity 分析

**Objective:** 新增 scVelo skill，支持 RNA velocity 估计和可视化

**Files:**

- Create: `backend/cli/skills/biology/scvelo/SKILL.md`
- Create: `backend/cli/skills/biology/scvelo/scripts/compute_velocity.py`
- Create: `backend/cli/skills/biology/scvelo/scripts/velocity_pseudotime.py`

**Step 1:** 创建 SKILL.md，包含 scVelo 依赖（scvelo>=1.0）、使用场景（RNA velocity、pseudotime、latent time）、完整 API 参考
**Step 2:** 编写 `compute_velocity.py` — 从 loom/spliced-unspliced 层提取、velocity 计算、embedding 投影
**Step 3:** 编写 `velocity_pseudotime.py` — 基于 velocity 的 pseudotime 推断、PAGA 图构建
**Step 4:** 在 frontend/src/science/renderers/genomics 中新增 velocity stream 组件

#### Task 1.2: CellChat — 细胞通讯分析

**Objective:** 新增 CellChat skill，解析细胞间配体-受体互作

**Files:**

- Create: `backend/cli/skills/biology/cellchat/SKILL.md`
- Create: `backend/cli/skills/biology/cellchat/scripts/lr_analysis.py`
- Create: `backend/cli/skills/biology/cellchat/scripts/communication_network.py`

**Step 1:** SKILL.md 定义 CellChat 依赖（cellchat or liana-py）、输入/输出格式
**Step 2:** `lr_analysis.py` — 配体-受体对检测、统计显著性、跨细胞类型互作
**Step 3:** `communication_network.py` — 网络可视化、key signaling pathways 识别
**Step 4:** 前端新增 chord diagram 和 bubble plot 渲染组件

#### Task 1.3: SCENIC+ — 基因调控网络推断

**Objective:** 新增调控网络分析 skill，推断转录因子靶基因

**Files:**

- Create: `backend/cli/skills/biology/scenic/SKILL.md`
- Create: `backend/cli/skills/biology/scenic/scripts/run_scenic.py`

#### Task 1.4: 单细胞自动分析管道

**Objective:** 预置一键式分析模板，从原始数据到报告

**Files:**

- Create: `backend/cli/skills/biology/single-cell-pipelines/SKILL.md`
- Create: `backend/cli/skills/biology/single-cell-pipelines/templates/qc_cluster_annotate.py`
- Create: `backend/cli/skills/biology/single-cell-pipelines/templates/multi_sample_integration.py`
- Create: `backend/cli/skills/biology/single-cell-pipelines/templates/differential_analysis.py`

**Step 1:** `qc_cluster_annotate.py` — 输入 .h5ad → 自动 QC → PCA → UMAP → Leiden 聚类 → marker-based 注释
**Step 2:** `multi_sample_integration.py` — 多样本整合 (harmony/scVI/BBKNN)
**Step 3:** `differential_analysis.py` — 多条件差异分析 + volcano plot + pathway enrichment

---

### Phase 2: 空间转录组能力 (Spatial Transcriptomics)

#### Task 2.1: Squidpy — 空间组学分析

**Objective:** 新增 Squidpy skill，空间数据分析核心

**Files:**

- Create: `backend/cli/skills/biology/squidpy/SKILL.md`
- Create: `backend/cli/skills/biology/squidpy/scripts/spatial_qc.py`
- Create: `backend/cli/skills/biology/squidpy/scripts/neighborhood_analysis.py`
- Create: `backend/cli/skills/biology/squidpy/scripts/ligand_receptor_spatial.py`

**Step 1:** SKILL.md 含 squidpy 依赖、支持数据格式（Visium, MERFISH, Xenium, Slide-seq）
**Step 2:** `spatial_qc.py` — 空间 QC 指标、spot-wise 质量控制
**Step 3:** `neighborhood_analysis.py` — 空间邻域分析、niche 鉴定、moran's I
**Step 4:** `ligand_receptor_spatial.py` — 空间配体-受体互作（结合距离约束）

#### Task 2.2: 空间去卷积 & 整合

**Objective:** 支持空间数据细胞类型去卷积和跨模态整合

**Files:**

- Create: `backend/cli/skills/biology/spatial-deconv/SKILL.md`
- Create: `backend/cli/skills/biology/spatial-deconv/scripts/cell2location.py`
- Create: `backend/cli/skills/biology/spatial-deconv/scripts/spatial_alignment.py`

**Step 1:** `cell2location.py` — 用单细胞参考数据对空间 spots 进行细胞类型去卷积
**Step 2:** `spatial_alignment.py` — 多切片对齐、3D 重建辅助

#### Task 2.3: 空间可视化增强

**Objective:** 前端支持空间热力图、空间特征表达图

**Files:**

- Modify: `frontend/workspace/src/science/renderers/` — 新增 SpatialHeatmap 组件
- Create: `frontend/ui/src/components/spatial-viewer.tsx`

**Step 1:** SpatialHeatmap 组件 — 渲染 spots-based 的空间表达热力图
**Step 2:** 支持多通道叠加、交互式缩放、spot 点击信息

---

### Phase 3: IMC/PCF 蛋白技术平台 (Protein Imaging)

#### Task 3.1: IMC 数据分析

**Objective:** 新增 Imaging Mass Cytometry 分析 skill

**Files:**

- Create: `backend/cli/skills/biology/imc-analysis/SKILL.md`
- Create: `backend/cli/skills/biology/imc-analysis/scripts/imc_preprocess.py`
- Create: `backend/cli/skills/biology/imc-analysis/scripts/cell_segmentation.py`
- Create: `backend/cli/skills/biology/imc-analysis/scripts/spatial_protein_analysis.py`

**Step 1:** `imc_preprocess.py` — TIFF 读取、通道归一化、背景校正
**Step 2:** `cell_segmentation.py` — 基于 DNA 通道的核/细胞分割 (Cellpose, DeepCell)
**Step 3:** `spatial_protein_analysis.py` — 蛋白空间分布、微环境特征、细胞邻域分析

#### Task 3.2: PCF — Protein Correlation Fingerprinting

**Objective:** 支持 PCF 蛋白相关性指纹分析

**Files:**

- Create: `backend/cli/skills/biology/pcf-analysis/SKILL.md`
- Create: `backend/cli/skills/biology/pcf-analysis/scripts/protein_correlation.py`
- Create: `backend/cli/skills/biology/pcf-analysis/scripts/fingerprint_clustering.py`

**Step 1:** `protein_correlation.py` — 多通道蛋白相关矩阵、距离度量
**Step 2:** `fingerprint_clustering.py` — 指纹聚类、组织微环境分类

#### Task 3.3: 多平台蛋白数据整合

**Objective:** IMC/PCF/CODEX/MIBI 多平台统一分析框架

**Files:**

- Create: `backend/cli/skills/biology/spatial-proteomics/SKILL.md`
- Create: `backend/cli/skills/biology/spatial-proteomics/scripts/multi_platform_integration.py`

---

### Phase 4: 数据库和连接器扩展

#### Task 4.1: 空间转录组数据连接器

**Objective:** 连接空间组学公共数据库

**Files:**

- Create: `backend/cli/src/science/connectors/spatial/spatial-datasets.ts`
- Create: `backend/cli/src/science/connectors/spatial/index.ts`

**Step 1:** `spatial-datasets.ts` — 连接 SpatialDB、STOmicsDB、Spatial Transcriptomics Atlas
**Step 2:** 提供统一的搜索/下载接口（按组织、技术平台、物种过滤）

#### Task 4.2: 蛋白组学数据库连接器

**Objective:** 连接蛋白表达和互作数据库

**Files:**

- Create: `backend/cli/src/science/connectors/proteomics/cell-atlas.ts`
- Create: `backend/cli/src/science/connectors/proteomics/index.ts`

**Step 1:** `cell-atlas.ts` — 连接 HPA Protein Atlas（已有基础）、ProteinAtlas、IMC Data Portal

---

### Phase 5: Agent 和交互增强

#### Task 5.1: Multi-omics Agent Specialist

**Objective:** 新增 multi-omics 专家 agent 模式

**Files:**

- Modify: `backend/cli/src/agent/agent.ts` — 注册 multi-omics agent
- Create: `backend/cli/src/agent/prompts/multiomics.md`

**Step 1:** multi-omics agent 提示词 — 覆盖单细胞 + 空间 + 蛋白分析最佳实践
**Step 2:** 自动根据数据格式路由到对应 skills

#### Task 5.2: 交互式分析仪表板

**Objective:** 前端支持实时分析参数调整和可视化

**Files:**

- Create: `frontend/workspace/src/components/analysis-dashboard.tsx`
- Create: `frontend/workspace/src/science/renderers/volcano.tsx`
- Create: `frontend/workspace/src/science/renderers/spatial-heatmap.tsx`

---

## 文件变更汇总

| Phase              | 新增文件数 | 修改文件数 |
| ------------------ | ---------- | ---------- |
| Phase 1 (单细胞)   | 8          | 1          |
| Phase 2 (空间)     | 6          | 2          |
| Phase 3 (蛋白)     | 7          | 0          |
| Phase 4 (数据库)   | 4          | 0          |
| Phase 5 (Agent/UI) | 4          | 1          |
| **总计**           | **29**     | **4**      |

## 测试验证

- 每个 skill 使用示例 .h5ad / TIFF 数据进行端到端测试
- Skills 需通过 `bun run --cwd backend/cli test`
- 前端组件使用 Playwright e2e (`frontend/workspace/e2e/`)
- 科学连接器需 mock API 响应

## 风险与权衡

| 风险                                    | 缓解措施                          |
| --------------------------------------- | --------------------------------- |
| Python 依赖冲突（scVelo vs scvi-tools） | 使用统一 conda env 或 poetry 管理 |
| 大型空间数据内存占用                    | 实现分块读取 + lazy loading       |
| IMC 数据格式多样                        | 优先支持 TIFF/MCD，后续扩展       |
| 部分 package 仅 R 可用                  | 优先 Python 方案，R 接口通过 rpy2 |

## 执行策略

每个 Phase 按 Task 编号顺序执行，Phase 之间无强依赖可并行。优先 Phase 1（已有 scanpy/scvi 基础），其次 Phase 2（空间组学是热点），然后 Phase 3（蛋白平台）。
