# Agent Core 重构设计文档

> CCCLaw Agent 核心重构 — 多 Provider 支持、去 SDK 化、强化上下文/工具/记忆/技能体系
>
> 主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

---

## 一、重构目标

将 agent-runtime 从 Claude SDK 绑定的单 Provider 架构，重构为**基于任意 LLM 的通用 Agent 核心**：

- **多 Provider 支持**：原生 API 适配（Claude/OpenAI/Gemini）+ OpenAI 兼容协议兜底
- **多认证方式**：API Key + OAuth 登录（Claude/Gemini/Qwen 官方 OAuth）
- **去 SDK 化**：删除 `@anthropic-ai/claude-code` 和 `@anthropic-ai/sdk`，全部用原生 fetch 直调 API
- **工具统一**：所有 Provider 共享同一套自建工具，行为一致、安全管控统一
- **上下文增强**：滑动窗口压缩、Provider capabilities 感知、PreCompact 权限收窄
- **流式事件扩充**：4 种 → 12 种，前端展示更丰富
- **借鉴 HappyClaw**：Intent 快速分类、PreCompact 权限收窄、流式事件体系、飞书流式卡片

---

## 二、LLM Provider 抽象层

### 2.1 核心接口

```typescript
interface LLMProvider {
  /** 非流式调用 */
  chat(params: ChatParams): Promise<ChatResponse>;
  /** 流式调用 */
  stream(params: ChatParams): AsyncIterable<StreamEvent>;
  /** 该 Provider 支持的能力 */
  capabilities(): ProviderCapabilities;
}

interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;        // 支持取消（stop intent 可中断当前 LLM 调用）
  // Provider 特有参数（适配器内部处理，不支持则忽略）
  thinkingConfig?: { enabled: boolean; budgetTokens?: number };
  cacheControl?: CacheHint[];  // CacheHint = { type: 'ephemeral' }，仅 Claude 生效
}

interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;            // 支持 function calling
  extendedThinking: boolean;   // 支持 thinking
  promptCaching: boolean;      // 支持 cache_control
  vision: boolean;             // 支持图片输入
  contextWindow: number;       // 上下文窗口大小 (tokens)
  maxOutputTokens: number;     // 最大输出 token
}
```

### 2.2 适配器路由

```
LLMProviderFactory.create(config) → LLMProvider
  │
  ├── type='claude'   → AnthropicAdapter (fetch 直调 Messages API)
  ├── type='openai'   → OpenAIAdapter (fetch 直调 Chat Completions API)
  ├── type='gemini'   → GeminiAdapter (fetch 直调 Gemini API)
  └── type=其他       → CompatAdapter (OpenAI 兼容协议兜底)
```

**关键设计决策**：

- **零 SDK 依赖**：所有适配器用 Node.js 原生 `fetch` 直接调用各家 REST API
- **OAuth 不是独立 Provider**：OAuth 是认证方式，同一个 AnthropicAdapter 可以用 API Key 或 OAuth token
- **Runner 侧不感知 OAuth**：Server 负责 token 管理（获取/刷新），Runner 只接收一个可用的 token/key
- **CompatAdapter 兜底**：任何 OpenAI 兼容的 Provider（DeepSeek、Mistral、Ollama 等）都能接入
- **capabilities() 驱动降级**：Agent Loop 根据能力自动跳过不支持的特性
- **Factory 错误处理**：`config.type` 不在已知列表中时降级为 CompatAdapter（而非报错），`config.apiKey` 缺失时抛出 `ProviderConfigError`（携带缺失字段信息）

### 2.3 流式事件统一

事件分两层：**LLM 适配器层**（由 Provider adapter 发射）和 **Agent Loop 层**（由 agent loop 发射）。

**LLM 适配器层事件**（adapter 内部统一转换）：

```typescript
type LLMStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_use_start'; toolId: string; name: string }
  | { type: 'tool_use_delta'; toolId: string; input: string }
  | { type: 'tool_use_end'; toolId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { type: 'error'; message: string };
```

**Agent Loop 层事件**（agent loop 在 LLM 事件基础上追加）：

```typescript
type AgentStreamEvent =
  | LLMStreamEvent
  | { type: 'tool_result'; toolId: string; output: string }
  | { type: 'confirm_request'; requestId: string; tool: string; input: Record<string, unknown>; reason: string }
  | { type: 'subagent_started'; taskId: string; label: string }
  | { type: 'subagent_result'; taskId: string; output: string }
  | { type: 'consolidation'; message: string }
  | { type: 'session_done'; sessionId: string; tokens: { inputTokens: number; outputTokens: number } };
```

> **关键区分**：`done`（LLM 层，携带 `stopReason`，驱动 Agent Loop 循环/退出决策）vs `session_done`（Agent 层，整轮结束后发射，携带累计 token）。tool_result / confirm_request / subagent_* / consolidation 都由 Agent Loop 发射，不来自 LLM adapter。

### 2.4 各家 API 适配要点

**AnthropicAdapter**：
- 端点：`POST https://api.anthropic.com/v1/messages`
- Header：`x-api-key` 或 `Authorization: Bearer {oauth_token}`
- 工具格式：`tools[]` 参数，tool_use content block
- 特有能力：extended thinking（`thinking` 参数）、prompt caching（`cache_control`）
- 流式：SSE，event 类型 `content_block_start/delta/stop`、`message_delta`

**OpenAIAdapter**：
- 端点：`POST https://api.openai.com/v1/chat/completions`
- Header：`Authorization: Bearer {api_key}`
- 工具格式：`tools[]` 参数，`tool_calls` 在 message 中
- 流式：SSE，`data: {"choices":[{"delta":...}]}`

**GeminiAdapter**：
- 端点：`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`
- Header：`Authorization: Bearer {oauth_token}`
- 工具格式：`tools[].functionDeclarations`，使用 Gemini 的 `Schema` 对象格式（与 JSON Schema 类似但有差异，需要转换）
- 工具结果：通过 `functionResponse` parts 返回（不同于 OpenAI 的独立 tool message）
- 流式：SSE，`candidates[].content.parts[]`，**注意**：单个 candidate 中可能同时包含 text 和 functionCall parts，需要分别处理
- 特殊处理：Gemini 的 `safetyRatings` 可能导致响应被拦截，需要检测并返回有意义的错误

**CompatAdapter**：
- 继承 OpenAIAdapter，仅覆盖 `apiBase` 配置（避免重复实现 SSE 解析和 tool_calls 映射）
- 构造时传入 `apiBase` 指向目标端点
- 用于 DeepSeek、Mistral、本地 Ollama、vLLM 等

### 2.5 重试与容错

从现有 `llm-client.ts` 迁移，所有适配器共享：

```typescript
const RETRY_DELAYS = [1000, 2000, 4000]; // 指数退避

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientError(err) || attempt === RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
}

// 瞬态错误：429、5xx、timeout、connection
// 非瞬态：400、401、403、404 → 直接抛出
```

空内容消毒、图片降级等容错逻辑也迁移至基类 `BaseLLMProvider`。

---

## 三、Agent Loop 重构

### 3.1 主循环

```
收到用户消息
  ↓
Intent 分类 (stop/correction/continue)
  ├── stop → 终止当前 Agent Loop，返回确认
  ├── correction → 标记上一轮为无效，重新执行
  └── continue ↓
  ↓
ContextAssembler.assemble() → systemPrompt + history
  ↓
ToolRegistry.getDefinitions() → tools[]
  ↓
根据 capabilities：
  ├── toolUse=true  → tools 走 API 参数（Function Call 模式）
  └── toolUse=false → tools 注入 systemPrompt（CLI 模式）
  ↓
┌─ Agent Loop (max N iterations) ─────────────────┐
│  LLMProvider.stream(params)                      │
│    ↓ 流式事件                                    │
│    ├── text_delta → 转发客户端                    │
│    ├── thinking_delta → 转发客户端（如支持）       │
│    ├── tool_use_start → 转发客户端                │
│    ├── tool_use_delta → 转发客户端                │
│    ├── tool_use_end → 执行工具                    │
│    │   ├── ToolGuard.check() → allow/block/confirm│
│    │   ├── 权限收窄检查（整合中？只允许 memory）   │
│    │   └── ToolRegistry.execute() → result        │
│    │   └── CLI 模式：从文本解析 tool_call          │
│    └── done → 检查 stopReason                     │
│         ├── tool_use → 继续循环                    │
│         └── end_turn → 退出循环                    │
└──────────────────────────────────────────────────┘
  ↓
保存 assistant 消息到 DB
  ↓
滑动压缩检查
  ↓
Log 记忆合并检查
  ↓
返回 done { tokens, sessionId }
```

### 3.2 Intent 快速分类

消息入队前做意图分类，不走 LLM（零成本关键词匹配）：

```typescript
type Intent = 'stop' | 'correction' | 'continue';

function classifyIntent(message: string): Intent {
  const normalized = message.trim().toLowerCase();

  // 仅匹配斜杠命令或完整短语，避免误判（如"重新设计组件"不应是 correction）
  const stopExact = ['/stop', '/cancel'];
  const stopFull = ['停止', '取消'];
  if (stopExact.some(p => normalized === p) ||
      stopFull.some(p => normalized === p)) return 'stop';

  const correctionExact = ['/retry', '/redo'];
  const correctionFull = ['重来', '重试'];
  if (correctionExact.some(p => normalized === p) ||
      correctionFull.some(p => normalized === p)) return 'correction';

  return 'continue';
}
```

**correction 的具体语义**：

1. 将当前 session 最后一个完整的用户轮次组（user 消息 + 后续 assistant/tool 消息）标记为 `role='system'`（保留在 DB 中用于审计，但不再参与上下文组装）
2. **不回滚** `lastConsolidated`（已压缩的消息不受影响）
3. **不撤销副作用**（已执行的文件写入、git commit 等不可逆）— 在 correction 消息前追加系统提示："上一轮操作的结果仍然存在于文件系统中，请在新一轮中考虑这些变更"
4. 然后正常进入 Agent Loop 处理用户的新消息

**stop 的具体语义**：

1. 如果 Agent Loop 正在执行 → 通过 `AbortSignal` 取消当前 LLM 调用
2. 等待进行中的工具执行完成（不强制终止工具，避免文件写入中断导致损坏）
3. 发送 `session_done` 事件给客户端
4. 不删除任何消息

### 3.3 Capabilities 感知

```typescript
const caps = provider.capabilities();

// 不支持 thinking 的模型跳过
if (!caps.extendedThinking) {
  delete params.thinkingConfig;
}

// 不支持 vision 的模型降级
if (!caps.vision) {
  params.messages = params.messages.map(m => stripImageContent(m));
}

// 不支持 function calling 的模型用 CLI 模式
if (!caps.toolUse) {
  params.systemPrompt += formatToolsAsCLI(tools);
  delete params.tools;
}
```

---

## 四、工具系统

### 4.1 双模式工具调用

**Function Call 模式（优先）**— 模型原生支持 tool_use 时：

工具定义通过 API `tools` 参数传递（不占 system prompt token），模型返回结构化的 tool_call。

**CLI 模式（降级）**— 模型不支持 function calling 时：

工具以简洁的 CLI 格式注入 prompt：

```
## Tools
bash <command>           # Execute shell command
file read <path>         # Read file content
file write <path>        # Write file (content via stdin)
git <args>               # Run git command
glob <pattern>           # Find files by pattern
grep <pattern> [path]    # Search file contents
memory write <name> <type>  # Save memory
memory read [name]       # Read memory
memory search <query>    # Search memories

To use a tool, respond with:
<tool name="bash" args="ls -la" />
```

一个工具一行，比 MCP JSON Schema 省 90%+ token。

从 assistant 回复中解析工具调用（容错解析，不依赖严格格式）：

```typescript
function parseToolCallsFromText(text: string): ToolCall[] {
  // 主正则：匹配 XML 风格工具调用
  const xmlRegex = /<tool\s+name="([^"]+)"(?:\s+[^>]*)?\s*(?:\/>|>([\s\S]*?)<\/tool>)/g;

  // 提取属性（支持转义引号）
  function parseAttrs(tag: string): Record<string, string> {
    const attrRegex = /(\w+)="((?:[^"\\]|\\.)*)"/g;
    // ...
  }

  // 降级：如果 XML 解析失败，尝试 JSON 块解析
  // ```tool\n{"name":"bash","args":{"command":"ls"}}\n```
  const jsonBlockRegex = /```tool\n([\s\S]*?)\n```/g;

  // 两种格式都无法解析时返回空数组，Agent Loop 视为纯文本回复
}
```

> CLI 模式的模型遵从度本身不确定，解析需要更宽容。提供两种解析路径（XML + JSON block）并做好降级。

### 4.2 MCP 补齐

当前 `mcp-manager.ts` 的 `discoverTools()` 返回空数组。补齐为完整的 MCP JSON-RPC 客户端：

**三种传输层实现**：

```typescript
interface MCPTransport {
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  close(): void;
}

class StdioTransport implements MCPTransport {
  // spawn 子进程，通过 stdin/stdout JSON-RPC 通信
  // 原子写入 stdin，读 stdout 按行解析 JSON，匹配 request id
}

class SSETransport implements MCPTransport {
  // fetch + EventSource 读响应
}

class StreamableHttpTransport implements MCPTransport {
  // fetch POST JSON-RPC，支持流式响应
}
```

**MCP 协议只需 3 个方法**：

```
initialize   → 握手（capabilities 交换）
tools/list   → 获取工具列表
tools/call   → 执行工具调用
```

不需要 `@modelcontextprotocol/sdk`，自行实现 JSON-RPC 协议。

**MCP 工具注册**：

MCP 工具发现后，注册到 ToolRegistry，统一走 Function Call / CLI 格式。不走 MCP 原始的 system prompt 注入方式（省 token）。

### 4.3 ToolRegistry 增强

**受限模式**（配合 PreCompact 权限收窄）：

```typescript
class ToolRegistry {
  private restrictedTools: Set<string> | null = null;

  enterRestrictedMode(allowedTools: string[]) {
    this.restrictedTools = new Set(allowedTools);
  }

  exitRestrictedMode() {
    this.restrictedTools = null;
  }

  async execute(name: string, params: Record<string, unknown>): Promise<string> {
    if (this.restrictedTools && !this.restrictedTools.has(name)) {
      return `Error: Tool "${name}" is not available during context consolidation.`;
    }
    // ... 现有逻辑（参数修正、schema 校验、结果截断）
  }
}
```

**工具格式转换**：

```typescript
// Function Call 格式 → API tools 参数
function toFunctionCallFormat(tools: ToolDefinition[]): APIToolDef[] { ... }

// CLI 格式 → system prompt 追加
function toCLIFormat(tools: ToolDefinition[]): string { ... }
```

### 4.4 内置工具

保持现有内置工具不变（6 个基础工具 + 3 个记忆工具 + 2 个待办工具 + 1 个子 Agent 工具 = 12 个工具名）：

| 工具 | 说明 |
|------|------|
| bash | Shell 执行（120s 超时，1MB 输出限制） |
| file_read / file_write | 文件读写（路径校验） |
| git | Git 命令（30s 超时） |
| glob | 文件模式搜索 |
| grep | 内容搜索 |
| web_fetch | HTTP 请求（30s 超时，50KB 截断） |
| memory_write / memory_read / memory_search | 记忆管理（3 个独立工具） |
| todo_read / todo_write | 待办管理（2 个独立工具） |
| spawn | 子 Agent 调用 |

---

## 五、上下文管理体系

### 5.1 上下文组装（7 步）

保持现有 7 步组装顺序，增加 capabilities 感知：

```
1. Bootstrap 文件 (AGENTS.md / SOUL.md / USER.md / TOOLS.md)
2. 用户偏好（语言、风格、自定义规则）
3. 记忆分级注入
   A. 必注入层：decision + feedback → 全文内联
   B. 索引层：project + reference → XML 摘要列表
   C. 搜索层：log → 不主动注入
4. Skills（always 全文 / 其他 XML 摘要）
5. 工具定义 → toolUse=true 时走 API tools 参数，不占 prompt
               toolUse=false 时 CLI 格式注入 prompt
6. MCP 工具 → 同上
7. Session 历史 (messages[lastConsolidated:])
```

### 5.2 滑动窗口压缩

**替代原有的阈值批量压缩**（旧设计：50% 触发、批量压到 30%），改为渐进式滑动压缩：

```
每轮 Agent Loop 结束后：
  未压缩消息 token > contextWindow * 0.3?
    → 压缩最旧的 1 个用户轮次组
    → 调用 LLM（纯文本生成，不启用 tools）生成摘要
    → 写入 log 记忆
    → 更新 lastConsolidated
    → 小步快跑，每次压缩量小、LLM 调用快

硬截断兜底：
  总 token > contextWindow * 0.8?
    → 不走 LLM，直接截断旧消息存为 log 记忆
    → 防止上下文溢出崩溃
```

> **与旧设计的区别**：旧设计 50% 触发一次性压缩大块消息（量大、耗时、信息集中丢失）。新设计 30% 触发但每次只压 1 个轮次组（量小、快、信息损失平滑）。30% 看起来更早触发，但因为每次只压一小组，实际 LLM 调用成本更低。

**用户轮次组**：一个 user 消息 + 后续所有 assistant/tool 消息，不在 tool_use 和 tool_result 之间切割。

### 5.3 PreCompact 权限收窄

整合的 LLM 调用使用**纯文本生成模式**（不传 `tools` 参数），LLM 只做摘要输出，不会触发工具调用。因此权限收窄是**防御性设计** — 防止未来整合逻辑变更意外引入工具调用：

```
正常模式：所有工具可用
  ↓ 触发整合
整合模式：ToolRegistry.enterRestrictedMode(['memory_write', 'memory_read', 'memory_search'])
  ↓ LLM 纯文本摘要 + memory_write 保存
  ↓ 整合完成
ToolRegistry.exitRestrictedMode() → 恢复正常模式
```

### 5.4 Provider 感知

上下文窗口大小从 capabilities 获取，不再硬编码 200K：

```typescript
const contextWindow = provider.capabilities().contextWindow;
// 切换到 GPT-4o (128K) 或 Ollama (8K) 时自动适配
```

图片降级：不支持 vision 的模型自动移除图片内容。

---

## 六、记忆系统

### 6.1 保持不变

- 5 类记忆：decision / feedback / project / reference / log
- 三层注入：必注入（全文）/ 索引（XML 摘要）/ 搜索（按需）
- workspace.db memories 表结构
- memory_write / memory_read / memory_search 三个工具
- 同名覆盖（log 除外，log 每次新建）
- 必注入层超长 LLM 压缩（4KB 阈值）

### 6.2 滑动压缩记忆合并

滑动压缩产出的 log 记忆可能碎片化。当同一 session 的 log 记忆总 token 超过 4000 或条数超过 15 条时触发合并（token 优先，避免少量大条目和大量小条目的行为差异）：

```
log: "session-001" → "讨论了数据库索引"
log: "session-002" → "决定加复合索引"
... 10 条
  ↓ LLM 合并
log: "session-summary" → "完成了数据库索引优化，给 users 表增加了复合索引..."
  ↓ 删除原始 10 条
```

合并失败时不阻塞，下次再试。

### 6.3 关键词搜索增强

向量搜索暂不启用（embedding 字段保留），增强关键词搜索为多词 AND 匹配：

```sql
-- "数据库 索引" → 两个词都必须命中
WHERE content LIKE '%数据库%' AND content LIKE '%索引%'
```

### 6.4 记忆清理

- log 类型：超过 90 天自动清理（定时任务）
- 其他类型：不自动清理，用户手动管理

---

## 七、Skill 体系增强

### 7.1 保持不变

- 三类 Skill：知识 / 声明式可执行 / 隐式可执行
- 五层安全：安装扫描 → trust 级别 → ToolGuard → Docker 沙箱 → bash 策略
- SKILL.md frontmatter 解析 + 依赖检查（bins/env/runtime）
- 可执行 Skill 注册为 ToolRegistry 工具

### 7.2 新增：Skill 市场对接

```
用户点"浏览市场"
  → GET /api/skills/marketplace?q=...
  → Server 代理请求 Skill 源 API
  → 返回列表

用户点"安装"
  → 下载到 internal/skills/{name}/
  → 安全扫描（10 种高风险模式）
  → 隐式可执行弹警告
  → 依赖检查 + 安装
  → 写入 skills 表（source='marketplace'）
```

**Skill 源抽象**（不硬绑某一个市场）：

```typescript
interface SkillSource {
  search(query: string, page?: number): Promise<SkillListing[]>;
  download(id: string): Promise<SkillPackage>;
}

class SkillsShSource implements SkillSource { ... }   // skills.sh
class GitHubSource implements SkillSource { ... }      // GitHub repo
```

### 7.3 新增：Skill 版本管理

skills 表新增字段：

```sql
ALTER TABLE skills ADD COLUMN version text;           -- 当前版本
ALTER TABLE skills ADD COLUMN source_url text;        -- 来源 URL
ALTER TABLE skills ADD COLUMN latest_version text;    -- 已知最新版本
```

**版本检查**：定时任务每日查询 marketplace Skill 最新版本，有更新时在 WebUI 显示"可更新"标记。

**系统预置 Skill 升级策略**：
- 对比 content hash，用户未修改过的可选择性自动升级
- 用户已修改过的不覆盖，仅提示有新版本

---

## 八、Server 侧 Provider OAuth

### 8.1 OAuth 流程

```
用户点"通过 OAuth 登录"
  ↓
GET /api/oauth/:type/authorize   (type = claude / gemini / qwen)
  → 生成 state + PKCE code_verifier
  → 存入 oauth_states 临时表
  → 302 跳转到各家授权页
  ↓
用户在各家页面授权
  ↓
GET /api/oauth/:type/callback?code=xxx&state=yyy
  → 验证 state
  → POST 各家 token 端点换取 access_token + refresh_token
  → AES-256-GCM 加密存入 providers 表
  → 跳转回设置页
```

### 8.2 各家 OAuth 端点配置

```typescript
const OAUTH_ENDPOINTS: Record<string, OAuthConfig> = {
  claude: {
    authorizeUrl: 'https://console.anthropic.com/oauth/authorize',  // 待确认
    tokenUrl:     'https://console.anthropic.com/oauth/token',      // 待确认
    scopes:       ['messages:write'],                                // 待确认
    status:       'pending',  // Anthropic 尚未公开 OAuth API，需关注发布动态
  },
  gemini: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',  // Google 标准 OAuth
    tokenUrl:     'https://oauth2.googleapis.com/token',
    scopes:       ['https://www.googleapis.com/auth/generative-language'],
    status:       'available',
  },
  qwen: {
    authorizeUrl: 'https://auth.aliyun.com/authorize',             // 待确认
    tokenUrl:     'https://auth.aliyun.com/token',                 // 待确认
    scopes:       ['qwen:chat'],                                    // 待确认
    status:       'pending',  // 阿里云 OAuth scope 需确认
  },
};
```

> **重要**：Claude 和 Qwen 的 OAuth 端点标记为 `pending`，实现时需确认各家最新文档。未开放 OAuth 的 Provider 降级为仅支持 API Key 认证。Gemini（Google OAuth）是标准流程，可优先实现。

### 8.3 Token 自动刷新

```typescript
class OAuthTokenManager {
  async getToken(provider: Provider): Promise<string> {
    const state = decrypt(provider.oauthState);
    // 提前 5 分钟刷新
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const newTokens = await this.refresh(provider.type, state.refreshToken);
      await this.updateProviderTokens(provider.id, newTokens);
      return newTokens.accessToken;
    }
    return state.accessToken;
  }
}
```

### 8.4 DB 变更

**providers 表扩展**：

```sql
ALTER TABLE providers ADD COLUMN oauth_state jsonb;
-- {
--   accessToken: "加密",
--   refreshToken: "加密",
--   expiresAt: "ISO 8601",
--   scope: "..."
-- }
```

**新增 oauth_states 临时表**：

```sql
CREATE TABLE oauth_states (
  state         text PK,
  userId        text NOT NULL,
  type          text NOT NULL,       -- claude / gemini / qwen
  codeVerifier  text NOT NULL,       -- PKCE
  expiresAt     timestamp NOT NULL,  -- 10 分钟过期
  createdAt     timestamp
);
```

### 8.5 环境变量

```bash
OAUTH_CLAUDE_CLIENT_ID=xxx
OAUTH_CLAUDE_CLIENT_SECRET=xxx
OAUTH_GEMINI_CLIENT_ID=xxx
OAUTH_GEMINI_CLIENT_SECRET=xxx
OAUTH_QWEN_CLIENT_ID=xxx
OAUTH_QWEN_CLIENT_SECRET=xxx
```

### 8.6 Runner 侧透明

Runner 不感知 OAuth。Server 在收到用户消息时：

```
authType='api_key' → 解密 config.key → 注入 AgentRequest.apiKey
authType='oauth'   → OAuthTokenManager.getToken() → 注入 AgentRequest.apiKey
```

Runner 收到的都是一个可用的 token，直接传给 LLMProvider。

---

## 九、模块结构总览

### 9.1 agent-runtime 重构后

```
packages/agent-runtime/src/
├── index.ts                    # Runner 入口（保持）
├── agent.ts                    # Agent Loop（重构：去 SDK、接 LLMProvider）
├── intent.ts                   # Intent 快速分类（新增）
├── protocol.ts                 # 流式事件 12 种类型（扩充）
│
├── llm/                        # LLM Provider 抽象层（新增目录）
│   ├── types.ts                # LLMProvider 接口 + ChatParams + ProviderCapabilities
│   ├── factory.ts              # LLMProviderFactory.create(config)
│   ├── base.ts                 # BaseLLMProvider（重试、消毒、降级）
│   ├── anthropic.ts            # Claude adapter（fetch → Messages API）
│   ├── openai.ts               # OpenAI adapter（fetch → Chat Completions API）
│   ├── gemini.ts               # Gemini adapter（fetch → Gemini API）
│   └── compat.ts               # OpenAI 兼容协议兜底
│
├── context-assembler.ts        # 7 步上下文组装（改动：capabilities 感知）
├── consolidator.ts             # 滑动窗口压缩 + 80% 硬截断（重构）
│
├── tool-registry.ts            # 工具注册表（改动：受限模式 + CLI 降级）
├── tool-format.ts              # 工具格式转换（新增：Function Call / CLI 双模式）
├── skill-loader.ts             # Skill 加载（改动：版本管理 + 市场源）
├── mcp-manager.ts              # MCP 客户端（补齐：JSON-RPC 实现）
├── mcp-transport.ts            # MCP 传输层（新增：stdio / sse / streamable-http）
│
├── workspace-db.ts             # SQLite（保持）
├── subagent-manager.ts         # 子 Agent（保持）
│
├── tools/                      # 内置工具（保持 10 个）
│   ├── bash.ts / file.ts / git.ts / glob.ts / grep.ts / web-fetch.ts
│   ├── memory.ts / todo.ts / spawn.ts
│   └── index.ts
│
└── utils/
    ├── token-estimator.ts      # Token 估算（保持）
    └── path-guard.ts           # 路径校验（保持）
```

### 9.2 Server 侧新增

```
packages/server/src/
├── api/
│   ├── oauth.ts                # OAuth 路由（新增）
│   └── providers.ts            # Provider 管理（改动）
├── core/
│   └── oauth-token-manager.ts  # Token 刷新管理（新增）
└── db/
    └── schema.*.ts             # providers 扩展 + oauth_states 表（改动）
```

### 9.3 删除的文件

```
- packages/agent-runtime/src/llm-client.ts  # 替换为 llm/ 目录
```

**迁移说明**：`llm-client.ts` 中的重试逻辑（`callWithRetry`、`isTransientError`）、消毒逻辑（`sanitizeContent`）和类型定义（`LLMResponse`）迁移到 `llm/base.ts`。现有的 `llm-client.test.ts` 测试迁移到 `llm/base.test.ts`。`consolidator.ts` 中对 `LLMResponse` 的导入改为从 `llm/types.ts` 导入。

### 9.4 依赖变化

```diff
- @anthropic-ai/claude-code     # 删除 Agent SDK
- @anthropic-ai/sdk             # 删除 Anthropic SDK
- openai                        # 不需要

+ 零新增外部 LLM 依赖（全部用 Node.js 原生 fetch）
```

---

## 十、数据流全景

```
用户消息 → Server
  ↓
Provider 解析（API Key 解密 / OAuth token 刷新）
  ↓
AgentRequest { message, apiKey/token, context }
  ↓ WebSocket
Runner (agent-runtime)
  ↓
Intent 分类 → stop? correction? continue?
  ↓
ContextAssembler.assemble()
  → Bootstrap + 偏好 + 记忆(分级) + Skills + 工具(按 capabilities) + 历史
  ↓
Agent Loop
  → LLMProviderFactory.create(config) → 对应 Adapter
  → provider.stream(params) → 12 种流式事件 → 转发客户端
  → tool_use → ToolGuard → ToolRegistry.execute()
  → 循环直到 end_turn
  ↓
滑动压缩检查 → 未压缩 > 30%？压 1 个轮次组
  ↓
Log 记忆合并检查 → 超 10 条？LLM 合并
  ↓
done { tokens, sessionId }
```

---

## 十一、前端适配要点

本次重构以 agent-runtime 和 Server 为主，前端不做大改，但以下变更需要前端适配：

### 11.1 流式事件适配

前端 WebSocket 客户端需要处理新增的事件类型：

| 新事件 | 前端行为 |
|--------|---------|
| `tool_use_start` | 显示"正在调用工具: {name}"，展开工具调用卡片 |
| `tool_use_delta` | 实时显示工具参数输入（流式填充） |
| `tool_use_end` | 标记工具调用参数完成，等待 `tool_result` |
| `consolidation` | 显示"正在整合上下文..."状态提示 |
| `session_done` | 替代原 `done` 事件，更新 token 统计 |

现有的 `text_delta`、`thinking_delta`、`tool_result`、`confirm_request`、`error` 行为不变。

### 11.2 Provider 管理页面

`/settings/providers` 页面需要增加：

- **认证方式选择**：API Key / OAuth 登录（按 Provider 类型显示可用选项）
- **OAuth 授权按钮**：点击后弹出新窗口跳转到各家授权页，授权完成后自动关闭
- **OAuth 状态显示**：已授权 / token 过期 / 授权失败
- **Provider 能力标签**：显示该 Provider 支持的能力（vision、thinking 等）

### 11.3 工作区对话界面

- **工具调用展示增强**：利用 `tool_use_start/delta/end` 实现工具参数的流式展示（而非等 `tool_result` 后一次性显示）
- **Intent 反馈**：用户发送 `/stop` 或 `/retry` 后显示对应状态（"正在停止..."、"正在重试..."）

### 11.4 Skill 市场页面

`/settings/skills/marketplace` 新页面：

- 搜索框 + Skill 列表（名称、描述、作者、安装数）
- 安装按钮 + 安全扫描结果展示
- 已安装 Skill 的"可更新"标记 + 更新操作

> 前端详细设计不在本 spec 范围内，留后续前端 spec 处理。以上仅列出后端变更对前端的影响点。

---

## 十二、HappyClaw 借鉴改进点

基于对 HappyClaw 的分析，以下改进点已纳入本设计：

| # | 改进点 | 纳入位置 | 说明 |
|---|--------|---------|------|
| 1 | MCP 工具作为扩展点 | 第四章 §4.2 | MCP 工具注册到 ToolRegistry，走 Function Call / CLI 格式，不走 MCP 原始注入 |
| 2 | 流式事件扩充（分层 12 种） | 第二章 §2.3 | 分为 LLM 层 + Agent 层，新增 tool_use_start/delta/end、consolidation、session_done |
| 3 | 飞书流式卡片 | P6 渠道扩展时参考 | 本次不实现，留后续 |
| 4 | Intent 快速分类 | 第三章 §3.2 | stop/correction 精确匹配 + 完整语义定义 |
| 5 | PreCompact 权限收窄 | 第四章 §4.3 + 第五章 §5.3 | 整合用纯文本 LLM 调用 + ToolRegistry 受限模式防御性设计 |

**未采纳的 HappyClaw 特性**：
- 直接复用 Claude Code CLI 运行时 — CCCLaw 需支持多 Provider，必须自建工具层
- 文件 IPC — CCCLaw 是分布式架构（Server/Runner 分离），需要 WebSocket
- 预定义子 Agent（code-reviewer 等）— 不内置
