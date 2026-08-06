# HYscience 1.0 — 智能体驱动的多组学分析平台优化计划

> **For Hermes:** 使用 subagent-driven-development skill 按任务逐步实现。

**Goal:** 将 HYscience 重构成**智能体优先（Agent-First）**的交互范式——生物医学科研工作者用自然语言与 Agent 对话，Agent 理解研究意图、自动规划分析流程、按需加载技能、执行计算、呈现结果并主动建议下一步。用户无需知道 scanpy/squidpy/scvelo 是什么，只需告诉 Agent 研究问题。

**Architecture:** 核心改造在 Agent 层——重写 Biology Agent 系统提示词使其具备多组学工作流推理能力，新增 Skill Router 按数据类型和问题自动加载技能，增强 Session Memory 追踪完整分析历程。Skills 层作为 Agent 的工具箱按需调用，前端增强结果渲染能力。

**Tech Stack:** TypeScript + Bun (Agent/session/skill-router), Python/kernel (skill 执行), SolidJS (结果渲染).

---

## 核心设计理念

```
用户: "分析这个肺癌组织的单细胞数据，看看免疫微环境和T细胞耗竭"
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│              Biology Agent (智能体)                       │
│                                                         │
│  1. 理解意图 → 单细胞QC + 聚类 + 免疫注释 + T细胞亚群    │
│  2. 规划流程 → 自动调用 Skill Router 加载技能             │
│  3. 执行分析 → Python kernel 运行，实时反馈               │
│  4. 解读结果 → 用中文解释发现，附带可视化                  │
│  5. 主动追问 → "发现了一群高表达TOX的CD8+ T细胞，要做耗竭signature分析吗？" │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌────────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐
│ scanpy     │  │ scvelo   │  │ cellchat │  │ 空间/蛋白    │
│ (QC/聚类)  │  │ (发育)   │  │ (通讯)   │  │ (按需扩展)   │
└────────────┘  └──────────┘  └──────────┘  └─────────────┘
```

**关键转变**：

- **旧模式**：用户选 Skill → 填参数 → 跑脚本 → 看结果
- **新模式**：用户说研究问题 → Agent 规划→执行→解读→追问

---

## 现状分析

### Agent 层现状

- 已有 `biology` agent 专家模式（`backend/cli/src/agent/agent.ts`）
- Agent 已有 skill 加载能力
- 缺少：
  - ❌ **工作流推理** — Agent 不会规划多步骤分析
  - ❌ **数据感知** — Agent 不会根据文件类型自动选技能
  - ❌ **会话记忆** — Agent 不记住之前分析过的数据
  - ❌ **主动建议** — Agent 不会根据结果推荐后续分析
  - ❌ **中文交互** — Agent 对生物学术语的中文理解不足

### Skills 层现状

已有但以"工具手册"形式存在，缺少 Agent 可执行的 pipeline：

| 已有 Skill | 覆盖度            | Agent 化程度                    |
| ---------- | ----------------- | ------------------------------- |
| scanpy     | ✅ QC/聚类/可视化 | 需封装为 Agent 可调用的原子步骤 |
| scvi-tools | ✅ 批次校正/整合  | 同上                            |
| pydeseq2   | ✅ 差异表达       | 同上                            |
| squidpy    | ❌ 不存在         | 需新建                          |
| scvelo     | ❌ 不存在         | 需新建                          |
| cellchat   | ❌ 不存在         | 需新建                          |
| IMC        | ❌ 不存在         | 需新建                          |

---

## 实施计划

### Phase 0: Agent 智能核心（最先做，其他都服务于它）

#### Task 0.1: 重写 Biology Agent System Prompt

**Objective:** 让 Agent 具备多组学工作流推理能力，理解中文科研问题

**Files:**

- Create: `backend/cli/src/agent/prompts/biology-v2.md`
- Modify: `backend/cli/src/agent/agent.ts` — 注册新 agent，设置自动激活条件

**Agent 需要掌握的能力（写入 System Prompt）：**

```markdown
## 科研工作流推理

当用户提出研究问题时，按以下框架规划：

1. 数据识别：自动检测输入文件类型
   - .h5ad → 单细胞/空间数据
   - .tiff / .mcd → IMC 成像数据
   - .csv / .tsv → 计数/元数据表

2. 标准化分析路径（agent 自动选择）：
   - 单细胞: QC→归一化→降维→聚类→注释→差异分析
   - 空间: 加载→空间QC→特征可视化→邻域分析
   - 蛋白成像: 预处理→分割→定量→空间分析

3. 主动追问关键信息：
   - 物种（人/小鼠）→ 决定参考基因组和marker基因
   - 组织类型 → 决定细胞注释策略
   - 实验条件 → 决定差异分析设计
   - 生物学问题 → 决定深度分析方向

4. 结果解读规范：
   - 用中文解释统计指标的含义
   - 标注每个结果的生物学意义
   - 指出潜在假阳性/偏倚
   - 建议后续验证实验
```

**Step 1:** 编写 `biology-v2.md` prompt，含完整工作流模板、追问策略、中文术语表
**Step 2:** 在 `agent.ts` 注册 `biology-v2` agent，设为默认生物学 agent
**Step 3:** 编写测试：给定中文问题，验证 Agent 能正确规划分析步骤

#### Task 0.2: Skill Auto-Router — 智能技能路由

**Objective:** Agent 根据数据特征和用户问题自动加载对应 skills

**Files:**

- Create: `backend/cli/src/skill/skill-router.ts`

**路由逻辑：**

```typescript
// Agent 说: "分析这个单细胞数据"
// Router 自动匹配:
{
  file: "tumor.h5ad",
  keywords: ["单细胞", "免疫", "肿瘤"],
  // → 加载: scanpy, scvi-tools, cellchat
  // → 建议: scvelo (如果用户提到"发育"/"分化")
}
```

**Step 1:** 实现 `skill-router.ts` — 基于文件扩展名 + 关键词的自动 skill 匹配
**Step 2:** 在 `session/prompt.ts` 中集成路由，Agent 启动时自动预加载相关 skills
**Step 3:** 路由置信度低时主动确认（"检测到.h5ad文件，需要做单细胞分析吗？"）

#### Task 0.3: Session Research Memory — 分析记忆

**Objective:** Agent 记住当前会话已完成的分析步骤、中间结果，不重复计算

**Files:**

- Modify: `backend/cli/src/session/memory.ts` — 新增 analysis-state 存储
- Create: `backend/cli/src/session/analysis-tracker.ts`

**Step 1:** `analysis-tracker.ts` — 跟踪每步分析（输入→操作→输出），检测重复请求
**Step 2:** Agent 引用历史结果时自动跳过已执行步骤（"已做QC，直接做聚类"）

---

### Phase 1: Skills Agent 化（让每个 Skill 变成 Agent 可调用的原子能力）

#### Task 1.1: Scanpy Agent-Tool 封装

**Objective:** 将 scanpy skill 拆分为 Agent 可逐个调用的原子步骤

**Files:**

- Modify: `backend/cli/skills/biology/scanpy/SKILL.md` — 补充 Agent 调用指南
- Create: `backend/cli/skills/biology/scanpy/scripts/agent_qc.py`
- Create: `backend/cli/skills/biology/scanpy/scripts/agent_cluster.py`
- Create: `backend/cli/skills/biology/scanpy/scripts/agent_annotate.py`

**每个脚本设计为：**

- 单一职责（一个步骤）
- 接受上一个步骤的输出作为输入
- 输出保存为 .h5ad，含元数据记录
- 返回 Agent 可读的结果摘要

**Step 1:** `agent_qc.py` — 输入 raw.h5ad → 自动过滤 + 归一化 → 输出 qc.h5ad + QC 报告
**Step 2:** `agent_cluster.py` — 输入 qc.h5ad → PCA + UMAP + Leiden → 输出 clustered.h5ad + 聚类图
**Step 3:** `agent_annotate.py` — 输入 clustered.h5ad → marker 基因 + 自动注释 → 输出 annotated.h5ad + 注释表

#### Task 1.2: 新增 scVelo Skill（Agent 友好设计）

**Objective:** Agent 可调的 RNA velocity 分析

**Files:**

- Create: `backend/cli/skills/biology/scvelo/SKILL.md`
- Create: `backend/cli/skills/biology/scvelo/scripts/compute_velocity.py`

**设计要点：** 自动检测是否含 spliced/unspliced 层，无则提示用户重新运行 velocyto

#### Task 1.3: 新增 CellChat Skill

**Objective:** Agent 可调的细胞通讯分析

**Files:**

- Create: `backend/cli/skills/biology/cellchat/SKILL.md`
- Create: `backend/cli/skills/biology/cellchat/scripts/lr_analysis.py`

#### Task 1.4: 新增单细胞管道 Skill（Agent 一键式入口）

**Objective:** Agent 收到"分析单细胞数据"时，调用此 skill 跑完整管道

**Files:**

- Create: `backend/cli/skills/biology/single-cell-pipeline/SKILL.md`
- Create: `backend/cli/skills/biology/single-cell-pipeline/scripts/full_pipeline.py`

**`full_pipeline.py` 做完整闭环**：QC → 整合 → 降维 → 聚类 → 注释 → 差异 → 报告

---

### Phase 2: 空间转录组 + 蛋白成像（Agent 驱动）

#### Task 2.1: 新增 Squidpy Skill

**Files:**

- Create: `backend/cli/skills/biology/squidpy/SKILL.md`
- Create: `backend/cli/skills/biology/squidpy/scripts/spatial_qc.py`
- Create: `backend/cli/skills/biology/squidpy/scripts/niche_analysis.py`

#### Task 2.2: 新增空间去卷积 Skill

**Files:**

- Create: `backend/cli/skills/biology/spatial-deconv/SKILL.md`
- Create: `backend/cli/skills/biology/spatial-deconv/scripts/cell2location.py`

#### Task 2.3: 新增 IMC 分析 Skill

**Files:**

- Create: `backend/cli/skills/biology/imc-analysis/SKILL.md`
- Create: `backend/cli/skills/biology/imc-analysis/scripts/imc_pipeline.py`

#### Task 2.4: 新增 PCF 蛋白指纹 Skill

**Files:**

- Create: `backend/cli/skills/biology/pcf-analysis/SKILL.md`
- Create: `backend/cli/skills/biology/pcf-analysis/scripts/protein_correlation.py`

---

### Phase 3: 前端渲染增强（Agent 输出可视化）

#### Task 3.1: 结果卡片组件

**Files:**

- Create: `frontend/workspace/src/components/analysis-card.tsx`

Agent 每完成一步分析，渲染一张"结果卡片"（QC 摘要 / 降维图 / 差异表），用户可以展开看详情

#### Task 3.2: 空间可视化组件

**Files:**

- Create: `frontend/workspace/src/science/renderers/spatial-heatmap.tsx`

#### Task 3.3: 蛋白多通道查看器

**Files:**

- Create: `frontend/workspace/src/science/renderers/multichannel-viewer.tsx`

---

### Phase 4: 数据库连接器（Agent 搜索用）

#### Task 4.1: 空间组学数据库

**Files:**

- Create: `backend/cli/src/science/connectors/spatial/index.ts`

Agent 在需要参考数据集时自动查询

#### Task 4.2: 蛋白组学数据库

**Files:**

- Create: `backend/cli/src/science/connectors/proteomics/index.ts`

---

## 交互示例（最终效果）

```
👤 用户: 帮我分析这个肺癌单细胞数据 /data/lung_tumor.h5ad，看看免疫微环境

🤖 Agent: 检测到 .h5ad 单细胞数据，我先做质控。
  [执行 scanpy QC...]

  ✅ QC 完成：25,000 个细胞通过过滤（去除 15% 低质量细胞）
  📊 检测到 12 个样本，4 个条件（肿瘤/正常 + 治疗/未治疗）

  接下来我做聚类和细胞注释。物种是人类吗？需要我自动注释还是你提供 marker 基因？

👤 用户: 人类，自动注释，重点关注 T 细胞和髓系细胞

🤖 Agent: 好的，开始聚类和免疫细胞注释...
  [执行 scanpy cluster + annotate...]

  ✅ 鉴定出 8 个主要细胞群：
  - CD8+ T 细胞 (18%)
  - CD4+ T 细胞 (12%)
  - NK 细胞 (5%)
  - B 细胞 (8%)
  - 巨噬细胞 (25%) ← 肿瘤组显著富集
  - 单核细胞 (10%)
  - DC 细胞 (3%)
  - 上皮细胞 (15%)
  [降维图已生成]

  发现肿瘤组中巨噬细胞比例显著高于正常组 (p=0.003)。
  CD8+ T 细胞中有高表达 TOX 和 PDCD1 的亚群，可能处于耗竭状态。

  建议下一步：做 T 细胞亚群细分 + 耗竭 signature 分析。要做吗？
```

---

## 文件变更汇总

| Phase                    | 核心内容                                    | 新增   | 修改  |
| ------------------------ | ------------------------------------------- | ------ | ----- |
| Phase 0 (Agent 核心)     | System Prompt + Skill Router + Memory       | 3      | 2     |
| Phase 1 (单细胞 Agent化) | Scanpy原子化 + scVelo + CellChat + Pipeline | 10     | 1     |
| Phase 2 (空间+蛋白)      | Squidpy + deconv + IMC + PCF                | 10     | 0     |
| Phase 3 (可视化)         | 结果卡片 + 空间/蛋白渲染                    | 4      | 0     |
| Phase 4 (数据库)         | Spatial + Proteomics connectors             | 2      | 0     |
| **总计**                 |                                             | **29** | **3** |

## 执行优先级

```
Phase 0 (Agent核心)  ← 最重要，先做
    │
    ├── Phase 1 (单细胞Agent化)  ← 紧接着
    │
    ├── Phase 2 (空间+蛋白)     ← 可与 Phase 3 并行
    │
    └── Phase 3 + 4 (渲染+数据库) ← 锦上添花
```

## 风险与权衡

| 风险                     | 缓解                                   |
| ------------------------ | -------------------------------------- |
| Agent 工作流推理不够智能 | Phase 0 的 prompt 设计是核心，迭代优化 |
| Python 依赖冲突          | 每个 skill 声明独立 conda env          |
| 大型数据内存不足         | 自动抽样/分块策略写入 Skill 规范       |
| 中文术语理解偏差         | System prompt 含完整中英文术语对照表   |
