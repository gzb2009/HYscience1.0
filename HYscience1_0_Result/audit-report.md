# HYscience 1.0 全面审计报告

> 审计日期: 2026-07-24  
> 审计范围: backend/cli 完整代码链路（agent → session → tool → provider）  
> 审计方法: 逐文件通读 + 链路追踪 + 边界条件分析

---

## 一、Bug 清单

### 🔴 严重 (P0 — 可能导致崩溃/数据丢失/死循环)

#### 1. SystemPrompt.environment 中 ripgrep tree 始终返回空字符串

**文件**: `backend/cli/src/session/system.ts:91-96`  
**问题**: 条件 `project.vcs === "git" && false` 永远为 `false`，`Ripgrep.tree()` 调用是死代码。  
**影响**: `<files>` 区块始终为空，模型无法获取项目文件树概览。  
**修复**: 移除 `&& false` 或改为可配置开关。

```typescript
// 当前（死代码）
project.vcs === "git" && false ? await Ripgrep.tree({ cwd: Instance.directory, limit: 200 }) : ""

// 建议修复
project.vcs === "git" ? await Ripgrep.tree({ cwd: Instance.directory, limit: 200 }) : ""
```

#### 2. Compaction 潜在的无限循环

**文件**: `backend/cli/src/session/prompt.ts:578-591`  
**问题**: 当 `isOverflow` 返回 true → 创建 compaction → continue。如果 compaction agent 执行失败（被静默吞掉），循环会再次检测到 overflow，无限循环。  
**影响**: 在一个大 session 中可能导致 CPU/内存耗尽。  
**修复**: 添加重试计数器，compaction 失败超过 N 次后 break 而非无限循环。

#### 3. Identifier.counter 溢出风险

**文件**: `backend/cli/src/id/id.ts:56-62`  
**问题**: `counter` 在 `generateID` 中递增但没有上限检查。同时，BigInt 编码只分配了 12 bits 给 counter（`* 0x1000`），但 `counter++` 没有限制。如果同一毫秒内生成超过 4095 个 ID，counter 会溢出到高位，导致 ID 乱序或冲突。  
**影响**: 在高吞吐场景下（如批量 tool call），ID 排序可能错乱，导致消息流中断。  
**修复**: 添加 `counter = counter % 0x1000` 或抛出错误。

#### 4. Shell stdout/stderr 并发的 Session.updatePart 竞态

**文件**: `backend/cli/src/session/prompt.ts:1787-1806`  
**问题**: `proc.stdout.on("data")` 和 `proc.stderr.on("data")` 都调用 `Session.updatePart(part)` 更新同一个 part 对象，无同步机制。  
**影响**: part 的 `state.metadata.output` 可能丢失部分输出。  
**修复**: 使用 shared buffer + 单一定时器 flush，或使用锁机制。

### 🟡 高 (P1 — 功能异常但不崩溃)

#### 5. createUserMessage 中 Agent 路由硬编码

**文件**: `backend/cli/src/session/prompt.ts:953-957`  
**问题**:

```typescript
const routed =
  requested === "research" || requested === "biology" || requested === "physics" || requested === "ml"
    ? TaskProfile.agent(Instance.project.research)
    : requested
```

新增的 primary agent（如通过 config 自定义）不会经过 TaskProfile 路由。  
**影响**: 自定义 primary agent 缺少 TaskProfile 上下文注入。  
**修复**: 改为检查 agent.mode 或 agent.gates 而非硬编码名称列表。

#### 6. Permission filtering 中 wildcardDisable 无法部分恢复

**文件**: `backend/cli/src/session/prompt.ts:941-948`  
**问题**: 当 `input.tools["*"] === false` 时，所有 tool 都被删除。即使某个 tool 在 agent permission 中显式 mark 为 `allow`，也无法恢复。  
**影响**: bare mode 下无法选择性启用某些 tool。  
**修复**: 将 wildcard 逻辑与显式 allow/deny 逻辑合并处理。

#### 7. Compaction 中 PRUNE_PROTECTED_TOOLS 硬编码

**文件**: `backend/cli/src/session/compaction.ts:44`  
**问题**: 受保护的 tool 列表 `["skill", "artifact"]` 是硬编码的。插件注册的自定义 tool 无法被保护。  
**影响**: 插件的 tool 输出可能被错误裁剪。  
**修复**: 允许 tool 声明 `protected: true` 属性，或从配置读取。

#### 8. Config.Info 中 agent 字段的已知名称硬编码

**文件**: `backend/cli/src/config/config.ts:1010-1023`  
**问题**: zod schema 中 `agent` 对象的已知 key（plan, build, write, explore, title, compaction）是硬编码的。新增原生 agent 时需要同步更新两处。  
**影响**: agent.ts 和 config.ts 之间的同步需要手动维护。  
**修复**: 使用 `catchall(Agent)` 并移除显式 key 列表，或从 agent.ts 导出名称列表。

### 🟠 中 (P2 — 潜在风险/边界情况)

#### 9. SessionRetry 中的 JSON.parse 二次调用

**文件**: `backend/cli/src/session/retry.ts:67-78`  
**问题**: 在 `if (typeof error.data?.message === "string")` 分支中，`JSON.parse(error.data.message)` 的返回值（可能非 object）在 line 80 被 `typeof json !== "object"` 守卫，逻辑正确但脆弱。如果未来重构移除了守卫，会导致崩溃。  
**影响**: 低 — 当前守卫存在时安全。  
**修复**: 简化逻辑，避免双重 JSON.parse。

#### 10. Processor 中 snapshot 在 flow break 后可能未清理

**文件**: `backend/cli/src/session/processor.ts:267, 440-453`  
**问题**: 当 `needsCompaction = true` 在 stream 处理循环内（line 413），且错误在 `finish-step` 中被设置，`snapshot` 变量可能未被 patch。catch block 处理了这个情况，但如果 `needsCompaction` break 发生在 `finish-step` 之前且没有错误，snapshot 不会被清理。  
**影响**: 极低概率下的 snapshot 泄漏。  
**修复**: 在 needsCompaction break 之前清理 snapshot。

#### 11. AgentRouter code_debugging regex 疑似损坏

**文件**: `backend/cli/src/session/agent-router.ts:55-58`  
**问题**: `code_debugging` 的 SIGNALS 中，regex 使用的是双反斜杠字面量还是单反斜杠，需要确认。如果 `\b` 被解析为 backspace 而非 word boundary，会导致匹配失败。  
**影响**: code_debugging 意图检测不工作。  
**修复**: 检查源文件中的实际字符，确认使用 `\\b`。

---

## 二、架构与设计问题

### A. Monolithic SessionPrompt（2112 行）

**文件**: `backend/cli/src/session/prompt.ts`  
**问题**: 该文件包含了 message 创建、tool 解析、shell 执行、command 执行、title 生成、prompt 注入（insertReminders）、plan mode 切换、以及主 agent loop —— 全部塞在同一个模块里。  
**影响**:

- 单元测试几乎不可行（依赖太多外部模块）
- 修改一个功能容易破坏其他功能
- 代码审查困难

**建议拆分**:

```
src/session/
  prompt/
    index.ts          # prompt() 入口 + loop()
    message.ts        # createUserMessage, resolvePromptParts
    tools.ts          # resolveTools
    shell.ts          # shell()
    command.ts        # command()
    reminders.ts      # insertReminders + 所有 inject* 函数
    title.ts          # ensureTitle
```

### B. 状态管理分散

**问题**: SessionPrompt.state、Identifier.counter、ACPSessionManager.sessions、SessionStatus —— 都是模块级 mutable state，没有统一的生命周期管理。  
**影响**: 难以推理系统状态，调试困难，测试隔离性差。  
**建议**: 引入一个轻量级的 SessionContext 对象，持有 session 运行时的 mutable state，随 session 生命周期创建/销毁。

### C. 插件系统无沙箱

**文件**: `backend/cli/src/tool/registry.ts:72-93`  
**问题**: 插件的 tool 直接在同一进程中执行。恶意或 buggy 插件可以：

- 读取任意文件
- 执行任意 shell 命令
- 修改全局状态
- 导致进程崩溃

**建议**: 考虑使用 Bun Worker 或 vm 沙箱隔离插件执行（分阶段，先对第三方插件做隔离）。

### D. 缺乏集成测试

**问题**: 75 个单元测试文件，但缺少以下关键路径的集成测试：

- 完整 prompt → LLM → tool call → result → 循环的端到端测试
- Compaction 触发 → 执行 → 恢复的完整流程
- 多 agent 切换（plan → research → biology）
- Session fork + revert 组合

**建议**: 增加 integration test suite，覆盖主要 user journey。

### E. ACP 与 CLI Session 的双轨

**问题**: ACP session manager (`acp/session.ts`) 使用独立的 `Map<sessionID, ACPSessionState>` 管理 session，而 CLI session (`session/index.ts`) 使用 Storage 持久化。两者没有统一。  
**影响**: 双层 session 状态可能不一致（如 model 配置）。  
**建议**: ACP session 层应委托到 Session namespace 做实际存储。

---

## 三、链路逻辑分析

### 完整请求链路

```
用户输入
  → SessionPrompt.prompt()           [prompt.ts:170]
    → createUserMessage()            [prompt.ts:951]
      → Agent.defaultAgent()         [agent.ts:332]
      → TaskProfile routing          [prompt.ts:954]
      → resolvePromptParts()         [prompt.ts:210]
      → insertReminders()            [prompt.ts:1496]
        → injectResultDelivery()
        → injectAgentRouter()
        → injectExperimentDesign()
        → injectProjectResearch()
        → injectLocale()
        → injectComputeTier()
        → injectLiteratureGate()
        → injectTaskProfile()
        → promptText injection
    → loop()                         [prompt.ts:286]
      → SessionCompaction check
      → resolveTools()               [prompt.ts:757]
        → ToolRegistry.tools()
        → MCP.tools()
        → Permission filtering
      → SessionProcessor.process()   [processor.ts:47]
        → billing gate
        → LLM.stream()               [llm.ts:45]
          → SystemPrompt.environment()
          → streamText()
        → stream event handling
        → snapshot tracking
        → usage reporting
      → compaction / continue / stop
```

### 链路中的关键风险点

1. **insertReminders 执行顺序敏感**: `injectResultDelivery` 先执行，`injectAgentRouter` 的检测依赖 `injectResultDelivery` 产生的 text part 是否存在 —— 如果后者也添加了相同的 text，去重逻辑可能误判。

2. **resolveTools 中的 model 条件判断** (line 169-173):

   ```typescript
   const usePatch = model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
   ```

   这个逻辑很脆弱——它依赖 modelID 字符串匹配，且 `!model.modelID.includes("gpt-4")` 会匹配 `gpt-4o`、`gpt-4.1` 等。应该用更 robust 的 model capability 标记。

3. **Processor 的重试循环中的 billing gate**: 每次 process() 的迭代都重新检查 billing（`HYscience.refreshIfStale()`），但 `resolveCredentialSource` 在每次迭代开始时调用。如果 billing 模式在迭代间变化（如用户切换），可能导致不一致的计费分类。

4. **Compaction 与 subtask 的交互**: loop 中 compaction 和 subtask 检查使用 `tasks.pop()` (line 393)，是 LIFO 顺序。如果用户发多个 subtask，最后创建的会优先执行 —— 这可能不是期望的 FIFO 行为。

---

## 四、优化方案 (Plan)

### Phase 1: 紧急修复 (P0 Bug Fixes) — 1-2 周

| #   | 项目                           | 说明                                      |
| --- | ------------------------------ | ----------------------------------------- |
| 1   | 删除 system.ts 中的 `&& false` | 恢复 ripgrep tree 功能或添加 feature flag |
| 2   | Compaction 防无限循环          | 添加 maxCompactionAttempts (建议 3)       |
| 3   | Identifier counter 上限        | 添加 `counter = (counter + 1) & 0xFFF`    |
| 4   | Shell output 竞态              | 使用 mutex 或 shared buffer 聚合          |

### Phase 2: 架构债务清理 — 2-4 周

| #   | 项目                                 | 说明                                      |
| --- | ------------------------------------ | ----------------------------------------- |
| 1   | 拆分 prompt.ts                       | 按功能拆分为 6+ 个模块                    |
| 2   | 统一 Agent 路由逻辑                  | 从硬编码名称改为 capability-based routing |
| 3   | 引入 SessionContext                  | 统一管理 session 运行时 mutable state     |
| 4   | 修复 tool 过滤逻辑                   | 使 permission 和 wildcard 正确交互        |
| 5   | 消除 config.ts 中的硬编码 agent 名称 | 或添加编译时校验                          |

### Phase 3: 质量提升 — 4-8 周

| #   | 项目                 | 说明                                    |
| --- | -------------------- | --------------------------------------- |
| 1   | 集成测试套件         | 覆盖核心 user journey                   |
| 2   | 插件沙箱             | Bun Worker 隔离第三方插件               |
| 3   | Circuit Breaker      | LLM 调用的熔断机制                      |
| 4   | ACP/CLI Session 统一 | ACP 委托到 Session namespace            |
| 5   | 性能优化             | Ripgrep.tree 缓存、懒加载 skill catalog |

### Phase 4: 长期演进

| #   | 项目       | 说明                              |
| --- | ---------- | --------------------------------- |
| 1   | Agent DSL  | 用声明式配置替代硬编码 Agent.Info |
| 2   | 可观测性   | OpenTelemetry traces 覆盖全链路   |
| 3   | Hot reload | 配置变更无需重启（部分已支持）    |
| 4   | 多模态统一 | 图片/文件处理的统一抽象层         |

---

## 五、代码质量指标总结

| 指标                  | 当前状态                     | 目标                   |
| --------------------- | ---------------------------- | ---------------------- |
| 最大单文件行数        | 2112 (prompt.ts)             | <500                   |
| 循环依赖              | 无明显循环依赖               | ✅                     |
| 测试覆盖率            | ~75 test files, 缺少集成测试 | 增加 integration tests |
| TypeScript strictness | zod schema 使用广泛          | ✅                     |
| 死代码                | 至少 1 处 (system.ts)        | 清理                   |
| 硬编码 Agent 名称     | 3 处                         | 改为 capability-based  |
| 竞态风险              | 至少 1 处 (shell output)     | 修复                   |

---

_报告生成时间: 2026-07-24 | 审计工具: 全量代码通读 + 链路追踪_
