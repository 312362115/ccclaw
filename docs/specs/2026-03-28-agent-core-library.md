# 技术方案：通用 Agent Core 库 — 从 ccclaw 沉淀可复用的 Agent 基础设施

## 1. 背景与动机

### 为什么要做

多个 AI 项目都需要 Agent 能力（多轮 tool call、LLM Provider 抽象、上下文管理），每次重复实现。ccclaw 的 `agent-runtime` 已经积累了一套完整的 Agent 基础设施，但耦合在 ccclaw 项目内，无法直接给其他项目用。

### 核心场景

**场景 A：编码助手（类 Claude Code）**
- 交互式终端会话，支持文件编辑、git 操作、命令执行
- 需要全部能力：memory、skill、MCP、planning、subagent
- ccclaw 本身就是这个场景

**场景 B：Headless 报告生成 Agent**
- 启动时注册自定义 tool，注入 system prompt
- LLM 自主多轮 tool call 采集数据
- LLM 整合所有信息推理分析，输出高质量报告
- 同样需要 Skill（画图、深度调研等）来增强报告质量
- 无交互、无文件编辑，纯粹的：工具 + prompt → 自主执行 → 结构化输出

### 核心矛盾

国产模型（Qwen、DeepSeek）与 Claude Opus/Sonnet 存在能力差距：
- **推理深度不足**：3-5 步后推理跑偏
- **指令遵循弱**：纯 prompt 的 Iron Law / Hard Gate 可能被无视
- **工具调用不稳定**：格式错误率约 20%

因此不能像 superpowers 那样只靠 prompt 做 harness，需要 **prompt + code 双层 harness**，且 harness 厚度随模型能力自适应。

### 目标

沉淀一个通用 Agent Core 库，满足：
1. **最小可用零配置**：3 行代码启动一个 Headless Agent
2. **高级能力 opt-in**：memory、skill、MCP、subagent 按需开启
3. **国产模型第一优先级**：工程手段补偿模型能力差距，逼近 CC + Sonnet 体验
4. **Prompt 是一等公民**：分层 prompt 模板 + 按模型档位自动增强

### 提出方

开发者自身——多项目复用需求驱动。

### 约束

- 在 ccclaw monorepo 内作为新 package `packages/agent-core` 开发
- 零 ccclaw 业务依赖（不依赖 `@ccclaw/shared`），可独立发 npm
- 保持 agent-runtime 正常工作（agent-runtime 变为 agent-core 的消费者）
- TypeScript，ESM，Node.js ≥ 22

### 不做

- 不做 CLI 工具（CLI 是库的薄壳，后续独立包）
- 不做 HTTP Server 适配层（后续独立包）
- 不重写 agent-runtime（渐进式抽离，agent-runtime 变为 agent-core + ccclaw 协议的组合）
- 不做多模型并行投票（成本过高）

---

## 附录 A：国产大模型选型（Agent 场景）

> 完整调研报告见 `docs/research/2026-03-28-china-llm-agent-selection.md`，覆盖 6 大模型系列 20+ 款模型。
> **本次 MVP 只适配 Qwen3.5-Plus**，其他模型通过 OpenAI 兼容层天然可用，后续按需添加专项 Profile。

### MVP 适配模型：Qwen3.5-Plus

| 维度 | 规格 |
|------|------|
| API Model ID | `qwen3.5-plus` |
| 厂商平台 | 阿里云百炼（Model Studio） |
| API Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenAI 兼容 | ✅ 完全兼容，直接用 OpenAI SDK |
| 上下文窗口 | **1,000,000 tokens** |
| 最大输出 | 65,536 tokens |
| 架构 | 397B 总参数，17B 激活（MoE），推理效率极高 |
| Function Calling | ✅ 强 |
| Thinking 模式 | ✅ 支持（`enable_thinking` 参数可选开启） |
| Vision | ✅ 图片 + 视频 |
| JSON Mode | ✅ `response_format: json_object` |
| 并行 Tool Call | 支持但建议限制为单次（弱模型兜底） |

**定价（人民币/百万 token，分段计价）**：

| 输入 token 量 | 输入价格 | 输出价格 |
|--------------|---------|---------|
| 0 ~ 32K | **0.8 元** | **4.8 元** |
| 32K ~ 128K | 1.6 元 | 9.6 元 |
| 128K+ | 4.0 元 | 24 元 |

### 为什么选 Qwen3.5-Plus

1. **性能全面超越上一代 Qwen3-Max**：MMLU-Pro 87.8（超 GPT-5.2），GPQA 88.4（超 Claude 4.5），Agent 评测（BFCL-V4、Browsecomp）全面超越 Gemini-3-Pro
2. **性价比极高**：短对话输入仅 0.8 元/百万 token，是同性能 Gemini 3.0 Pro 的 1/18
3. **1M 上下文 + 65K 输出**：大仓库代码理解 + 长报告生成都够用
4. **多模态原生支持**：图片 + 视频理解，Headless 报告场景可直接分析图表截图
5. **阿里云生态最成熟**：API 稳定、文档完善、国内社区资源最丰富
6. **MoE 架构效率高**：397B 参数只激活 17B，推理吞吐比 Qwen3-Max 提升 19 倍

### 其他模型兼容性

agent-core 通过 OpenAI 兼容层（`compat.ts`）天然支持所有兼容 OpenAI API 的模型。用户只需更换 `apiBase` + `model` 即可切换：

```typescript
// Qwen3.5-Plus（MVP 首选，有专项 Profile 优化）
createAgent({ model: 'qwen3.5-plus', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })

// DeepSeek-V3.2（兼容可用，用默认 Profile）
createAgent({ model: 'deepseek-chat', apiBase: 'https://api.deepseek.com/v1' })

// Kimi-K2.5（兼容可用，用默认 Profile）
createAgent({ model: 'kimi-k2.5', apiBase: 'https://api.moonshot.cn/v1' })

// 任意 OpenAI 兼容模型（本地 Ollama 等）
createAgent({ model: 'llama3', apiBase: 'http://localhost:11434/v1' })
```

后续按需为 DeepSeek、Kimi 等模型添加专项 Profile（thinking 参数、tool call 约束、harness 厚度等）。

### 关于阿里云 Coding Plan

阿里云百炼提供 [Coding Plan](https://help.aliyun.com/zh/model-studio/coding-plan) 订阅服务，按月付费而非按 token 计费：

| 套餐 | 月费 | 每 5 小时额度 | 每月额度 | 支持模型 |
|------|------|-------------|---------|---------|
| Pro | ¥200/月 | 6,000 次请求 | 90,000 次 | qwen3.5-plus, kimi-k2.5, glm-5 等 |

5 小时滚动恢复机制：每分钟自动释放 5 小时前的额度（10:00 用 100 次 → 15:00 恢复 100 次）。

**结论：Coding Plan 不适用于 agent-core 库。** 原因：
1. **明确禁止 API 调用**——"严禁以 API 调用形式用于自动化脚本、自定义应用程序后端或任何非交互式批量调用"，违规会导致 API Key 封禁
2. 需使用专属 API Key（`sk-sp-xxxxx`）和专用 Base URL
3. 仅限编程工具（Claude Code、Cursor 等）交互式使用

**Coding Plan 适合的场景**：开发者在 Claude Code / Cursor 中使用 Qwen3.5-Plus 做日常编码——这对 ccclaw 本身的开发者体验有用，但 agent-core 库作为被其他项目 import 调用的基础设施，必须走标准 API 按 token 计费。

**建议**：
- 开发者日常用 ccclaw 编码 → 走 Coding Plan（¥200/月，成本可控）
- agent-core 库被其他项目调用 → 走标准 API 按 token 计费（Qwen3.5-Plus 短对话 0.8/4.8 元）

---

## 2. 现状分析

### 2.1 agent-runtime 现有能力（详细清单）

| 能力域 | 已实现 | 对标 Claude Code | 质量评估 |
|--------|--------|-----------------|---------|
| **Agent Loop** | 多轮迭代（max 25）、意图分类、停止/纠正/继续 | ✅ 对齐 | 成熟 |
| **Tool Use** | 原生 function calling + 文本 CLI 回退双模式 | ✅ 对齐 | 成熟 |
| **Provider 抽象** | Anthropic/OpenAI/Gemini/兼容层(Qwen/DeepSeek) | ✅ 对齐 | 成熟 |
| **Model Profile** | 能力声明、phase 参数、路由选择、执行策略 | ✅ 对齐 | 成熟 |
| **Context 管理** | 7 层分级组装 + 动态压缩（按窗口大小自适应） | ✅ 对齐 | 成熟 |
| **Planning** | 意图检测 → 生成计划 → 分步执行 | ✅ 对齐 | 可用 |
| **Memory** | 分层（mustInject/index/search）、压缩、合并 | ✅ 对齐 | 成熟 |
| **Subagent** | 并行执行、角色限制（coder/reviewer/explorer） | ✅ 对齐 | 可用 |
| **Streaming** | 完整事件流（text/thinking/tool_use/error） | ✅ 对齐 | 成熟 |
| **MCP** | stdio/SSE/streamable-http 三种传输 | ✅ 对齐 | 成熟 |
| **Skill** | 知识注入 + 可执行命令 | 部分对齐 | 需升级 |
| **Hook** | pre/post tool 执行钩子 | ✅ 对齐 | 成熟 |
| **Error Recovery** | 指数退避、连续错误检测、恢复选项 | ✅ 对齐 | 成熟 |
| **Verify-Fix** | Write → Verify → LLM Fix 循环 | ✅ 对齐 | 仅语法级 |

### 2.2 关键差距

#### 差距 1：推理能力（Extended Thinking）对国产模型是假支持

| 模型 | 状态 | 问题 |
|------|------|------|
| Claude | ✅ 完整可用 | 硬编码 `budgetTokens: 8192`，不可配置 |
| OpenAI o1/o3 | ❌ 声明未实现 | Profile 声明 `extendedThinking: true`，adapter 没处理 `thinkingConfig`；缺少 `reasoning_effort` 参数 |
| DeepSeek R1 | ❌ 同上 | 走 OpenAI 兼容层，继承空实现 |
| Qwen3 Coder | ❌ 同上 | 同理 |

#### 差距 2：Skill 只是"被动知识库"，不是"主动工作流引擎"

当前 Skill 系统只做两件事：
- `knowledge`：把 markdown 内容塞进 system prompt
- `executable_declared`：注册一个 shell 命令为 tool（只接受 `{ args?: string }`）

superpowers 的 Skill 本质是**工作流控制器**——通过 Iron Law / Hard Gate / Skill Chain 改变 agent 行为模式。但 superpowers 是纯 prompt 实现，依赖 Claude Opus 极强的指令遵循能力。国产模型需要 code 层面的强制保障。

| superpowers 能力 | 当前支持 | 差距 |
|-----------------|---------|------|
| 知识/指南注入 | ✅ `always=true` 全文注入 | 无 |
| 行为模式切换（TDD/debug） | ❌ | Skill 无法改变 agent loop 逻辑 |
| 多步骤工作流编排 | ❌ | Skill 不能参与 planning 步骤 |
| 条件触发 | ❌ | 没有触发条件机制 |
| Iron Law / Hard Gate | ❌ | 无代码级强制保障 |

#### 差距 3：Tool Call 可靠性靠 prompt 祈祷

Qwen Profile 标了 `toolUse: true` 走原生模式，但模型 tool call 能力弱，只能在 prompt 里加约束文案（"每次只调一个工具"）。缺少工程级兜底：
- 无结构化输出约束（L1）
- 解析容错不够（L2 部分实现）
- 无解析失败重试机制（L3 缺失）
- 无可观测性（L4 缺失）

#### 差距 4：System Prompt 太薄

当前 prompt 体系为 Claude 设计（29 行 base + 24 行 coding），点到为止。国产弱模型需要远比这详细的指导——详细的 tool call 教学、思考框架、输出格式约束。

#### 差距 5：缺少独立 Evaluator

Anthropic harness 设计核心发现：模型自评不靠谱（自信地表扬自己的平庸输出），必须独立 Evaluator。当前只有语法级 VerifyFix，无语义级评估。

#### 差距 6：启动成本太重

跑一个 Agent Loop 需要手动组装 6 个依赖（DB、Assembler、Consolidator、MCPManager、ToolRegistry、Provider）。Headless 场景需要零配置启动。

---

## 3. 调研与备选方案

### 3.1 Anthropic 官方 Harness 设计（两篇工程博客）

**来源**：
- [Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

**核心观点**：
> "Every component in a harness encodes an assumption about what the model can't do on its own."

**架构模式**：
- **三 Agent 架构**：Planner（需求展开）→ Generator（分 sprint 实现）→ Evaluator（用 Playwright 测试验收）
- **Generator-Evaluator 对抗循环**（GAN 式）：5-15 次迭代逐步提升质量
- **Sprint Contract**：执行前先协商验收标准（27 条 criteria），防止 scope creep
- **进度持久化**：`claude-progress.txt` + `feature_list.json` + git log，跨 context window 恢复
- **Context Reset**：弱模型需要清空 context 重新开始（Opus 4.6 可以不需要）

**关键发现**：
1. 模型自评质量差 → 必须独立 Evaluator，且需要多轮 prompt 调优
2. 模型升级时剥离不再需要的 harness 层 → harness 厚度应随模型能力自适应
3. Feature list 用 JSON 而非 Markdown → 模型不太会随意篡改结构化数据
4. 评估 criteria 的措辞会显著影响生成质量 → prompt 是一等公民

**验证结果**：
- Solo agent：20 分钟 $9，但功能不完整
- Full harness：6 小时 $200，功能完整且质量高
- 模型升级后简化 harness：3 小时 50 分 $124.70

### 3.2 superpowers 插件实际实现（v5.0.6）

**架构模式：Prompt-as-Harness**

superpowers 没有一行代码控制 agent 行为，全部靠 prompt 工程：

```
SessionStart Hook → 注入 using-superpowers（bootstrap skill）
  → "1% 规则"：可能相关就必须调用 skill
  → Red Flags 表：防止 LLM 跳过流程

Skill Tool 调用 → 加载 skill 到上下文
  → Iron Law：不可违反的硬规则
  → Hard Gate：必须完成 X 才能进入 Y
  → Checklist：必须创建 TodoWrite 逐项跟踪
  → 终态声明：brainstorming 结束只能调 writing-plans

Skill Chain（工作流编排）：
  brainstorming → writing-plans → subagent-driven-development
    → implementer (per task) → spec-reviewer → code-quality-reviewer
    → finishing-a-development-branch → verification-before-completion
```

**优势**：
- 极其灵活，用 markdown 就能定义复杂工作流
- 无代码依赖，跨平台（Claude Code / Gemini CLI / Cursor）
- 社区可贡献 skill

**局限**：
- 完全依赖模型指令遵循能力——Opus 有效，Qwen 可能无视
- 无法做代码级强制（Hard Gate 靠 prompt 说"不要"，不是代码阻止）
- 无法做结构化验证（verification skill 靠 LLM 自觉跑命令）

### 3.3 方案选型

**方案 A：纯 Prompt Harness（superpowers 模式）**
- 做法：把 superpowers 的 skill 格式搬到库里，纯 prompt 注入
- 优点：实现简单，灵活
- 缺点：对 Qwen 等弱模型不够可靠
- 结论：只适合强模型

**方案 B：纯 Code Harness（状态机模式）**
- 做法：用代码状态机控制所有工作流阶段转换
- 优点：100% 可靠，不依赖模型指令遵循
- 缺点：僵化，每个工作流都要写代码，失去灵活性
- 结论：太重

**方案 C：Prompt + Code 双层 Harness（按模型能力自适应）**
- 做法：强模型走 Prompt Skill（灵活），弱模型走 Code Skill（可靠）；harness 厚度由 ModelProfile.capabilityTier 驱动
- 优点：兼顾灵活性和可靠性
- 缺点：实现复杂度更高
- 结论：**选定此方案**

---

## 4. 决策与取舍

**采用方案 C：Prompt + Code 双层 Harness，按模型能力自适应。**

### 核心理由
1. 我们的核心场景是国产弱模型，纯 prompt 不够可靠
2. 同时要保持对 Claude/GPT 等强模型的轻量体验
3. capabilityTier 机制已在 ModelProfile 中存在，只需联动 harness 厚度

### 取舍说明
- 放弃纯 prompt 方案的极致灵活性（用户不能只靠 markdown 定义弱模型 skill）
- 换取弱模型场景的确定性（code 层强制 gate、格式校验、重试）
- 对强模型用户透明——capabilityTier ≥ 4 时自动降级为纯 prompt 模式

### 风险
- 双层系统维护成本较高——需要保持 prompt skill 和 code skill 行为一致
- capabilityTier 判断可能不准——需要实际评测校准

---

## 5. 技术方案

### 5.1 代码组织

在 ccclaw monorepo 内新增 `packages/agent-core`，零 ccclaw 依赖：

```
packages/
  agent-core/               ← 新建：通用 Agent 库
    src/
      index.ts              ← 公共 API 入口（createAgent）
      agent-loop.ts         ← 核心循环（从 agent-runtime/agent.ts 抽离）
      types.ts              ← 公共类型定义

      providers/            ← LLM Provider 抽象
        types.ts            ← LLMProvider 接口、ChatParams、StreamEvent
        base.ts             ← withRetry、sanitizeMessages
        anthropic.ts
        openai.ts
        gemini.ts
        compat.ts           ← OpenAI 兼容层（Qwen/DeepSeek/本地模型）
        factory.ts

      profiles/             ← Model Profile 系统
        model-profile.ts    ← Profile 类型定义
        registry.ts         ← ProfileRegistry
        alibaba.ts          ← ★ MVP：Qwen3.5-Plus 专项 Profile
        anthropic.ts        ← Claude Opus 4 / Sonnet 4 / Haiku 4（搬迁）
        _default.ts         ← 兜底 Profile（所有 OpenAI 兼容模型可用）

      tools/                ← 工具系统
        registry.ts         ← ToolRegistry
        types.ts            ← Tool、ToolSchema、ToolDefinition
        format.ts           ← 双模式格式转换 + 解析
        builtin/            ← 内置工具（bash、read、write、edit、grep、glob、web-fetch）

      context/              ← 上下文管理
        assembler.ts        ← ContextAssembler（通用版，无 ccclaw 依赖）
        consolidator.ts     ← 动态压缩
        token-estimator.ts

      prompt/               ← 分层 Prompt 系统（新设计）
        types.ts            ← PromptLayer 定义
        base.ts             ← 通用基础 prompt
        enhancers/          ← 按模型档位的增强 prompt
          tool-guidance.ts  ← 弱模型 tool call 教学
          chain-of-thought.ts ← 思考框架注入
          output-format.ts  ← 输出格式约束
        composer.ts         ← Prompt 分层组合器

      skills/               ← 双模式 Skill 系统（新设计）
        types.ts            ← Skill 类型定义（Prompt Skill + Code Skill）
        loader.ts           ← Skill 加载器
        prompt-skill.ts     ← 纯 prompt 注入（强模型）
        code-skill.ts       ← Code 强制 + prompt 注入（弱模型）

      harness/              ← Harness 自适应层（新模块）
        types.ts            ← Harness 配置类型
        adaptive.ts         ← 按 capabilityTier 选择 harness 厚度
        tool-reliability.ts ← Tool call 可靠性四层兜底
        evaluator.ts        ← 独立 Evaluator agent
        progress.ts         ← 进度持久化（checkpoint）

      memory/               ← Memory 系统
        types.ts
        store.ts            ← MemoryStore 接口
        sqlite-store.ts     ← SQLite 实现
        memory-store.ts     ← 纯内存实现（Headless 场景）

      planning/             ← Planning 系统
        planner.ts
        types.ts

      subagent/             ← Subagent 管理
        manager.ts
        types.ts

      mcp/                  ← MCP 客户端
        manager.ts
        types.ts

      hooks/                ← Hook 系统
        runner.ts
        types.ts

      verify/               ← Verify-Fix 系统
        registry.ts
        verifiers/

  agent-runtime/            ← 瘦身：只保留 ccclaw 特有逻辑
    src/
      index.ts              ← Runner 启动 + WS 通信
      protocol.ts           ← ccclaw 通信协议（AgentRequest 等）
      direct-server.ts      ← 直连服务
      file-watcher.ts       ← 文件监听
      handlers/             ← ccclaw 特有的 File/Tree handler
    package.json            ← 依赖 @ccclaw/shared + agent-core
```

依赖关系：

```
agent-core（零外部业务依赖，可独立发 npm）
    ↑
agent-runtime（agent-core + ccclaw Runner 协议）
    ↑
server（agent-runtime + 业务逻辑）
```

### 5.2 公共 API 设计

#### 5.2.1 最小化 API（场景 B：Headless Agent）

```typescript
import { createAgent } from '@anthropic-style/agent-core'

const agent = createAgent({
  model: 'qwen-max',
  apiKey: process.env.QWEN_API_KEY,
  apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  systemPrompt: '你是一个行业分析师，根据工具获取的数据撰写深度报告...',
  tools: [
    {
      name: 'search_industry_data',
      description: '搜索行业数据库',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          year: { type: 'number', description: '年份' },
        },
        required: ['query'],
      },
      execute: async ({ query, year }) => {
        return await myDB.search(query, year)
      },
    },
  ],
  maxIterations: 20,
})

// 同步模式：跑完拿结果
const result = await agent.run('分析 2025 年新能源汽车市场格局')
console.log(result.text)        // 最终报告
console.log(result.toolCalls)   // 过程中的所有 tool call 记录
console.log(result.usage)       // { inputTokens, outputTokens }
console.log(result.iterations)  // 迭代次数

// 流式模式
for await (const event of agent.stream('分析 2025 年新能源汽车市场格局')) {
  if (event.type === 'text_delta') process.stdout.write(event.delta)
  if (event.type === 'tool_result') console.log(`[${event.toolName}] done`)
  if (event.type === 'thinking_delta') // 推理过程
}
```

#### 5.2.2 完整 API（场景 A：编码助手）

```typescript
import { createAgent } from '@anthropic-style/agent-core'

const agent = createAgent({
  // === 基础配置 ===
  model: 'qwen-max',
  apiKey: process.env.QWEN_API_KEY,
  systemPrompt: '你是 AI 编程助手...',
  tools: [...customTools],
  maxIterations: 25,

  // === Prompt 增强（自动按模型档位生效）===
  promptEnhancements: {
    toolUseGuidance: true,     // 弱模型注入详细 tool call 教学
    chainOfThought: true,      // 注入 "先想后做" 思考框架
    outputFormat: true,        // 注入输出格式约束
  },

  // === Skill 系统 ===
  skills: {
    dirs: ['./skills'],        // Skill 目录
    inline: [chartSkill, researchSkill],  // 编程式 Skill
  },

  // === Memory（可选）===
  memory: {
    store: 'sqlite',           // 'sqlite' | 'memory' | 自定义 MemoryStore
    path: './workspace.db',
  },

  // === Planning（可选）===
  planning: {
    enabled: true,
    autoDetect: true,          // 自动检测是否需要 plan
  },

  // === Evaluator（可选）===
  evaluator: {
    enabled: true,
    model: 'qwen-max',        // 可以用同一个模型但独立上下文
    criteria: ['代码正确性', '测试覆盖', '安全性'],
    triggerAfter: 'final',     // 'each_tool' | 'each_iteration' | 'final'
  },

  // === Subagent（可选）===
  subagents: {
    enabled: true,
    maxConcurrent: 3,
  },

  // === MCP（可选）===
  mcp: {
    servers: {
      playwright: {
        command: 'npx',
        args: ['@anthropic/mcp-playwright'],
      },
    },
  },

  // === Hook（可选）===
  hooks: {
    beforeToolCall: async (name, input) => { /* ... */ },
    afterToolCall: async (name, input, result) => { /* ... */ },
  },

  // === Harness 配置（通常不需要手动设置，由 modelProfile 自动驱动）===
  harness: {
    // 覆盖自动检测的 harness 厚度
    tier: 'auto',              // 'auto' | 'light' | 'medium' | 'heavy'
    toolReliability: {
      structuredOutput: true,  // L1: JSON Mode 约束
      fuzzyJsonRepair: true,   // L2: 模糊 JSON 修复
      retryOnParseError: true, // L3: 解析失败重试
      metrics: true,           // L4: 可观测性
    },
  },
})
```

#### 5.2.3 Skill 定义 API

```typescript
// Prompt Skill（强模型用，类 superpowers 格式）
const diagramSkill: PromptSkill = {
  type: 'prompt',
  name: 'diagram',
  description: '当数据适合可视化时，生成图表',
  // 注入到 system prompt
  prompt: `
    ## 图表生成能力
    当分析数据适合可视化时，使用 generate_chart 工具生成图表。
    支持类型：柱状图、折线图、饼图、雷达图、热力图...
    决策规则：趋势数据用折线图，对比数据用柱状图...
  `,
  // 按模型档位提供不同强度的 prompt
  promptByTier: {
    strong: '数据可视化时调用 generate_chart',  // Opus: 一句话够了
    medium: '... 详细的决策规则 + 示例 ...',    // Qwen-Max: 需要教学
    weak: '... step-by-step 手把手教 ...',      // Qwen-Turbo: 每步都说
  },
  // 注册为工具
  tools: [generateChartTool],
}

// Code Skill（弱模型用，框架强制保障）
const tddSkill: CodeSkill = {
  type: 'code',
  name: 'tdd',
  description: 'Test-Driven Development 工作流',
  // 注入到 system prompt（和 Prompt Skill 一样）
  prompt: 'NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST...',
  // 代码级强制：lifecycle hooks
  hooks: {
    // 在写文件之前检查：是否先写了测试？
    beforeToolCall: async (toolName, input, state) => {
      if (toolName === 'write' || toolName === 'edit') {
        const filePath = input.file_path as string
        if (!filePath.includes('test') && !state.get('hasFailingTest')) {
          return {
            block: true,
            message: '请先编写失败的测试用例，再写实现代码。',
          }
        }
      }
      return { block: false }
    },
    // 验证 gate：测试必须先红再绿
    afterToolCall: async (toolName, input, result, state) => {
      if (toolName === 'bash' && result.includes('FAIL')) {
        state.set('hasFailingTest', true)
      }
      if (toolName === 'bash' && result.includes('PASS') && state.get('hasFailingTest')) {
        state.set('hasFailingTest', false) // reset for next cycle
      }
    },
  },
}
```

### 5.3 分层 Prompt 系统

当前 prompt 体系（29 行 base + 24 行 coding）为 Claude 设计，对弱模型不够。新系统分三层，互不覆盖：

```
┌──────────────────────────────────────────────────┐
│ Layer 1: 用户 systemPrompt（最高优先级）           │
│ → 用户完全自定义，库不修改                         │
├──────────────────────────────────────────────────┤
│ Layer 2: Prompt Enhancers（库内置，按模型档位生效）  │
│ → toolUseGuidance: 工具调用教学（弱模型详细，强模型跳过）│
│ → chainOfThought: "先想后做" 思考框架              │
│ → outputFormat: 输出格式约束                       │
│ → 由 capabilityTier 自动选择详细程度                │
├──────────────────────────────────────────────────┤
│ Layer 3: Skill 注入                               │
│ → always=true 的 Skill 全文注入                    │
│ → 其他 Skill XML 摘要                              │
│ → Skill 的 promptByTier 按模型档位选择版本          │
├──────────────────────────────────────────────────┤
│ Layer 4: 工具约束（ModelProfile 驱动）              │
│ → toolCallConstraints                              │
│ → 工具 schema 注入                                 │
└──────────────────────────────────────────────────┘
```

Prompt Enhancer 按 capabilityTier 自适应示例：

```typescript
// capabilityTier 5 (Opus): 不需要 tool call 教学
toolUseGuidance = '' // 跳过

// capabilityTier 3 (Qwen-Max): 需要详细教学
toolUseGuidance = `
## 工具调用规则
1. 每次只调用一个工具
2. 调用前先用一句话说明你要做什么
3. 调用格式示例：
   <tool name="read">{"file_path": "/path/to/file"}</tool>
4. 常见错误：不要把多个工具写在一起...
`

// capabilityTier 1-2 (Qwen-Turbo): 手把手教学 + 每步示例
toolUseGuidance = `
## 工具调用（必须严格遵守，每步都有示例）
### 第一步：思考你要做什么
在调用工具之前，先用一句话写出你的意图。
例如："我需要读取配置文件来了解项目结构"

### 第二步：选择正确的工具
[详细的工具选择决策树]

### 第三步：写出正确的调用格式
[每个工具的完整示例]

### 常见错误及修正
[错误示例 → 正确示例]
`
```

### 5.4 Harness 自适应层

核心思想（来自 Anthropic）：**每个 harness 组件是对模型缺陷的补偿，模型越强 harness 越薄。**

```typescript
// capabilityTier → harness 厚度映射
function resolveHarnessTier(profile: ModelProfile): HarnessTier {
  const tier = profile.routing?.capabilityTier ?? 3
  if (tier >= 5) return 'light'    // Opus: 纯 prompt，信任模型
  if (tier >= 3) return 'medium'   // Qwen-Max: prompt + 关键 code gate
  return 'heavy'                   // Qwen-Turbo: 全面 code 保障
}
```

各厚度级别的具体差异：

| 组件 | light（Opus） | medium（Qwen-Max） | heavy（Qwen-Turbo） |
|------|-------------|-------------------|---------------------|
| **Tool call 保障** | 原生 function calling，无额外处理 | 原生 + JSON 修复 + 解析失败重试 1 次 | CLI 文本模式 + 多格式探测 + 重试 2 次 + 结构化输出约束 |
| **Skill 模式** | Prompt Skill（纯 prompt 注入） | Prompt Skill + 关键 gate 用 code 强制 | Code Skill（状态机控制阶段转换） |
| **Prompt 增强** | 无额外 prompt | 中等详细度的 tool 教学 + 思考框架 | 手把手教学 + 每步示例 + 输出模板 |
| **单工具/多工具** | 允许并行 tool call | 限制单工具 per turn | 强制单工具 + 显式等待结果 |
| **Evaluator** | 可选 | 建议启用（final 阶段） | 强烈建议（每轮 iteration） |
| **上下文压缩** | 晚压缩（85% 触发） | 中等压缩（75% 触发） | 早压缩（65% 触发） |

### 5.5 Tool Call 可靠性四层兜底

```
┌─────────────────────────────────────────────────┐
│ L1: 结构化输出约束                               │
│   - 支持 JSON Mode 的模型启用 response_format    │
│   - 对 tool call 返回值做 schema 校验            │
│   - 不支持的模型跳过此层                          │
├─────────────────────────────────────────────────┤
│ L2: 解析容错（增强现有实现）                      │
│   - 模糊 JSON 修复（trailing comma, 单引号,      │
│     缺少引号的 key, 注释等）                      │
│   - 多格式探测（native → XML → JSON block        │
│     → 自然语言中抠 tool call）                    │
│   - 部分匹配提取（从混杂文本中提取有效 JSON）      │
├─────────────────────────────────────────────────┤
│ L3: 重试与纠正（新增）                            │
│   - 解析失败 → 注入错误信息重新请求 LLM：          │
│     "你上次的工具调用格式不对，正确格式是..."       │
│   - 最多重试 N 次（N 由 harness tier 决定）       │
│   - 第 N+1 次降级为纯文本                         │
├─────────────────────────────────────────────────┤
│ L4: 可观测性（新增）                              │
│   - tool call 总次数 / 成功次数 / 失败次数        │
│   - 按工具名、模型、格式错误类型分维度统计         │
│   - 通过回调暴露给调用方：                        │
│     onMetrics: (metrics: ToolMetrics) => void    │
└─────────────────────────────────────────────────┘
```

### 5.6 Extended Thinking 打通

当前问题：OpenAI adapter 声明了 extendedThinking 但没实现。MVP 只需适配 Qwen3.5-Plus + 保持 Anthropic 现有实现：

```typescript
// 统一配置入口
interface ThinkingConfig {
  enabled: boolean
  budgetTokens?: number        // Anthropic 专用
}

// Anthropic: 已有实现，改为可配置 budget
if (provider === 'anthropic' && caps.extendedThinking) {
  chatParams.thinking = {
    type: 'enabled',
    budget_tokens: config.thinkingBudget ?? 8192,
  }
}

// Qwen3.5-Plus: enable_thinking 参数
// 阿里百炼 OpenAI 兼容层支持此扩展参数
if (vendor === 'alibaba' && caps.extendedThinking) {
  chatParams.enable_thinking = config.thinkingEnabled ?? true
  chatParams.thinking_budget = config.thinkingBudget ?? 4096
  // 流式响应中 reasoning_content 字段包含思考过程
}
```

MVP 适配矩阵（只适配标 ★ 的，其他通过兼容层天然可用）：

| 模型 | 开启方式 | 流式字段 | 可关闭 | MVP 适配 |
|------|---------|---------|--------|---------|
| **Qwen3.5-Plus** | `enable_thinking` | `reasoning_content` | 是 | ★ 专项适配 |
| Claude Opus/Sonnet | `thinking.budget_tokens` | `thinking_delta` | 是 | ★ 已有实现 |
| 其他 OpenAI 兼容模型 | 各自不同 | 各自不同 | — | 默认 Profile 兜底 |

### 5.7 独立 Evaluator

来自 Anthropic harness 设计的核心模式：

```typescript
// Evaluator 作为独立 agent，拥有自己的 context
class Evaluator {
  constructor(
    private provider: LLMProvider,
    private criteria: string[],
  ) {}

  async evaluate(content: string, context?: string): Promise<EvalResult> {
    const prompt = `
你是一个独立的质量评审者。严格按照以下标准评估内容：

## 评估标准
${this.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 待评估内容
${content}

${context ? `## 上下文\n${context}` : ''}

## 输出格式
对每个标准给出：PASS / FAIL + 具体理由
最终结论：APPROVE / REJECT + 改进建议
`
    // ... 调用 LLM，解析结果
  }
}
```

在 Agent Loop 中的集成点由配置决定：
- `triggerAfter: 'final'`：所有迭代结束后评估最终输出
- `triggerAfter: 'each_iteration'`：每轮迭代后评估（重型，适合弱模型）
- `triggerAfter: 'each_tool'`：每次 tool call 结果后评估（超重型，特殊场景）

### 5.8 迁出策略

agent-core 在 monorepo 内成熟后，满足以下条件时独立仓库：
1. 有 **2+ 个外部项目** 真正在用
2. API **至少稳定 2-3 个迭代** 没有 breaking change
3. 需要 **独立的版本发布节奏**

迁出方式：`git subtree split -P packages/agent-core -b agent-core-standalone`

---

## 6. 从 agent-runtime 抽离的边界

### 进 agent-core（通用能力）

| 模块 | 当前文件 | 改动说明 |
|------|---------|---------|
| Agent Loop | `agent.ts` | 去除 ccclaw 协议依赖，接受通用配置 |
| LLM Providers | `llm/*.ts` | 直接搬迁，无 ccclaw 依赖 |
| Model Profiles | `llm/profiles/*.ts` | 直接搬迁 |
| ToolRegistry | `tool-registry.ts` | 直接搬迁 |
| Tool Format | `tool-format.ts` | 直接搬迁 + 增强 L1-L4 |
| ContextAssembler | `context-assembler.ts` | 去除 bootstrap files 硬编码路径，改为配置注入 |
| Consolidator | `consolidator.ts` | 直接搬迁 |
| SkillLoader | `skill-loader.ts` | 增加 Code Skill 支持 |
| Planner | `planner.ts` | 直接搬迁 |
| SubagentManager | `subagent-manager.ts` | 直接搬迁 |
| MCPManager | `mcp-manager.ts` | 直接搬迁 |
| WorkspaceDB | `workspace-db.ts` | 拆分接口（MemoryStore）+ 两个实现（SQLite / 内存） |
| HookRunner | `hook-runner.ts` | 直接搬迁 |
| VerifierRegistry | `verify/*.ts` | 直接搬迁 |
| Intent 分类 | `intent.ts` | 直接搬迁 |
| Prompts | `prompts/*.ts` | 重新设计为分层 Prompt 系统 |
| Token 估算 | `utils/token-estimator.ts` | 直接搬迁 |

### 留 agent-runtime（ccclaw 特有）

| 模块 | 文件 | 原因 |
|------|------|------|
| Runner 启动 | `index.ts` | ccclaw WS 通信协议 |
| 协议定义 | `protocol.ts` | 依赖 `@ccclaw/shared` |
| 直连服务 | `direct-server.ts` | ccclaw 直连通道 |
| 文件监听 | `file-watcher.ts` | ccclaw 工作区功能 |
| File Handler | `handlers/file-handler.ts` | 依赖 `@ccclaw/shared` 类型 |
| Tree Handler | `handlers/tree-handler.ts` | 依赖 `@ccclaw/shared` 类型 |

### agent-runtime 改造后的样子

```typescript
// agent-runtime 变为 agent-core 的薄封装
import { createAgent, type AgentConfig } from '@xxx/agent-core'
import type { AgentRequest } from '@ccclaw/shared'

export function createCCCLawAgent(config: RuntimeConfig) {
  // 把 ccclaw 配置转换为 agent-core 配置
  const agentConfig: AgentConfig = {
    model: config.modelId,
    apiKey: config.apiKey,
    tools: [...builtinCCCLawTools, ...config.customTools],
    memory: { store: 'sqlite', path: config.workspaceDbPath },
    skills: { dirs: config.skillDirs },
    mcp: config.mcpServers,
    // ...
  }
  return createAgent(agentConfig)
}
```

---

## 7. MVP 范围

### Phase 1：核心（2-3 周）

最小可用：能跑通 Headless 报告生成 demo。

- [ ] Agent Loop（从 agent-runtime 抽离，去除 ccclaw 依赖）
- [ ] Provider 抽象（Anthropic + OpenAI 兼容层，覆盖 Qwen/DeepSeek）
- [ ] Model Profile（搬迁 + thinking 打通）
- [ ] ToolRegistry（搬迁 + 自定义 tool 注册 API 简化）
- [ ] Tool Format（搬迁 + L2 解析增强）
- [ ] ContextAssembler（通用版，无 bootstrap 依赖）
- [ ] 分层 Prompt 系统（base + enhancers + composer）
- [ ] `createAgent()` 工厂函数 + `agent.run()` + `agent.stream()`
- [ ] 内存模式 MemoryStore（无 SQLite 依赖的轻量运行）
- [ ] 验证：Qwen-Max 跑通 Headless 报告生成 demo

### Phase 2：Harness 层（1-2 周）

工程级弱模型兜底。

- [ ] Tool call 可靠性 L1-L4
- [ ] Harness 自适应（capabilityTier → harness 厚度）
- [ ] Prompt Enhancers（tool guidance / CoT / output format，按 tier 分级）
- [ ] 独立 Evaluator
- [ ] 进度 Checkpoint 持久化

### Phase 3：Skill + 高级能力（1-2 周）

Skill 升级 + 完整能力迁移。

- [ ] Prompt Skill（兼容 superpowers 格式）
- [ ] Code Skill（lifecycle hooks + 代码级 gate）
- [ ] Skill promptByTier（按模型档位选择 prompt 版本）
- [ ] Planning 系统迁移
- [ ] Subagent 系统迁移
- [ ] MCP 客户端迁移
- [ ] SQLite MemoryStore

### Phase 4：agent-runtime 改造（1 周）

- [ ] agent-runtime 瘦身，改为依赖 agent-core
- [ ] ccclaw 端到端验证
- [ ] 回归测试通过

---

## 8. 验收标准

### 功能验收

1. **Headless 场景**：3 行代码启动 Agent，Qwen-Max 自主完成 10+ 轮 tool call 并输出报告
2. **编码助手场景**：agent-runtime 改造后，ccclaw 所有现有功能不受影响
3. **Skill 兼容**：能加载 superpowers 格式的 Prompt Skill 并正确注入
4. **Tool call 可靠性**：Qwen-Max 格式错误率从 ~20% 降到 ≤5%

### 质量验收

1. agent-core 零 ccclaw 依赖（`grep '@ccclaw' packages/agent-core/src/` 无结果）
2. 所有公共 API 有 TypeScript 类型定义
3. 核心模块有单元测试（agent-loop、tool-format、prompt-composer、harness-adaptive）
4. 有完整的 Headless demo 作为集成测试

### 性能验收

1. `createAgent()` 冷启动 < 100ms（无 SQLite、无 MCP 时）
2. 内存模式下无磁盘 I/O
3. Streaming 首 token 延迟不因 harness 层增加超过 50ms
