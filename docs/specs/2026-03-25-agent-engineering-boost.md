# 技术方案：Agent 工程层提升 — 用工程手段补偿弱模型，追平 CC+Sonnet 体验

## 1. 背景与动机

### 为什么要做

CCCLaw 的 Agent 框架工程能力约在 Claude Code 的 70-80%，但搭配 Qwen3-Coder 后综合体验只有 CC+Opus 的 30%。差距的本质在模型，但模型短期不可替换。需要通过工程手段补偿。

### 核心矛盾

弱模型的三个核心问题：
- **想不清楚**：3-5 步后推理跑偏，复杂任务无法独立完成
- **看不全面**：有效 context 利用率低，大文件容易丢细节
- **做不准确**：工具调用参数错误、代码一次写对概率低

### 目标

在不换模型的前提下，通过 11 项工程优化，把体验从 CC+Opus 的 30% 提升到 CC+Sonnet 的 80%（约 CC+Opus 的 55-60%）。

### 验收标准

- 评测基准建立，CC+Sonnet 基线数据可用
- 简单任务一次成功率 ≥ 85%（当前约 60%）
- 中等任务最终成功率（含重试）≥ 75%（当前约 40%）
- 复杂任务从"基本不可能"变为"有辅助可完成"
- 工具调用格式错误率降到 5% 以下（当前约 20%）

### 不做

- 不换模型（Qwen3-Coder 为基础）
- 不做 LSP 级别的完整语义分析（用正则轻量索引替代）
- 不做多模型并行投票（成本过高）
- 不重写 Agent 主循环架构（在现有架构上扩展）

### 约束

- 所有改动在 `packages/agent-runtime` 内完成，不影响 server 和 web 包的接口
- 保持对 Anthropic / OpenAI / Gemini 多 Provider 的兼容
- 新增模块必须有单元测试

---

## 2. 现状分析

### 2.1 Agent 主循环（`agent.ts`，355 行）

当前流程：Intent 分类 → 追加消息 → Consolidator 压缩 → ContextAssembler 组装 → LLM 迭代循环 → 工具执行。

**已有能力**：
- Plan 模式（`intent.ts`）：通过 `/plan` 指令进入，不给工具只输出计划，用户确认后执行
- 流式输出：支持 text_delta / thinking_delta / tool_use 全事件
- 连续工具失败检测：3 次连续错误自动终止
- 多模态内容注入：最后一条 user 消息可携带图片

**关键限制**：
- Plan 模式只是"不给工具"的简单实现（`agent.ts:140`），没有真正的 plan-then-execute 拆分——不会结构化输出计划、不会逐步执行、不会步骤间传递摘要
- 工具执行后无自动验证（`agent.ts:302`，直接 `toolRegistry.execute()` 返回结果）
- 模型固定（`agent.ts:181`），无按任务类型路由
- maxTokens 硬编码 8192（`agent.ts:184`），temperature 硬编码 0.1（`agent.ts:185`）

### 2.2 工具系统（`tool-registry.ts`，297 行）

**已有能力**：
- 三层工具：内置 + Skill + MCP，统一注册执行
- 安全层：BLOCKED_PATTERNS / CONFIRM_PATTERNS / 路径穿越检测
- Hook 系统（`hook-runner.ts`）：before/after 事件，从 `.ccclaw/hooks.json` 加载
- 参数自动转型：string → number/boolean/JSON

**关键限制**：
- Hook 只执行外部命令并记日志，**结果不回喂模型**（`hook-runner.ts` 只 log stdout/stderr）
- 无内置的 afterExec 验证机制——write/edit 工具写完就完，不检查语法/类型
- 工具结果截断上限 16K 字符（`MAX_TOOL_RESULT_CHARS`），无智能裁剪

### 2.3 Context 管理（`context-assembler.ts`，177 行 + `consolidator.ts`，390 行）

**已有能力**：
- 7 层分级组装：Bootstrap 文件 → 用户偏好 → 记忆（分级注入）→ Skills → 工具 schema → Session 历史
- 已支持 `.ccclaw/AGENTS.md` 读取（`BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md']`）
- 动态阈值压缩：根据窗口大小对数缩放（8K:70%/80% → 1M:85%/95%）
- 记忆压缩：decision+feedback 超 4K tokens 时 LLM 合并
- Log 记忆合并：>20 条或 >6K tokens 时合并为 1-2 条

**关键限制**：
- **按时间压缩，非按相关性**——旧但重要的 context 被先压缩
- 硬截断（`hardTruncate`）非常粗暴：直接 concatenate 到 log memory，不做摘要
- System prompt 是单体式的，所有阶段用同一个 prompt——对 Qwen 信息过载
- 无代码索引，不能按依赖关系智能筛选相关文件

### 2.4 LLM 集成（`llm/openai.ts` 等）

**已有能力**：
- 多 Provider 抽象：Anthropic / OpenAI / Gemini / Compat
- OpenAI 适配器完善：function calling、streaming、tool_calls 解析
- CLI 回退模式：无 function calling 能力时走文本解析（`tool-format.ts`）
- Provider capabilities 声明：streaming / toolUse / vision / contextWindow / promptCaching

**关键限制**：
- Provider 固定，无模型路由——不能按任务复杂度选模型
- 未使用 prompt caching（capabilities 有声明但未实际启用）
- 结构化输出模式未使用（Qwen 支持 JSON mode 但未启用）

### 2.5 子 Agent（`subagent-manager.ts`，159 行）

**已有能力**：
- 并发限制 3 / 迭代限制 15
- 子 Agent 不能递归 spawn
- 返回完整的 token 使用统计

**关键限制**：
- 无 Reviewer Agent 角色——子 Agent 只做"干活"，没有"审查"的角色区分
- 无 Specialist Agent 参数差异化——所有子 Agent 用相同 temperature/prompt

---

## 3. 方案设计

### 总体架构

```
用户消息
  │
  ├─ [新增] 任务复杂度评估 → 选择执行策略
  │     ├─ 简单 → 直接执行
  │     └─ 复杂 → Plan-then-Execute
  │
  ├─ [新增] 模型路由 → 按任务类型选模型
  │
  ├─ [增强] 分阶段 System Prompt → 减少 Qwen 信息过载
  │
  ├─ [增强] 智能 Context 裁剪 → 代码索引 + 分层注入
  │
  ├─ Agent 迭代循环
  │     ├─ LLM 生成
  │     ├─ 工具执行
  │     ├─ [新增] Write-Verify-Fix → 自动验证 + 重试
  │     └─ [新增] Reviewer Agent → 代码审查
  │
  └─ [新增] 评测基准 → 量化每次改进效果
```

### 3.1 Write-Verify-Fix 循环（P0）

> 模型写错了不可怕，可怕的是不知道错了。

**思路**：在 write/edit 工具执行后，自动运行语法/类型检查，失败则把错误喂回模型重试。

**改动点**：

**3.1.1 ToolRegistry 新增 `afterExec` 验证钩子**

在 `tool-registry.ts` 的 `execute()` 方法中，现有 hook 执行之后，增加内置验证逻辑：

```typescript
// tool-registry.ts execute() 末尾新增
interface VerifyResult {
  passed: boolean;
  errors: string[];
}

type AfterExecVerifier = (
  toolName: string,
  input: Record<string, unknown>,
  output: string,
) => Promise<VerifyResult>;

// 注册验证器
registerVerifier(toolNames: string[], verifier: AfterExecVerifier): void;
```

**关键**：验证器返回的 `errors` 会被**追加到工具结果中**，模型在下一轮看到错误后自行修复。不是在 ToolRegistry 内重试，而是让 Agent 循环自然处理——这样模型能看到完整上下文。

**3.1.2 新建 `verify/` 目录，实现各语言验证器**

```
packages/agent-runtime/src/verify/
├── index.ts          — 统一注册入口
├── typescript.ts     — tsc --noEmit（检查目标文件）
├── eslint.ts         — eslint --no-eslintrc --rule '...'（基础规则）
├── python.ts         — python -c "import ast; ast.parse(open('file').read())"
└── generic.ts        — 括号匹配、JSON 合法性等通用检查
```

每个验证器实现 `AfterExecVerifier` 接口。根据文件扩展名自动选择验证器。

**涉及文件**：
- `packages/agent-runtime/src/tool-registry.ts` — 新增 verifier 注册和执行逻辑（~40 行）
- `packages/agent-runtime/src/verify/` — 新建目录，4 个验证器文件（~200 行总计）
- `packages/agent-runtime/src/agent.ts` — 无需改动（验证结果通过工具结果自然流入 Agent 循环）

**3.1.3 变更影响检测（进阶）**

write/edit 执行后，检测该文件所在项目是否有 `tsconfig.json`，有则跑 `tsc --noEmit`。如果项目有测试配置，跑相关测试文件。

```typescript
// verify/typescript.ts
async function verifyTypeScript(filePath: string): Promise<VerifyResult> {
  const tsconfig = findTsConfig(filePath);
  if (!tsconfig) return { passed: true, errors: [] };

  const { stdout, stderr, exitCode } = await execCommand(
    `npx tsc --noEmit --pretty false -p ${tsconfig}`,
    { timeout: 15_000 }
  );

  if (exitCode === 0) return { passed: true, errors: [] };

  // 只返回与当前文件相关的错误（避免噪音）
  const relevantErrors = parseTypeScriptErrors(stderr)
    .filter(e => e.file === filePath);

  return { passed: relevantErrors.length === 0, errors: relevantErrors.map(e => e.message) };
}
```

**设计决策**：
- 验证超时 15 秒，超时视为通过（不因验证慢而阻塞）
- 只报与当前修改文件相关的错误（避免存量错误淹没增量问题）
- 验证失败不阻断，而是追加到工具结果让模型自行修复
- 重试上限由 Agent 循环的 `MAX_CONSECUTIVE_TOOL_ERRORS=3` 自然控制

---

### 3.2 自动 Plan 拆解（P0）

> Qwen 做不了 10 步的任务，但能做好 1-2 步的任务。

**思路**：收到复杂需求时，先用一轮 LLM 调用生成结构化计划，再逐步执行。

**改动点**：

**3.2.1 新建 `planner.ts` — 任务拆解引擎**

```typescript
// packages/agent-runtime/src/planner.ts

interface PlanStep {
  step: number;
  description: string;     // 一句话描述
  files: string[];          // 涉及文件
  action: 'create' | 'modify' | 'delete' | 'verify';
  detail: string;           // 具体做什么
  dependsOn?: number[];     // 依赖哪些步骤
}

interface Plan {
  summary: string;          // 方案概述
  steps: PlanStep[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

class Planner {
  /**
   * 判断是否需要 plan：
   * - 用户主动 /plan → 强制 plan
   * - 消息长度 > 200 字 + 包含文件/模块/功能等关键词 → 建议 plan
   * - 上下文中已有 plan → 继续执行
   */
  async shouldPlan(message: string, sessionId: string): Promise<boolean>;

  /**
   * 生成结构化计划。
   * 使用专门的 planning prompt（精简，只关注拆解），不带工具定义。
   * 输出 JSON 格式的 Plan 对象。
   */
  async generatePlan(message: string, context: AssembledContext): Promise<Plan>;

  /**
   * 逐步执行计划。
   * 每步构建精简 context（步骤描述 + 相关文件 + 前几步摘要），执行后验证。
   */
  async executeStep(plan: Plan, stepIndex: number, prevSummaries: string[]): Promise<StepResult>;
}
```

**3.2.2 与现有 Plan 模式的关系**

现有 `intent.ts` 的 Plan 模式保留，作为用户主动触发入口。新增的 Planner 在两个场景工作：

1. **用户 `/plan`**：走现有 intent 分类 → Planner.generatePlan() → 前端展示 → 用户确认 → Planner.executeStep() 逐步执行
2. **自动判断**：Agent 循环开始前，Planner.shouldPlan() 判断复杂度 → 复杂任务自动进入 plan-then-execute

**3.2.3 步骤间 Context 传递**

关键设计：每步完成后，只保留摘要传递给下一步，不带完整对话历史。

```typescript
interface StepResult {
  stepIndex: number;
  success: boolean;
  summary: string;       // "已在 src/auth.ts 添加 validateToken 函数"
  errors?: string[];     // 验证失败时的错误
}

// 步骤 N 的 context 构建
function buildStepContext(plan: Plan, stepIndex: number, prevResults: StepResult[]): string {
  return [
    `## 当前任务计划\n${plan.summary}`,
    `## 前序步骤完成情况\n${prevResults.map(r => `- 步骤 ${r.stepIndex}: ${r.summary}`).join('\n')}`,
    `## 当前步骤（${stepIndex}/${plan.steps.length}）\n${plan.steps[stepIndex].detail}`,
    `## 涉及文件\n${plan.steps[stepIndex].files.join('\n')}`,
  ].join('\n\n');
}
```

**涉及文件**：
- `packages/agent-runtime/src/planner.ts` — 新建（~250 行）
- `packages/agent-runtime/src/agent.ts` — 在迭代循环前集成 Planner 调用（~30 行改动）
- `packages/agent-runtime/src/prompts/planning.ts` — 新建，Plan 阶段专用 prompt（~50 行）

**设计决策**：
- Planning prompt 单独维护，不混入主 system prompt——Qwen 对短精准 prompt 表现更好
- 计划输出强制 JSON 格式（利用 Qwen 的 JSON mode），降低解析失败率
- 每步执行后用 Write-Verify-Fix（3.1）验证，失败只重试当前步骤
- 步骤间摘要由 Consolidator 生成，复用现有能力

---

### 3.3 智能 Context 裁剪（P1）

> 给模型精准的上下文，比给它大窗口更有效。

**3.3.1 代码索引（`code-index.ts`）**

启动时扫描项目，用正则提取轻量索引（不依赖 LSP/Tree-sitter，零外部依赖）：

```typescript
interface FileIndex {
  path: string;
  size: number;
  lastModified: number;
  exports: string[];        // export function/class/const/type 名称
  imports: ImportRef[];     // { from: string, names: string[] }
  type: 'ts' | 'js' | 'py' | 'json' | 'css' | 'other';
}

interface ImportRef {
  from: string;             // 模块路径
  names: string[];          // 导入的具体名称
}

class CodeIndex {
  private index: Map<string, FileIndex>;

  /** 扫描项目目录，建立索引。排除 node_modules/.git/dist */
  async build(rootDir: string): Promise<void>;

  /** 增量更新：文件变更后只重建该文件的索引 */
  async update(filePath: string): Promise<void>;

  /** 给定关键词，返回相关文件（按相关度排序） */
  search(keywords: string[]): FileIndex[];

  /** 给定文件，返回其直接依赖链 */
  getDependencies(filePath: string, depth?: number): FileIndex[];

  /** 生成项目结构摘要（用于 Level 0 Context） */
  getProjectSummary(): string;
}
```

正则提取策略：
- TypeScript/JavaScript：匹配 `export (function|class|const|type|interface|enum) (\w+)` 和 `import .* from ['"](.+)['"]`
- Python：匹配 `^(def|class) (\w+)` 和 `^(from .+ import|import .+)`
- 其他文件：只记录路径和大小

**3.3.2 分层 Context 策略**

改造 `context-assembler.ts`，引入 Context 分层：

```
Level 0 — 始终在场（~2K tokens）：
  system prompt 核心部分 + 项目结构摘要（由 CodeIndex.getProjectSummary() 生成）

Level 1 — 按需注入（~6K tokens）：
  当前编辑文件全文 + 直接依赖文件的签名（export 列表）
  由 CodeIndex.getDependencies() 提供

Level 2 — 工具获取：
  模型主动 grep/read 拿到的内容（现有行为，不变）

Level 3 — 可丢弃：
  历史对话、已完成的工具结果 → Consolidator 积极清理
```

**改造 ContextAssembler**：

```typescript
// context-assembler.ts 新增方法
class ContextAssembler {
  private codeIndex: CodeIndex | null;

  /** 基于当前任务描述，从索引中筛选相关文件的签名注入 context */
  private buildCodeContext(taskDescription: string): string {
    if (!this.codeIndex) return '';

    const keywords = extractKeywords(taskDescription);
    const relevantFiles = this.codeIndex.search(keywords).slice(0, 10);

    return relevantFiles.map(f =>
      `### ${f.path}\nExports: ${f.exports.join(', ')}`
    ).join('\n\n');
  }
}
```

**涉及文件**：
- `packages/agent-runtime/src/code-index.ts` — 新建（~300 行）
- `packages/agent-runtime/src/context-assembler.ts` — 增加 Level 0/1 注入逻辑（~50 行改动）
- `packages/agent-runtime/src/index.ts` — 启动时构建索引（~10 行）

**设计决策**：
- 纯正则提取，零外部依赖——Tree-sitter 准确但引入成本高，正则能覆盖 80% 场景
- 索引在内存中，不持久化——项目结构变化快，每次启动重建（中小项目 <1 秒）
- 文件变更时增量更新（通过 write/edit 工具的 afterExec 触发）
- 搜索结果最多 10 个文件，避免注入过多

---

### 3.4 Qwen Prompt 适配（P1）

> 一个 50K 的 system prompt 对 Qwen 来说信息过载。

**3.4.1 分阶段 System Prompt**

新建 `packages/agent-runtime/src/prompts/` 目录，按阶段维护不同 prompt：

```
prompts/
├── base.ts           — 公共部分（角色定义、安全规则，~1K）
├── planning.ts       — 规划阶段（如何拆解任务，~1K）
├── coding.ts         — 编码阶段（工具使用规范 + 编码约定，~2K）
├── reviewing.ts      — 审查阶段（代码审查标准，~1K）
└── index.ts          — 按阶段组装
```

**改造 ContextAssembler**：在 `assemble()` 中根据 `ModelProfile.promptStrategy.preferPhasedPrompt` 决定是否分阶段：

```typescript
type AgentPhase = 'planning' | 'coding' | 'reviewing';

// 根据阶段组装不同的 system prompt（仅当 Profile 声明 preferPhasedPrompt=true 时生效）
function getPhasePrompt(phase: AgentPhase): string {
  return [
    prompts.base,
    prompts[phase],
  ].join('\n\n');
}
```

**3.4.2 工具描述 Few-shot 注入**

在关键工具的 `description` 中嵌入正确/错误示例：

```typescript
// tools/edit.ts description 增强
const EDIT_DESCRIPTION = `替换文件中的文本片段。

正确示例：
  old_string: 'function login(user: string) {'
  new_string: 'function login(user: string, password: string) {'

错误示例（不要这样做）：
  old_string: 'function login'  ← 太短，可能匹配多处
  old_string: 整个文件内容    ← 太长，用 write 工具替代`;
```

**3.4.3 模型专属工具约束**

不再硬编码"Qwen 专项约束"，而是由 `ModelProfile.promptStrategy.toolCallConstraints` 提供。ContextAssembler 自动注入到 system prompt 尾部。不同模型有不同的约束（或没有约束）：

- **Qwen 系列**：每次只调一个工具、必须用绝对路径、edit 必须精确复制 old_string...
- **Claude 系列**：无额外约束（Profile 中 `toolCallConstraints` 为空）
- **新模型**：在 Profile 中按需配置

**涉及文件**：
- `packages/agent-runtime/src/prompts/` — 新建目录（~4 个文件，共 ~200 行）
- `packages/agent-runtime/src/context-assembler.ts` — 按 Profile 切换 prompt 策略（~30 行改动）
- `packages/agent-runtime/src/tools/edit.ts` / `write.ts` / `bash.ts` — description 增强，few-shot 示例按 `needsToolExamples` 条件注入（每个 ~20 行）

---

### 3.5 模型适配层 — ModelProfile 抽象（P1）

> 核心设计目标：**每个模型一份 Profile，新模型上线只需加一个 Profile 文件，零改动核心代码。**

#### 问题

当前 capabilities 是 **Provider 级别**硬编码（`openai.ts:192` 返回固定值），model/maxTokens/temperature 在 `agent.ts:181-185` 硬编码。但现实是：

- 同一个 OpenAI Provider 下，qwen-max 和 qwen-turbo 的能力完全不同
- 同一个模型的不同版本（qwen3-coder vs qwen3-coder-plus）参数也不同
- Claude / GPT / Gemini / Qwen 各有独特的 API 特性（thinking、caching、JSON mode）
- 模型迭代快，每隔几周就有新版本，不能每次都改核心代码

**需要一个模型粒度的适配层**，把"了解模型"这件事从 Provider 和 Agent 中抽出来。

#### 3.5.1 ModelProfile 接口设计

```typescript
// packages/agent-runtime/src/llm/model-profile.ts（新建）

/**
 * ModelProfile — 描述一个具体模型的能力和最优参数。
 *
 * 设计原则：
 * - Profile 是纯数据（声明式），不包含逻辑
 * - 一个模型一份 Profile，新模型只需新增文件
 * - Agent/Provider 读取 Profile 来适配行为，而非硬编码
 */
interface ModelProfile {
  /** 模型 ID，用于匹配。支持精确匹配和前缀匹配 */
  id: string;

  /** 人类可读名称 */
  displayName: string;

  /** 模型厂商，用于分组和 Provider 路由 */
  vendor: 'anthropic' | 'openai' | 'google' | 'alibaba' | 'deepseek' | string;

  // ====== 能力声明 ======
  capabilities: {
    contextWindow: number;         // token 上限
    maxOutputTokens: number;       // 单次输出上限
    toolUse: boolean;              // 是否支持原生 function calling
    extendedThinking: boolean;     // 是否支持 thinking/reasoning 输出
    vision: boolean;               // 是否支持图片输入
    promptCaching: boolean;        // 是否支持 prefix caching
    jsonMode: boolean;             // 是否支持 response_format: json_object
    parallelToolCalls: boolean;    // 是否能可靠地并行调用多个工具
  };

  // ====== 推荐参数（按场景） ======
  defaults: {
    temperature: number;           // 默认 temperature
    maxTokens: number;             // 默认 maxTokens
  };
  overrides?: {
    planning?: { temperature?: number; maxTokens?: number };
    coding?: { temperature?: number; maxTokens?: number };
    reviewing?: { temperature?: number; maxTokens?: number };
  };

  // ====== Prompt 适配 ======
  promptStrategy: {
    /**
     * system prompt 最大建议长度（token）。
     * 超过此长度的 prompt 对该模型效果显著下降。
     * ContextAssembler 据此裁剪 prompt。
     */
    maxSystemPromptTokens: number;

    /**
     * 工具调用约束——注入到 system prompt 末尾的模型专属规则。
     * 例如 Qwen 需要"每次只调一个工具"，Claude 不需要。
     */
    toolCallConstraints?: string;

    /**
     * 工具描述是否需要 few-shot 示例。
     * 强模型（Claude/GPT-4）不需要，弱模型需要。
     */
    needsToolExamples: boolean;

    /**
     * 是否倾向于分阶段 prompt（planning/coding/reviewing 各用不同 prompt）。
     * 弱模型受益明显，强模型无所谓。
     */
    preferPhasedPrompt: boolean;

    /**
     * 自定义 prompt 片段——模型特有的提示词。
     * 会被 ContextAssembler 插入到 system prompt 的指定位置。
     */
    customPromptSuffix?: string;
  };

  // ====== 执行策略 ======
  executionStrategy: {
    /**
     * 建议的单次工具调用数。
     * 1 = 串行（弱模型更安全），>1 = 允许并行（强模型效率高）。
     */
    maxConcurrentToolCalls: number;

    /**
     * Write-Verify-Fix 是否对该模型有价值。
     * 一次写对概率高的模型（Claude Opus）收益小，弱模型收益大。
     */
    benefitsFromVerifyFix: boolean;

    /**
     * 是否建议对复杂任务自动 Plan 拆解。
     * 多步推理强的模型不需要，弱模型强烈需要。
     */
    benefitsFromAutoPlan: boolean;

    /**
     * 是否建议启用 Reviewer Agent 双重检查。
     */
    benefitsFromReview: boolean;
  };

  // ====== 模型路由 ======
  routing?: {
    /**
     * 该模型适合的任务角色。
     * 用于 ModelRouter 按任务类型选模型。
     */
    roles: Array<'primary' | 'planning' | 'coding' | 'review' | 'subagent'>;

    /**
     * 性价比评级（1-5）。
     * ModelRouter 在同角色多模型中按此优先选择。
     * 5=最具性价比，1=最贵但最强。
     */
    costEfficiency: number;

    /**
     * 能力评级（1-5）。
     * 5=顶级（Opus），3=中等（Sonnet），1=基础。
     */
    capabilityTier: number;
  };
}
```

#### 3.5.2 内置 Profile 注册

```
packages/agent-runtime/src/llm/profiles/
├── index.ts              — ProfileRegistry（注册/查询/匹配）
├── anthropic.ts          — Claude 系列 Profile
├── openai.ts             — GPT 系列 Profile
├── alibaba.ts            — Qwen 系列 Profile
├── google.ts             — Gemini 系列 Profile
├── deepseek.ts           — DeepSeek 系列 Profile
└── _default.ts           — 兜底 Profile（未知模型的保守配置）
```

**每个文件导出该厂商下所有模型的 Profile 数组**：

```typescript
// profiles/alibaba.ts
export const alibabaProfiles: ModelProfile[] = [
  {
    id: 'qwen-max',
    displayName: 'Qwen Max',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,   // Qwen 并行调用不稳定
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    overrides: {
      planning: { temperature: 0.2, maxTokens: 4096 },
      reviewing: { temperature: 0.15, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 6000,
      toolCallConstraints: [
        '每次只调用一个工具（不要并行，容易出错）',
        '调用前先用一句话说明你要做什么',
        '文件路径必须是绝对路径',
        'edit 工具的 old_string 必须从文件中精确复制，不能凭记忆写',
        '如果不确定文件内容，先用 read 工具查看',
      ].join('\n'),
      needsToolExamples: true,
      preferPhasedPrompt: true,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: true,
      benefitsFromReview: true,
    },
    routing: {
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 4,
      capabilityTier: 3,
    },
  },
  {
    id: 'qwen-turbo',
    displayName: 'Qwen Turbo',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131072,
      maxOutputTokens: 4096,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: 4000,
      toolCallConstraints: '同 qwen-max',
      needsToolExamples: true,
      preferPhasedPrompt: true,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: true,
      benefitsFromReview: false,    // turbo 做 review 质量不够
    },
    routing: {
      roles: ['subagent'],          // 只用于子任务
      costEfficiency: 5,
      capabilityTier: 2,
    },
  },
  // qwen3-coder, qwen3-coder-plus 等后续按需添加...
];
```

```typescript
// profiles/anthropic.ts（对比参考：强模型的 Profile 完全不同）
export const anthropicProfiles: ModelProfile[] = [
  {
    id: 'claude-opus-4',           // 前缀匹配 claude-opus-4-*
    displayName: 'Claude Opus 4',
    vendor: 'anthropic',
    capabilities: {
      contextWindow: 1048576,
      maxOutputTokens: 32768,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: false,             // Anthropic 不走 response_format
      parallelToolCalls: true,     // Opus 并行调用非常可靠
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    promptStrategy: {
      maxSystemPromptTokens: 50000,  // 大窗口不怕长 prompt
      needsToolExamples: false,      // 不需要 few-shot
      preferPhasedPrompt: false,     // 单体 prompt 就够了
    },
    executionStrategy: {
      maxConcurrentToolCalls: 5,     // 可以大胆并行
      benefitsFromVerifyFix: false,  // 一次写对概率高，收益小
      benefitsFromAutoPlan: false,   // 自己能做 10+ 步推理
      benefitsFromReview: false,     // 自己就能做好 review
    },
    routing: {
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 1,
      capabilityTier: 5,
    },
  },
  // claude-sonnet-4, claude-haiku-4 等...
];
```

#### 3.5.3 ProfileRegistry — 查询与匹配

```typescript
// profiles/index.ts

class ProfileRegistry {
  private profiles: ModelProfile[] = [];

  /** 注册一组 Profile（启动时调用） */
  registerAll(profiles: ModelProfile[]): void;

  /**
   * 根据模型 ID 查找 Profile。
   * 匹配规则：
   * 1. 精确匹配（id === modelId）
   * 2. 前缀匹配（modelId.startsWith(profile.id)），用于版本号变体
   * 3. 无匹配 → 返回 _default Profile
   */
  resolve(modelId: string): ModelProfile;

  /**
   * 根据角色和约束条件选模型。
   * 用于 ModelRouter：给定角色（planning/subagent/...），
   * 返回该 vendor 下最适合的模型。
   */
  selectForRole(
    role: string,
    vendor?: string,
    preference?: 'capability' | 'cost',
  ): ModelProfile;
}
```

**前缀匹配的意义**：模型 ID 经常带日期后缀（`claude-opus-4-20250514`、`qwen-max-2025-03`），Profile 只需注册基础 ID，自动匹配所有版本。新版本如果有 breaking change，再注册一个精确 ID 的 Profile 覆盖。

#### 3.5.4 与现有架构的集成

**改造 Provider — capabilities 委托给 Profile**：

```typescript
// openai.ts 改造
export class OpenAIAdapter implements LLMProvider {
  private profileRegistry: ProfileRegistry;

  capabilities(): ProviderCapabilities {
    // 不再硬编码，委托给当前模型的 Profile
    const profile = this.profileRegistry.resolve(this.defaultModel ?? '');
    return {
      streaming: true,
      toolUse: profile.capabilities.toolUse,
      extendedThinking: profile.capabilities.extendedThinking,
      promptCaching: profile.capabilities.promptCaching,
      vision: profile.capabilities.vision,
      contextWindow: profile.capabilities.contextWindow,
      maxOutputTokens: profile.capabilities.maxOutputTokens,
    };
  }
}
```

**改造 Agent — 读取 Profile 驱动行为**：

```typescript
// agent.ts 改造（概念示意）
const profile = profileRegistry.resolve(currentModel);

// 1. ChatParams 参数不再硬编码
const chatParams: ChatParams = {
  model: currentModel,
  maxTokens: profile.overrides?.[phase]?.maxTokens ?? profile.defaults.maxTokens,
  temperature: profile.overrides?.[phase]?.temperature ?? profile.defaults.temperature,
  ...
};

// 2. 是否启用 JSON mode
if (profile.capabilities.jsonMode && needsStructuredOutput) {
  chatParams.responseFormat = { type: 'json_object' };
}

// 3. 是否自动 Plan
if (profile.executionStrategy.benefitsFromAutoPlan && isComplexTask) {
  await planner.generatePlan(...);
}

// 4. 工具调用并发度
const maxParallel = profile.executionStrategy.maxConcurrentToolCalls;
```

**改造 ContextAssembler — 按 Profile 裁剪 prompt**：

```typescript
// context-assembler.ts 改造
assemble({ sessionId, serverContext, modelProfile }): AssembledContext {
  // 1. 按模型能力选择 prompt 策略
  if (modelProfile.promptStrategy.preferPhasedPrompt) {
    systemPrompt = getPhasePrompt(currentPhase);    // 分阶段精简 prompt
  } else {
    systemPrompt = getFullPrompt();                  // 单体完整 prompt
  }

  // 2. 注入模型专属工具约束
  if (modelProfile.promptStrategy.toolCallConstraints) {
    systemPrompt += `\n\n## 工具调用规则\n${modelProfile.promptStrategy.toolCallConstraints}`;
  }

  // 3. 按 maxSystemPromptTokens 裁剪
  systemPrompt = truncateToTokenLimit(systemPrompt, modelProfile.promptStrategy.maxSystemPromptTokens);

  // 4. 工具描述是否加 few-shot
  if (modelProfile.promptStrategy.needsToolExamples) {
    tools = injectToolExamples(tools);
  }
}
```

**改造 ModelRouter — 基于 Profile 路由**：

```typescript
// packages/agent-runtime/src/model-router.ts（新建）

class ModelRouter {
  constructor(private registry: ProfileRegistry, private vendor: string) {}

  /**
   * 根据任务阶段选模型。
   * 规划阶段 → capabilityTier 最高的
   * 子任务 → costEfficiency 最高的
   * 其他 → primary 角色的默认模型
   */
  selectModel(phase: AgentPhase): { model: string; profile: ModelProfile } {
    switch (phase) {
      case 'planning':
        return this.registry.selectForRole('planning', this.vendor, 'capability');
      case 'subagent':
        return this.registry.selectForRole('subagent', this.vendor, 'cost');
      default:
        return this.registry.selectForRole('primary', this.vendor, 'capability');
    }
  }
}
```

#### 3.5.5 Prompt Caching 适配

不同模型的 caching 机制不同，在 Profile 中声明 `promptCaching: true` 后：

- **Qwen（OpenAI 兼容）**：API 自动做 prefix caching，无需特殊标记。ContextAssembler 确保 system prompt 前缀稳定（base prompt + 项目配置不变，易变内容放末尾）即可生效。
- **Anthropic**：需要 `cache_control: { type: 'ephemeral' }` 标记。已有 `CacheHint` 类型支持。
- **其他**：Profile 中 `promptCaching: false`，不做任何处理。

实现方式：在 ContextAssembler 中，输出 system prompt 时按"稳定部分在前、易变部分在后"的顺序组装。不需要改 Provider 代码。

#### 3.5.6 结构化输出模式

Profile 中 `jsonMode: true` 的模型，在以下场景自动启用 `response_format: { type: "json_object" }`：

- Planner 生成计划时（输出 Plan JSON）
- Intent 分类时（如果用独立 LLM 调用做分类）

Provider 层改动：OpenAI adapter 在构建请求体时，检查 `chatParams.responseFormat` 并传递给 API。

```typescript
// openai.ts chat() / stream() 中
if (params.responseFormat) {
  body.response_format = params.responseFormat;
}
```

ChatParams 新增可选字段：

```typescript
// types.ts
interface ChatParams {
  // ... 现有字段
  responseFormat?: { type: 'json_object' | 'text' };
}
```

#### 3.5.7 新模型适配流程

**添加一个新模型只需 3 步**：

```
1. 在 profiles/<vendor>.ts 中新增一个 ModelProfile 对象
2. 运行评测基准验证效果
3. 根据评测结果微调 Profile 参数（temperature / maxSystemPromptTokens / toolCallConstraints）
```

**不需要**：改 Provider 代码、改 Agent 代码、改 ContextAssembler 代码。

**示例：适配 DeepSeek-V3**

```typescript
// profiles/deepseek.ts 新增
{
  id: 'deepseek-chat',
  displayName: 'DeepSeek V3',
  vendor: 'deepseek',
  capabilities: {
    contextWindow: 65536,
    maxOutputTokens: 8192,
    toolUse: true,
    extendedThinking: true,      // DeepSeek 支持 reasoning_content
    vision: false,
    promptCaching: true,
    jsonMode: true,
    parallelToolCalls: false,
  },
  defaults: { temperature: 0.1, maxTokens: 8192 },
  promptStrategy: {
    maxSystemPromptTokens: 8000,
    toolCallConstraints: '每次只调用一个工具\n文件路径必须是绝对路径',
    needsToolExamples: true,
    preferPhasedPrompt: true,
  },
  executionStrategy: {
    maxConcurrentToolCalls: 1,
    benefitsFromVerifyFix: true,
    benefitsFromAutoPlan: true,
    benefitsFromReview: true,
  },
  routing: {
    roles: ['primary', 'planning', 'coding'],
    costEfficiency: 5,
    capabilityTier: 3,
  },
}
```

完成。新模型立即可用，所有工程优化（Verify-Fix / Auto-Plan / Phased Prompt）自动按 Profile 声明启用。

#### 涉及文件

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `packages/agent-runtime/src/llm/model-profile.ts` | 新建 | ~120 行（接口定义） |
| `packages/agent-runtime/src/llm/profiles/index.ts` | 新建 | ~80 行（ProfileRegistry） |
| `packages/agent-runtime/src/llm/profiles/alibaba.ts` | 新建 | ~100 行（Qwen 系列） |
| `packages/agent-runtime/src/llm/profiles/anthropic.ts` | 新建 | ~80 行（Claude 系列） |
| `packages/agent-runtime/src/llm/profiles/openai.ts` | 新建 | ~80 行（GPT 系列） |
| `packages/agent-runtime/src/llm/profiles/google.ts` | 新建 | ~60 行（Gemini 系列） |
| `packages/agent-runtime/src/llm/profiles/deepseek.ts` | 新建 | ~60 行（DeepSeek 系列） |
| `packages/agent-runtime/src/llm/profiles/_default.ts` | 新建 | ~40 行（兜底配置） |
| `packages/agent-runtime/src/model-router.ts` | 新建 | ~60 行（基于 Profile 路由） |
| `packages/agent-runtime/src/llm/types.ts` | 改动 | ~5 行（ChatParams 加 responseFormat） |
| `packages/agent-runtime/src/llm/openai.ts` | 改动 | ~20 行（capabilities 委托 + responseFormat 透传） |
| `packages/agent-runtime/src/llm/anthropic.ts` | 改动 | ~10 行（capabilities 委托） |
| `packages/agent-runtime/src/llm/factory.ts` | 改动 | ~10 行（注入 ProfileRegistry） |
| `packages/agent-runtime/src/agent.ts` | 改动 | ~30 行（读取 Profile 驱动行为） |
| `packages/agent-runtime/src/context-assembler.ts` | 改动 | ~30 行（按 Profile 裁剪 prompt） |

**总计**：~780 行新增 + ~105 行改动

#### 设计决策

| 决策 | 理由 |
|------|------|
| Profile 是纯数据，不包含逻辑 | 让 Profile 文件简单可审查，逻辑在消费方（Agent/Assembler/Router） |
| 前缀匹配模型 ID | 模型版本号频繁变化（`-20250514`），避免每个版本都建 Profile |
| 兜底 _default Profile | 未注册的模型也能运行，用保守参数 |
| 按 vendor 分文件 | 同厂商模型共性多，放一起便于维护和对比 |
| routing 字段可选 | 单模型场景不需要路由，Profile 也能用（只用 capabilities + promptStrategy） |
| capabilityTier / costEfficiency 用 1-5 评级 | 比 float 直觉，且跨厂商可对比 |
| 工具约束放在 Profile 而非 Prompt 文件中 | 同一模型无论什么阶段都需要这些约束，跟模型绑定比跟阶段绑定更准确 |

---

### 3.6 UX 体验补齐（P1）

**3.6.1 Diff 预览**

write/edit 工具执行前，生成 unified diff 发送给前端展示，用户 approve 后才写入：

```typescript
// agent.ts — 工具执行前
if ((tc.name === 'write' || tc.name === 'edit') && confirmMode !== 'never') {
  const diff = generateDiff(tc.input);
  onStream({ type: 'diff_preview', toolCallId: tc.id, diff, filePath: tc.input.file_path });
  // 等待前端确认（通过 confirmCallback）
}
```

**前端改动**（`packages/web`）：
- 新增 DiffPreview 组件，使用 `diff` 库生成 unified diff，语法高亮展示
- 绿色加行 / 红色删行，支持 Approve / Reject 操作

**3.6.2 Bash Streaming Output**

当前 bash 工具等执行完才返回全部输出。改为流式：

```typescript
// tools/bash.ts — 使用 spawn 替代 exec，逐行输出
const proc = spawn('bash', ['-c', command]);
proc.stdout.on('data', chunk => {
  onStream({ type: 'tool_output_delta', toolCallId, delta: chunk.toString() });
});
```

需要 `Tool.execute()` 接口支持 stream callback，或改为 AsyncGenerator。

**3.6.3 错误恢复 UX**

工具执行失败后，前端展示可选操作：

```typescript
onStream({
  type: 'tool_error_options',
  toolCallId: tc.id,
  error: result,
  options: ['retry_fix', 'change_approach', 'manual'],
});
```

**3.6.4 Thinking 展示优化**

前端 thinking_delta 渲染：折叠/展开、渐进式渲染、视觉区分（灰色斜体 vs 正常输出）。

**涉及文件**：
- `packages/agent-runtime/src/tools/bash.ts` — streaming 改造（~40 行）
- `packages/agent-runtime/src/agent.ts` — diff preview 集成（~20 行）
- `packages/web/src/pages/chat/` — DiffPreview 组件、错误恢复 UI（~200 行新增）
- `packages/web/src/components/` — thinking 展示优化（~50 行改动）

---

### 3.7 项目级配置（P1）

> 项目级 few-shot 示例对弱模型尤其重要。

**现状**：ContextAssembler 已读取 `.ccclaw/AGENTS.md`，但只是简单拼接到 system prompt。

**增强**：
- 支持 `.ccclaw/AGENTS.md` 中的结构化指令（编码规范、技术栈偏好、禁止操作、few-shot 示例）
- 支持项目根目录的 `AGENTS.md`（无 `.ccclaw` 目录时的回退）
- 配置可覆盖 system prompt 行为（优先级：项目配置 > 全局配置 > 默认）

```markdown
# 项目配置文件 .ccclaw/AGENTS.md 示例

## 编码规范
- 使用 ESM import，不要 require
- 组件使用 function component + hooks

## 技术栈
- React 18 + TypeScript 5 + Vite
- 状态管理：zustand
- 样式：tailwind CSS

## 禁止操作
- 不要修改 package.json 的 dependencies
- 不要删除 test 文件

## Few-shot 示例
修改 API 时，必须同步更新 `docs/api.md` 中的对应接口文档。
```

**涉及文件**：
- `packages/agent-runtime/src/context-assembler.ts` — 增强 AGENTS.md 解析，结构化注入（~40 行改动）

---

### 3.8 Reviewer Agent（P2）

> 两个弱模型互相检查 > 一个弱模型自己检查。

**3.8.1 执行者 + 审查者模式**

改造 `subagent-manager.ts`，新增 `review` 角色：

```typescript
// subagent-manager.ts 新增
async review(sessionId: string, diff: string): Promise<ReviewResult> {
  const reviewPrompt = `你是代码审查者。请审查以下代码改动，检查：
1. 逻辑正确性
2. 边界情况处理
3. 安全问题
4. 代码风格

只报告问题，不要报告没问题的地方。如果没有问题，回复"LGTM"。

改动内容：
${diff}`;

  const result = await this.spawn(sessionId, reviewPrompt, 'reviewer');
  return parseReviewResult(result.content);
}
```

**触发时机**：每次完成一个 Plan 步骤后，或用户手动请求 review。不是每次 write/edit 都触发（太频繁）。

**3.8.2 Specialist Agent 参数差异化**

```typescript
// 不同角色的 Agent 用不同参数
const AGENT_PROFILES = {
  coder:    { temperature: 0.1, maxTokens: 8192 },  // 严格，长输出
  reviewer: { temperature: 0.2, maxTokens: 4096 },  // 略宽松，短输出
  explorer: { temperature: 0.3, maxTokens: 4096 },  // 鼓励发散
};
```

**涉及文件**：
- `packages/agent-runtime/src/subagent-manager.ts` — 新增 review 方法 + 角色参数（~60 行）
- `packages/agent-runtime/src/agent.ts` — 步骤完成后触发 review（~15 行）

---

### 3.9 分层 Context 管理（P2）

> 旧但重要的对话不应该被先压缩。

改造 `consolidator.ts`，在压缩时考虑相关性：

```typescript
// consolidator.ts 新增
function scoreRelevance(message: Message, currentTask: string): number {
  // 1. 关键词匹配：消息内容与当前任务的关键词重叠度
  const keywordScore = computeKeywordOverlap(message.content, currentTask);

  // 2. 工具结果权重：包含文件路径/代码的消息权重更高
  const toolScore = message.role === 'tool' ? 0.2 : 0;

  // 3. 时间衰减：越新的消息基础分越高
  const recencyScore = computeRecencyScore(message.created_at);

  return keywordScore * 0.5 + toolScore + recencyScore * 0.3;
}
```

压缩策略改为：先压缩低相关性的消息，高相关性的保留原文。

**涉及文件**：
- `packages/agent-runtime/src/consolidator.ts` — 新增相关性评分 + 分级压缩（~80 行改动）

---

### 3.10 代码索引（P3）

已在 3.3.1 中作为 Context 裁剪的基础设施描述。P3 阶段扩展为完整的依赖图：

- 符号 → 定义位置 + 引用位置
- 跨文件的调用链追踪
- 自动推断"改了 A 文件可能影响 B、C 文件"

P3 依赖 3.3 的基础 CodeIndex，在其上增加反向引用和影响分析。

---

### 3.11 评测基准（P0）

> 没有度量就没有优化。

**3.11.1 测试集设计**

```
tests/eval/
├── cases/
│   ├── simple/           — 简单任务（10 题）
│   │   ├── 01-fix-typo.json
│   │   ├── 02-add-field.json
│   │   └── ...
│   ├── medium/           — 中等任务（10 题）
│   │   ├── 01-cross-file-feature.json
│   │   └── ...
│   └── complex/          — 复杂任务（5-10 题）
│       ├── 01-new-module.json
│       └── ...
├── fixtures/             — 测试用的初始代码库
├── runner.ts             — 自动化评测脚本
├── judge.ts              — 验收判断（AST diff / test pass / 编译通过）
└── report.ts             — 对比报告生成
```

**用例格式**：

```json
{
  "id": "simple-01",
  "name": "修复函数名 typo",
  "difficulty": "simple",
  "description": "文件 src/utils.ts 中 caclulate 应改为 calculate，同时更新所有引用",
  "fixture": "fixtures/typo-project/",
  "acceptance": [
    { "type": "file_contains", "file": "src/utils.ts", "pattern": "function calculate" },
    { "type": "file_not_contains", "file": "src/utils.ts", "pattern": "caclulate" },
    { "type": "compile_pass", "command": "npx tsc --noEmit" }
  ]
}
```

**3.11.2 评测维度**

| 维度 | 计算方式 | 用途 |
|------|---------|------|
| 一次成功率 | 首次输出直接通过验收 / 总题数 | 衡量模型 + 框架的直接能力 |
| 最终成功率 | 允许 3 次重试后通过 / 总题数 | 衡量 Write-Verify-Fix 的效果 |
| 平均轮次 | 完成任务的平均对话轮次 | 衡量效率 |
| 编译通过率 | 生成代码能通过 tsc/lint / 总次数 | 衡量代码质量 |
| 工具调用准确率 | 格式正确的工具调用 / 总调用次数 | 衡量 Prompt 适配效果 |

**3.11.3 自动化跑分流程**

```
1. 选择 Provider（CC+Sonnet / CCCLaw+Qwen / ...）
2. 对每个用例：
   a. 初始化 fixture 到临时目录
   b. 发送需求描述给 Agent
   c. Agent 自主执行（最多 3 轮重试）
   d. 运行 acceptance 检查
   e. 记录：成功/失败、轮次数、token 消耗、耗时
3. 生成对比报告（Markdown 表格）
```

**3.11.4 评测素材来源**

从零准备，素材来源：
- **简单题**：从 CCCLaw 自身代码中提取真实改动（git log 回溯）
- **中等题**：模拟跨文件功能（如"给用户列表加导出按钮"）
- **复杂题**：模拟新模块设计（如"新增 WebSocket 通知模块"）
- 每题包含初始代码 fixture + 自动化验收条件

**涉及文件**：
- `tests/eval/` — 新建目录，全部新文件（~500 行代码 + 20-30 个用例 JSON）

---

## 4. 实施计划

> 详细的 plan 在 spec 确认后单独出 `docs/plans/2026-03-25-agent-engineering-boost-plan.md`。

### 阶段总览

```
第 0 周（前置）：评测基准
  └─ 3.11 评测基准搭建 → 3-5 天
  产出：测试集 + 跑分脚本 + CC+Sonnet 基线

第 1 周（P0 核心）：
  ├─ 3.1 Write-Verify-Fix → 2-3 天
  └─ 3.2 自动 Plan 拆解 → 3-5 天
  里程碑：成功率 60% → 85%，复杂任务可行性质变

第 2 周（P1 模型适配）：
  ├─ 3.4 Qwen Prompt 适配 → 1-2 天
  ├─ 3.5 ModelProfile 抽象层 + 各模型 Profile → 4-6 天
  └─ 3.3 智能 Context 裁剪 → 5-7 天
  里程碑：工具调用准确率 +20%，延迟 -30%

第 3-4 周（P1 UX + P2 质量）：
  ├─ 3.7 项目级配置 → 2-3 天
  ├─ 3.6 UX 体验补齐 → 5-7 天
  ├─ 3.8 Reviewer Agent → 2-3 天
  └─ 3.9 分层 Context 管理 → 3-5 天
  里程碑：代码质量 +15%，UX 接近 CC

后续（P3）：
  └─ 3.10 代码索引完整版 → 5-7 天
```

### 依赖关系

```
3.11 评测基准（独立，最先做）
  ↓ 提供度量基线
3.1 Write-Verify-Fix（独立）
3.2 Plan 拆解（独立）
  ↓ 3.1 + 3.2 完成后跑评测验证
3.4 Prompt 适配（独立）
3.5 ModelProfile 抽象层（依赖 3.4 的 prompt 分阶段；其他所有模块的行为受 Profile 驱动）
3.3 Context 裁剪（独立，但 3.2 的步骤间 context 可复用）
  ↓ 3.3 完成后跑评测验证
3.7 项目配置（依赖 3.4 的 prompt 结构）
3.6 UX 补齐（独立，前端为主）
3.8 Reviewer Agent（依赖 3.2 的步骤执行机制）
3.9 分层 Context（依赖 3.3 的代码索引）
3.10 代码索引完整版（依赖 3.3）
```

---

## 5. 风险与边界

### 已知风险

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Write-Verify-Fix 的验证本身耗时过长 | 中 | 用户体感延迟 | 验证超时 15 秒兜底；TypeScript 项目预热 tsc 进程 |
| Plan 拆解输出的 JSON 解析失败 | 高（Qwen 常见） | Plan 模式不可用 | 用 JSON mode 强制 + 宽松解析（支持 JSON5） + 回退到文本解析 |
| 模型路由选错模型 | 低 | 简单任务用了贵模型 / 复杂任务用了弱模型 | 保守策略：默认用强模型，只有明确简单的才降级 |
| 新模型 Profile 参数不准 | 中 | 工具约束过严/过松、prompt 裁剪不当 | 每个新 Profile 必须跑评测基准验证，Profile 参数迭代闭环 |
| 代码索引在大型 monorepo 中性能差 | 中 | 启动慢 | 限制扫描深度 + 排除规则 + 增量更新 |
| 评测用例不具代表性 | 中 | 优化方向偏差 | 持续迭代用例集，加入真实用户反馈的失败场景 |

### 对现有功能的影响

- **Agent 主循环**：改动集中在迭代循环前（Planner 集成）和工具执行后（验证），不改变核心流程
- **工具系统**：新增 verifier 是可选的，不注册 verifier 时行为不变
- **Context 管理**：分阶段 prompt 是增量改动，现有 7 层结构不变
- **LLM 集成**：Provider.capabilities() 改为委托 ProfileRegistry，接口签名不变；ChatParams 新增可选的 responseFormat 字段（向后兼容）
- **前端**：UX 改动在前端包内，不影响 agent-runtime 接口

### 明确不做

- 不做多模型并行投票（成本 × 模型数，性价比低）
- 不做 LSP 集成（重量级，用正则索引替代）
- 不做自动测试生成（让模型写测试的可靠性太低）
- 不重写 Agent 主循环架构（在现有基础上扩展）

---

## 6. 预期里程碑

| 阶段 | 预计体验水平（CC+Opus = 100） | 关键变化 |
|------|------------------------------|---------|
| 当前 | 30 | — |
| 评测基准就绪 | 30（无变化） | 有了度量基线 |
| P0 完成 | 45-50 | 复杂任务从"不可能"变"基本能做" |
| P1 完成 | 55-60（≈ CC+Sonnet 80%） | 工具调用稳定，延迟好 |
| UX+P2 完成 | 65-70（≈ CC+Sonnet 90%） | 体验打磨到位，日常可用 |
| +模型迭代 | 75-85 | Qwen 模型能力追上来后 |

**总工作量**：约 37-58 人天（5-8 周）——其中 ModelProfile 抽象层约 4-6 天，但它是其他所有模块的行为驱动层，投入回报比高
