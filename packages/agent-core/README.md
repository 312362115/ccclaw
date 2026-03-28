# agent-core-sdk

通用 Agent Core 库 — 用国产大模型构建 AI Agent 的基础设施。

3 行代码启动一个 Headless Agent，自主多轮 tool call + 推理分析 + 结构化输出。

## Quick Start

```typescript
import { createAgent } from 'agent-core-sdk'

const agent = createAgent({
  model: 'qwen3.5-plus',
  apiKey: process.env.QWEN_API_KEY,
  apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  systemPrompt: '你是一位行业分析师，根据工具获取的数据撰写深度报告。',
  tools: [
    {
      name: 'search_data',
      description: '搜索行业数据',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
      execute: async ({ query }) => await myDB.search(query),
    },
  ],
})

const result = await agent.run('分析 2025 年新能源汽车市场格局')
console.log(result.text)       // 最终报告
console.log(result.toolCalls)  // 所有 tool call 记录
console.log(result.usage)      // { inputTokens, outputTokens }
```

## 安装

### 方式 1：同 monorepo 内

```json
// package.json
{
  "dependencies": {
    "agent-core-sdk": "workspace:*"
  }
}
```

### 方式 2：独立项目（开发阶段，pnpm link）

```bash
# 在 agent-core 目录注册全局链接
cd /path/to/ccclaw/packages/agent-core
pnpm build
pnpm link --global

# 在你的项目中引用
cd /path/to/your-project
pnpm link --global agent-core-sdk
```

### 方式 3：发布到 npm

```bash
cd /path/to/ccclaw/packages/agent-core
pnpm build
npm publish
```

```bash
# 其他项目
pnpm add agent-core-sdk
```

## 核心 API

### createAgent(config)

创建一个 Agent 实例。

```typescript
const agent = createAgent({
  // === 必填 ===
  model: 'qwen3.5-plus',          // 模型 ID
  apiKey: 'sk-xxx',                // API Key

  // === 常用 ===
  apiBase: 'https://...',          // API 地址（非 OpenAI 模型必填）
  systemPrompt: '你是...',         // 系统提示词（最高优先级）
  tools: [...],                    // 自定义工具
  maxIterations: 25,               // 最大循环轮数（默认 25）
  thinking: true,                  // 启用推理/思考模式

  // === Prompt 增强（按模型能力自动生效）===
  promptEnhancements: {
    toolUseGuidance: true,         // 工具调用教学（弱模型详细，强模型跳过）
    chainOfThought: true,          // "先想后做" 思考框架
    outputFormat: true,            // 输出格式约束
  },

  // === 可选高级能力 ===
  evaluator: { ... },             // 独立 Evaluator
  harness: { ... },               // Harness 厚度覆盖
  onEvent: (event) => { ... },    // 事件回调
})
```

### agent.run(message)

运行到完成，返回结果。

```typescript
const result = await agent.run('你的任务描述')

result.text        // string — 最终文本输出
result.toolCalls   // Array<{ name, input, output }> — 工具调用记录
result.usage       // { inputTokens, outputTokens } — token 消耗
result.iterations  // number — 循环迭代次数
result.evaluation  // EvalResult | undefined — 评估结果（如果启用了 Evaluator）
```

### agent.stream(message)

流式输出，AsyncIterable。

```typescript
for await (const event of agent.stream('你的任务描述')) {
  switch (event.type) {
    case 'text_delta':     process.stdout.write(event.delta); break
    case 'thinking_delta': /* 推理过程 */ break
    case 'tool_result':    console.log(`[${event.toolName}] done`); break
    case 'session_done':   console.log('完成', event.usage); break
  }
}
```

## 自定义工具

```typescript
const tool = {
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  schema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
    },
    required: ['city'],
  },
  execute: async (input) => {
    const resp = await fetch(`https://api.weather.com/${input.city}`)
    return await resp.text()
  },
}
```

工具的 `execute` 返回 `string`。Agent 会自主决定何时调用哪个工具、调用多少轮。

## 模型支持

MVP 专项适配 **Qwen3.5-Plus**，其他 OpenAI 兼容模型通过兼容层直接可用：

```typescript
// Qwen3.5-Plus（专项优化）
createAgent({ model: 'qwen3.5-plus', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', ... })

// DeepSeek
createAgent({ model: 'deepseek-chat', apiBase: 'https://api.deepseek.com/v1', ... })

// Kimi
createAgent({ model: 'kimi-k2.5', apiBase: 'https://api.moonshot.cn/v1', ... })

// 本地模型（Ollama）
createAgent({ model: 'llama3', apiBase: 'http://localhost:11434/v1', ... })

// 任意 OpenAI 兼容 API
createAgent({ model: 'your-model', apiBase: 'https://your-api.com/v1', ... })
```

## Harness 自适应

库会根据模型能力档位自动调整 harness 厚度，用工程手段补偿弱模型：

| 能力档位 | 模型示例 | Harness | 行为 |
|---------|---------|---------|------|
| 5 (强) | Claude Opus | light | 纯 prompt，信任模型 |
| 3-4 (中) | Qwen3.5-Plus | medium | prompt + 单工具限制 + JSON 修复 + 重试 |
| 1-2 (弱) | Qwen-Turbo | heavy | CLI 文本模式 + 详细教学 + 多次重试 |

可手动覆盖：

```typescript
createAgent({
  harness: { tier: 'heavy' },  // 强制使用重型 harness
})
```

## 独立 Evaluator

基于 Anthropic harness 设计：模型自评不靠谱，用独立 Evaluator 评估输出质量。

```typescript
const agent = createAgent({
  evaluator: {
    enabled: true,
    criteria: [
      { name: '数据完整性', description: '报告中的数据是否来自工具获取，有出处' },
      { name: '逻辑一致性', description: '结论是否与数据吻合，无自相矛盾' },
      { name: '格式规范', description: '是否使用 Markdown，标题层级清晰' },
    ],
    threshold: 70,  // 70 分以上通过
  },
})

const result = await agent.run('...')
console.log(result.evaluation?.approved)    // true/false
console.log(result.evaluation?.overallScore) // 0-100
console.log(result.evaluation?.suggestions)  // 改进建议
```

## Skill 系统

两种模式：Prompt Skill（强模型）和 Code Skill（弱模型）。

### Prompt Skill — 文本注入

```typescript
const chartSkill = {
  type: 'prompt',
  name: 'chart',
  description: '图表生成能力',
  prompt: '当数据适合可视化时，使用 generate_chart 工具...',
  promptByTier: {
    strong: '可视化数据时调用 generate_chart',
    medium: '## 图表生成规则\n1. 趋势用折线图\n2. 对比用柱状图...',
    weak: '## 图表生成（每步说明）\n### 第一步：判断是否需要图表...',
  },
  tools: [generateChartTool],
  always: true,
}
```

### Code Skill — 代码强制

```typescript
const tddSkill = {
  type: 'code',
  name: 'tdd',
  description: 'TDD 工作流',
  prompt: 'NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST',
  hooks: {
    beforeToolCall: async (toolName, input, state) => {
      if (toolName === 'write' && !state.get('hasFailingTest')) {
        return { block: true, message: '请先写失败的测试用例' }
      }
      return { block: false }
    },
  },
}
```

### 加载 Skill

```typescript
createAgent({
  skills: {
    dirs: ['./skills'],                          // 从目录加载 SKILL.md
    inline: [chartSkill, tddSkill],              // 编程式 Skill
  },
})
```

## Memory

两种存储后端：内存（默认）和 SQLite（持久化）。

```typescript
import { InMemoryStore, SQLiteMemoryStore } from 'agent-core-sdk'

// 内存模式（Headless 场景，无磁盘 I/O）
const memory = new InMemoryStore()

// SQLite 模式（需要 better-sqlite3）
const memory = new SQLiteMemoryStore('./workspace.db')

// 分层 Memory
memory.upsertMemory('auth-decision', 'decision', '选择 Redis session 方案...')
memory.upsertMemory('user-pref', 'feedback', '用户偏好简洁回复...')
const results = memory.searchMemories('session')
```

## Planning

自动检测复杂任务并生成执行计划：

```typescript
import { shouldPlan, generatePlan, formatPlanForDisplay } from 'agent-core-sdk'

if (shouldPlan(userMessage)) {
  const plan = await generatePlan({ provider, model, message: userMessage })
  console.log(formatPlanForDisplay(plan))
}
```

## 架构

```
createAgent()
  ├── Provider（OpenAI 兼容层 → Qwen / DeepSeek / Kimi / ...）
  ├── ToolRegistry（自定义工具注册 + 执行）
  ├── ProfileRegistry（模型能力声明 + 参数优化）
  ├── ContextAssembler（分层 Prompt 组装）
  │     ├── Layer 1: 用户 systemPrompt
  │     ├── Layer 2: Prompt Enhancers（按模型档位自动增强）
  │     ├── Layer 3: Skill 注入
  │     └── Layer 4: 工具约束
  ├── Harness（自适应兜底层）
  │     ├── Tool Reliability（JSON 修复 + 重试 + 可观测）
  │     └── Evaluator（独立质量评估）
  └── AgentLoop（多轮迭代：LLM → tool call → execute → feedback）
```

## 开发

```bash
# 安装
pnpm install

# 测试
pnpm test          # 199 tests

# 类型检查
pnpm typecheck

# 构建
pnpm build
```

## License

MIT
