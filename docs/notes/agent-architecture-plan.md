# 智能体架构全局优化计划

## 上下文

本计划针对 HYscience (`hyscience`) 的 Agent 运行时架构进行全局诊断和优化路线规划。该架构负责从用户请求→Agent 选择→Prompt 组装→工具解析→LLM 调用→流式处理→子智能体调度→上下文压缩的完整链路。核心文件约 3868 行 TypeScript + 464 行 Prompt 文本，分布在 `backend/cli/src/agent/`、`backend/cli/src/session/`、`backend/cli/src/tool/` 三个模块。

## 当前架构全景

```
用户请求
  │
  ├─ Agent 选择 (agent.ts) → 内置 14 个 Agent + 自定义扩展
  ├─ 消息创建 (prompt.ts:createUserMessage) → 文件解析/MCP资源/Agent引用
  │
  └─ 主循环 (prompt.ts:loop)
       │
       ├─ 步骤 1: insertReminders() → 20+ 注入函数 (prompt-inject.ts:976行)
       │   ├─ Agent prompt text 注入
       │   ├─ 动态上下文注入 (locale/compute/literature/task-profile)
       │   ├─ 科研契约注入 (research-intent/result-delivery/interaction-contract)
       │   ├─ 科学性检查注入 (stats/experiment-design/data-quality/causal/meta...)
       │   └─ 辅助注入 (error-recovery/correction-context/multi-question...)
       │
       ├─ 步骤 2: resolveTools() → 工具过滤 (prompt-tools.ts)
       ├─ 步骤 3: LLM.stream() → AI SDK 封装 (llm.ts)
       ├─ 步骤 4: SessionProcessor.process() → 流处理 (processor.ts)
       └─ 步骤 5: 后处理 (compaction / subtask / review gate / ...)
```

## 诊断：10 大优化方向

### 一、Prompt 注入管线重构 (高优先级)

**问题：** `prompt-inject.ts` (976行) 包含 20+ 个注入函数，通过 `applyDynamicInjections()` 串联调用。每个函数独立做正则匹配和去重检查，缺乏统一的注入调度框架。注入顺序隐式耦合，难以测试和扩展。

**优化方案：**

1. **引入 Injection Pipeline 抽象**：将注入函数统一为 `Injection` 接口 `{ name, tier, predicate, render }`
2. **合并正则扫描**：`interpretUserTurn()` 一次调用缓存结果
3. **分级注入**：Critical / Scientific / Advisory
4. **可测试性**：每个 Injection 独立单元测试，predicate 和 render 分离

**涉及文件：**

- `backend/cli/src/session/injection-pipeline.ts` — Pipeline 抽象
- `backend/cli/src/session/prompt-inject.ts` — 注入实现
- `backend/cli/src/session/prompt.ts` — `insertReminders()` 调用侧

### 二、上下文窗口管理增强 (高优先级)

分层摘要、自适应 token 预算、结构化 compaction、增量压缩、工具输出分级。

**涉及文件：** `compaction.ts`、`prompt/compaction.txt`、`prompt.ts`

### 三～十

见各阶段路线图（Agent 定义数据驱动、编排机制、Prompt 模板化、Tool 懒加载、子智能体效率、状态机化、可观测性、Agent 生成增强）。

---

## 优先级路线图

### 第一阶段：基础重构（1-2 周）

- **一、Prompt 注入管线重构**
- **二、上下文窗口管理增强**

### 第二阶段：架构提升（2-4 周）

- Agent 定义数据驱动、Prompt 模板化、Tool 解析优化

### 第三阶段：能力扩展（4-8 周）

- Agent 组合/编排、子智能体效率、Agent 生成增强

### 第四阶段：工程完善（持续）

- Session Loop 状态机化、可观测性增强

## 验证策略

1. `cd backend/cli && bun test`
2. Prompt 变更：`hyscience prompt show <agent>` 对比差异
3. 开发环境手动测试 research/biology/plan
4. 性能基准：每轮延迟与 token 消耗
5. 超长对话 compaction 质量验证

## 不纳入本次计划的内容

- 前端 workspace UI 变更
- Provider 层改动
- MCP 协议变更
- 新科学工具接入
