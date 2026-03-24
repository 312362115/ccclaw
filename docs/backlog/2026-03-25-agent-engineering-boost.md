---
priority: P0
status: open
---

# Agent 工程层提升：用工程手段补偿弱模型，追平 CC+Sonnet 体验

## 背景

当前 CCCLaw 的 Agent 框架工程能力约在 Claude Code 的 70-80%，但搭配 Qwen3-Coder 模型后，综合体验只有 CC+Opus 的 30% 左右。差距的本质不在框架，在模型——但模型短期内无法替换，需要通过 Agent 层的工程手段来补偿。

目标：在不换模型的前提下，通过工程优化把体验从 CC+Opus 的 30% 提升到 CC+Sonnet 的 80%（约 CC+Opus 的 55-60%）。

## 差距分析

### 框架层（CCCLaw vs Claude Code 框架）

| 能力维度 | CCCLaw | Claude Code | 差距 |
|---------|--------|-------------|------|
| 基础工具集（bash/read/write/edit/git/glob/grep/webfetch） | ✅ | ✅ | 持平 |
| 工具确认流程 | ✅ confirmCallback | ✅ | 持平 |
| 子 Agent / Spawn | ✅ SubagentManager | ✅ Agent tool | 小 |
| Context 压缩 | ✅ Consolidator（粗暴压缩） | ✅ 精细压缩 | **中** |
| MCP 扩展 | ✅ 框架有，实际为空 | ✅ 生态丰富 | 中 |
| Skill 系统 | ✅ SkillLoader | ✅ Skill tool | 小 |
| Memory 系统 | ✅ workspace.db | ✅ 文件级 memory | 持平 |
| 计划模式 | ❌ 未实现 | ✅ Plan mode | **中** |
| Hook 系统 | ✅ HookRunner | ✅ | 小 |
| Web UI | ✅（优势） | ❌ 纯 CLI | **CCCLaw 领先** |
| 文件编辑器（CodeMirror） | ✅ | CLI 内编辑 | **CCCLaw 领先** |

**框架层结论**：核心工具链齐全，差在 Context 管理的精细度和 MCP 生态。Web UI 是差异化优势。

### 模型层（Qwen3-Coder vs Opus 4.6）— 最大差距

| 能力 | Qwen3-Coder | Opus 4.6 | 影响 |
|------|-------------|----------|------|
| 代码理解深度 | 中等，大文件容易丢细节 | 极强，1M context 内精准定位 | Agent 做复杂任务的成功率 |
| 工具调用准确性 | 经常参数错误或选错工具 | 极少出错，知道何时并行 | 一次改对 vs 来回试错 |
| 多步推理 | 3-5 步后容易跑偏 | 10+ 步仍能保持连贯 | 大型重构/新功能的可行性 |
| 指令遵循 | 中等，system prompt 长了容易忽略 | 强，复杂规则也能遵守 | CLAUDE.md 级别的规范执行 |
| Context 窗口 | 32K-128K（有效利用率更低） | 1M（有效利用率高） | 大项目跨文件理解能力 |
| 自我纠错 | 弱，错了倾向于重复 | 强，能识别自己的错误 | 卡死 vs 自我恢复 |
| 代码质量 | 能用，但经常需要人改 | 接近高级工程师水平 | 产出可直接用 vs 需要 review |

**模型层结论**：Qwen3-Coder 在 Agent 编码场景下约为 Opus 4.6 的 30-40%。

### 综合体验评分

```
Claude Code + Opus 4.6:  ████████████████████ 100
CCCLaw + Opus 4.6:       ███████████████░░░░░  75   ← 框架差一些，模型一样
CC + Sonnet:             ██████████████░░░░░░  70   ← 追赶目标
CCCLaw + Qwen3-Coder:    ██████░░░░░░░░░░░░░░  30   ← 当前实际
```

### 按任务复杂度的表现差异

- **简单任务**（改样式、加字段）：差距不大，Qwen 能胜任
- **中等任务**（跨 3-5 文件的功能）：差距明显，Qwen 经常需要人工介入纠正
- **复杂任务**（架构重构、新模块设计）：差距巨大，Qwen 基本无法独立完成

## 核心思路

弱模型的问题本质是三个：**想不清楚**、**看不全面**、**做不准确**。工程层要在这三个方向上补偿：

- 想不清楚 → **自动 Plan 拆解**（降低单步难度）
- 看不全面 → **智能 Context 裁剪**（让模型看到该看的）
- 做不准确 → **验证驱动循环**（错了自动修）

## 工程提升方案

### 一、Write-Verify-Fix 循环（P0，预期提升：成功率 60% → 85%）

> 模型写错了不可怕，可怕的是不知道错了。加自动验证，让错误立即暴露。

#### 1.1 自动验证 + 重试

模型生成代码后，自动执行验证，失败则喂回错误让模型修复：

```
模型生成代码
  ↓
自动验证（不需要模型参与）:
  ├─ TypeScript: tsc --noEmit
  ├─ ESLint: eslint --fix
  ├─ Python: python -c "import ast; ast.parse(code)"
  ├─ 通用: 检查语法、括号匹配
  ↓
验证通过 → 写入文件
验证失败 → 把错误信息喂回模型，要求修复（最多重试 2 次）
```

Claude Code 体验好很大程度上因为 Opus 一次写对的概率高。Qwen 一次写对概率低，但加上自动验证 + 重试，最终成功率可以接近。

#### 1.2 变更影响检测

模型改了一个文件后，自动跑类型检查和相关测试：

```typescript
// 在 tool registry 的 write/edit 工具后加 hook
afterToolExec('write', async (result) => {
  const errors = await runTypeCheck();
  if (errors.length > 0) {
    return { autoFeedback: `写入后类型检查失败:\n${errors.join('\n')}\n请修复。` };
  }
});
```

#### 涉及模块
- `packages/agent-runtime/src/tool-registry.ts` — 添加 afterExec hook 机制
- `packages/agent-runtime/src/tools/write.ts` / `edit.ts` — 注册验证 hook
- 新建 `packages/agent-runtime/src/verify/` — 各语言验证器

#### 预估工作量：2-3 天

---

### 二、自动 Plan 拆解（P0，预期提升：复杂任务可行性质变）

> Qwen 做不了 10 步的任务，但能做好 1-2 步的任务。把大任务自动拆成小步。

#### 2.1 规划与执行分离

收到复杂需求时，不直接让模型开干：

```
第一轮对话（规划轮，用专门的 planning prompt）:
  "分析这个需求，列出需要修改的文件和每个文件的改动要点。
   只输出计划，不写代码。"
  ↓
得到计划（JSON 格式，结构化）:
  [
    { step: 1, file: "src/auth.ts", action: "修改 login 函数", detail: "..." },
    { step: 2, file: "src/middleware.ts", action: "添加 token 校验", detail: "..." },
  ]
  ↓
逐步执行（每步一轮对话，context 只包含当前步骤相关的文件）:
  "请执行第 1 步：修改 src/auth.ts 的 login 函数。要求：..."
  ↓
每步执行后验证，通过才进入下一步
```

关键：规划时不写代码（降低难度），执行时只改一个文件（降低难度）。两步都在 Qwen 的能力范围内。

#### 2.2 步骤间 Context 传递

每步完成后，只把结论传递给下一步，不带整个对话：

```
步骤 1 完成 → 摘要："已在 src/auth.ts 中添加 validateToken(token: string): boolean"
步骤 2 context：步骤 1 的摘要 + 步骤 2 需要的文件
```

#### 涉及模块
- 新建 `packages/agent-runtime/src/planner.ts` — 任务拆解引擎
- `packages/agent-runtime/src/agent.ts` — 集成 plan-then-execute 流程
- `packages/agent-runtime/src/consolidator.ts` — 步骤间摘要生成

#### 预估工作量：3-5 天

---

### 三、智能 Context 裁剪（P1，预期提升：等效窗口 ×2-3）

> 模型能力不够，就把"题目"出得更简单。给模型精准的上下文，比给它大窗口更有效。

#### 3.1 代码索引

启动时扫描项目，建立轻量索引（不需要 LSP，正则提取即可）：

```
文件 → 导出符号（export function/class/const）
文件 → import 依赖关系
文件 → 文件类型/大小/最后修改时间
```

用户提问时，先用关键词匹配 + 依赖链追踪，筛出相关文件，只把相关代码送进 context。

**效果**：把 32K 窗口的有效利用率从 30% 提升到 80%。弱模型 + 精准 context ≈ 强模型 + 粗放 context。

#### 3.2 分层 Context 策略

```
Level 0 - 始终在场（~2K）：system prompt + 项目结构摘要 + 当前任务描述
Level 1 - 按需注入（~6K）：当前编辑文件 + 直接依赖文件的签名
Level 2 - 工具获取：      模型主动 grep/read 拿到的内容
Level 3 - 丢弃层：        历史对话、已完成的工具结果
```

Qwen 的 128K 窗口，Level 0+1 控制在 8K 以内，留 120K 给工作区。每轮对话后积极清理 Level 3。

#### 涉及模块
- 新建 `packages/agent-runtime/src/code-index.ts` — 代码索引构建
- `packages/agent-runtime/src/context-assembler.ts` — 分层 context 装配
- `packages/agent-runtime/src/consolidator.ts` — 按相关性压缩而非按时间

#### 预估工作量：5-7 天

---

### 四、针对 Qwen 的 Prompt 适配（P1，预期提升：工具调用准确率 +20%）

#### 4.1 强制结构化输出

Qwen 容易输出不规范的 JSON、漏掉参数。在 system prompt 中加约束：

```
工具调用规则：
1. 每次只调用一个工具（不要并行，你容易出错）
2. 调用前先用一句话说明你要做什么
3. 文件路径必须是绝对路径
4. edit 工具的 old_string 必须从文件中精确复制
```

#### 4.2 分阶段 System Prompt

不同阶段用不同的 system prompt，而不是一个巨大的 prompt：

```
需求理解阶段：精简 prompt，只包含"理解需求"的指导
规划阶段：    只包含"如何拆解任务"的指导
编码阶段：    只包含工具使用规范 + 当前文件的编码约定
审查阶段：    只包含代码审查标准
```

一个 50K 的 system prompt 对 Qwen 来说信息过载，分阶段加载可以显著降低指令遵循的失败率。

#### 4.3 Few-shot 示例注入

在关键工具的描述中嵌入正确示例：

```
edit 工具描述：
  "替换文件中的文本片段。

  正确示例：
  old_string: 'function login(user: string) {'
  new_string: 'function login(user: string, password: string) {'

  错误示例（不要这样做）：
  old_string: 'function login'  ← 太短，可能匹配多处"
```

#### 涉及模块
- `packages/agent-runtime/src/context-assembler.ts` — 分阶段 prompt 切换
- `packages/agent-runtime/src/tools/*.ts` — 工具描述优化
- 新建 `packages/agent-runtime/src/prompts/` — 各阶段 prompt 模板

#### 预估工作量：1-2 天

---

### 五、多 Agent 架构 — Reviewer Agent（P2，预期提升：代码质量 +15%）

#### 5.1 执行者 + 审查者

每次代码修改后，用另一个 Agent 调用做 review：

```
Agent A（执行者）：写代码
  ↓
Agent B（审查者）：review 代码，找问题
  ↓
有问题 → 反馈给 Agent A 修复
没问题 → 通过
```

两个弱模型互相检查，比一个弱模型自己检查效果好得多。这是"辩论"模式的工程化应用。

#### 5.2 Specialist Agents

不同类型的任务用不同的 prompt + 参数：

```
代码生成 Agent: temperature=0.1, 严格遵循规范
探索分析 Agent: temperature=0.3, 鼓励发散思考
文档生成 Agent: temperature=0.2, 注重结构清晰
```

#### 涉及模块
- `packages/agent-runtime/src/subagent-manager.ts` — 扩展 reviewer 角色
- `packages/agent-runtime/src/agent.ts` — 集成 review 循环

#### 预估工作量：2-3 天

---

### 六、分层 Context 管理（P2，预期提升：长对话稳定性）

在 Consolidator 中实现按相关性压缩：

- 当前实现：对话历史超长后粗暴截断/总结
- 目标实现：按与当前任务的相关性打分，低相关性的对话先压缩，高相关性的保留原文

#### 涉及模块
- `packages/agent-runtime/src/consolidator.ts` — 相关性评分 + 分级压缩

#### 预估工作量：3-5 天

---

### 七、代码索引 — import/export 依赖图（P3）

用正则或 Tree-sitter 解析项目代码，构建：

- 文件 → 导出符号映射
- 文件 → import 依赖关系图
- 符号 → 定义位置 + 引用位置

模型需要理解某个函数时，自动提供调用链和依赖上下文，降低对模型代码理解能力的依赖。

#### 预估工作量：5-7 天

---

### 八、评测基准 — 量化进度（P0）

> 没有评测就不知道改了之后有没有提升，所有优化都是凭感觉。

#### 8.1 标准测试集

准备 20-30 个真实编码任务，分三档：

```
简单（10 题）：改样式、加字段、修 typo、写单个函数
中等（10 题）：跨 3-5 文件的功能、bug 修复、API 对接
复杂（5-10 题）：新模块设计、架构重构、多步调试
```

每题包含：需求描述、初始代码、验收条件（自动化可检测）。

#### 8.2 评测维度

| 维度 | 计算方式 | CC+Sonnet 基线（预估） |
|------|---------|----------------------|
| 一次成功率 | 首次输出直接通过验收 / 总题数 | ~65% |
| 最终成功率 | 允许 3 次重试后通过 / 总题数 | ~85% |
| 平均轮次 | 完成任务的平均对话轮次 | ~4 轮 |
| 编译通过率 | 生成代码能通过 tsc/lint | ~90% |
| 平均耗时 | 从输入需求到完成 | ~2 分钟 |

#### 8.3 自动化跑分

```
1. 先用 CC+Sonnet 跑全部用例，建立基线
2. 用 CCCLaw+Qwen 跑同样用例，输出对比报告
3. 每次工程优化后重跑，跟踪趋势
```

#### 涉及模块
- 新建 `tests/eval/` — 测试用例集
- 新建 `tests/eval/runner.ts` — 自动化评测脚本
- 新建 `tests/eval/report.ts` — 对比报告生成

#### 预估工作量：3-5 天

---

### 九、Qwen 专项调优（P1）

Prompt 适配之外的模型侧优化。

#### 9.1 Prompt Caching

Qwen API 支持 prefix caching，system prompt 不变部分可以缓存：

```
首次请求：完整 system prompt（~8K tokens）→ 缓存
后续请求：只发变化部分 → 延迟降低 30-50%，成本降低
```

需要在 LLMProvider 层支持 cache-aware 的消息构建。

#### 9.2 模型路由

不同任务用不同模型，CC 也是这么干的（Haiku 跑子任务，Sonnet/Opus 跑主任务）：

```
简单任务 / 子 Agent → Qwen-Turbo（快 + 便宜）
复杂任务 / 主 Agent → Qwen-Max 或 Qwen-Coder-Plus（能力强）
规划阶段 → 用最强模型（决策质量决定后续所有步骤）
执行阶段 → 用快速模型（按计划执行，难度低）
```

需要在 Agent 层根据任务类型自动选择模型。

#### 9.3 结构化输出模式

Qwen 支持 JSON mode / function calling mode，强制工具调用走结构化输出而不是自由文本，减少格式错误：

```
当前：模型自由生成文本，解析工具调用 → 经常格式错误
优化：启用 function calling mode → API 层面保证格式正确
```

#### 涉及模块
- `packages/agent-runtime/src/llm/openai.ts` — prompt caching + function calling 适配
- `packages/agent-runtime/src/agent.ts` — 模型路由逻辑
- `packages/agent-runtime/src/subagent-manager.ts` — 子 Agent 用轻量模型

#### 预估工作量：3-5 天

---

### 十、UX 体验补齐（P1）

CC+Sonnet 体验好不只是模型强，UX 打磨也很到位。

#### 10.1 Diff 预览

编辑文件前展示差异，用户可以 approve / reject：

```
Agent 要修改 src/auth.ts
  ↓
前端展示 unified diff（绿色加行、红色删行）
  ↓
用户点「应用」→ 写入文件
用户点「拒绝」→ 跳过，Agent 继续
```

#### 10.2 工具执行进度

bash 命令执行时实时输出，不是等结束才返回全部内容。需要 bash 工具支持 streaming output。

#### 10.3 错误恢复 UX

出错后给用户明确选项，而不是模型自己决定：

```
[编译失败] src/auth.ts:42 - Type 'string' is not assignable to type 'number'

  [重试修复]  [换方案]  [手动处理]
```

#### 10.4 流式 thinking 展示优化

当前有 thinking_delta 但前端展示可以更好：折叠/展开、渐进式渲染、视觉区分思考 vs 输出。

#### 涉及模块
- `packages/web/src/pages/chat/` — Diff 预览组件、错误恢复 UI
- `packages/agent-runtime/src/tools/bash.ts` — streaming output 支持
- `packages/web/src/components/` — thinking 展示优化

#### 预估工作量：5-7 天

---

### 十一、项目级配置（CLAUDE.md 等效物）（P1）

CC 的 CLAUDE.md 机制非常强——每个项目可以定制 Agent 行为。对弱模型尤其重要，因为项目级的 few-shot 示例可以大幅提升特定项目的成功率。

#### 需要确认和完善

- 用户能在工作区里放 `AGENTS.md` 或 `.ccclaw/config.md` 来指导 Agent
- 配置能覆盖 system prompt 的部分行为（编码规范、技术栈偏好、禁止操作等）
- 支持项目级 few-shot 示例：「在本项目中，修改 API 时要同步更新 OpenAPI spec」
- ContextAssembler 启动时自动读取并注入

#### 涉及模块
- `packages/agent-runtime/src/context-assembler.ts` — 读取项目配置文件
- 文档：项目配置文件格式规范

#### 预估工作量：2-3 天

---

## 实施路线图

```
第 0 周（前置）：
  └─ 评测基准搭建（3-5 天）— 没有度量就没有优化
  产出：20-30 题测试集 + 自动化跑分脚本 + CC+Sonnet 基线数据

第 1 周（P0 核心）：
  ├─ Write-Verify-Fix 循环（2-3 天）
  └─ 自动 Plan 拆解（3-5 天）
  预期效果：成功率 60% → 85%，复杂任务可行性质变

第 2 周（P1 模型 + Context）：
  ├─ Qwen Prompt 适配（1-2 天）
  ├─ Qwen 专项调优：prompt caching + 模型路由 + 结构化输出（3-5 天）
  └─ 智能 Context 裁剪（5-7 天）
  预期效果：工具调用准确率 +20%，延迟 -30%，等效窗口 ×2-3

第 3-4 周（P1 UX + P2 质量）：
  ├─ 项目级配置（AGENTS.md 等效物）（2-3 天）
  ├─ UX 体验补齐：Diff 预览 + 错误恢复 + streaming（5-7 天）
  ├─ Reviewer Agent（2-3 天）
  └─ 分层 Context 管理（3-5 天）
  预期效果：代码质量 +15%，用户体验接近 CC 水准

后续（P3）：
  └─ 代码索引（5-7 天）
```

## 预期里程碑

| 阶段 | 时间 | 预计体验水平（CC+Opus = 100） | 关键变化 |
|------|------|------------------------------|---------|
| 当前 | — | 30 | — |
| 评测基准就绪 | 第 0 周 | 30（无变化） | 有了度量基线，后续优化可量化 |
| P0 完成 | 第 1 周 | 45-50 | 复杂任务从"不可能"变"基本能做" |
| P1 完成 | 第 2 周 | 55-60（≈ CC+Sonnet 70%） | 工具调用稳定，延迟体感好 |
| UX+P2 完成 | 第 4 周 | 65-70（≈ CC+Sonnet 85%） | 体验打磨到位，日常可用 |
| +模型迭代 | 半年后 | 75-85 | Qwen 模型能力追上来 |

## 全部方向汇总（11 项）

| # | 方向 | 优先级 | 核心目标 | 工作量 |
|---|------|--------|---------|--------|
| 1 | Write-Verify-Fix 循环 | P0 | 自动验证 + 重试，成功率 60→85% | 2-3 天 |
| 2 | 自动 Plan 拆解 | P0 | 降低单步难度，复杂任务可行 | 3-5 天 |
| 3 | 评测基准 | P0 | 量化进度，有基线才能优化 | 3-5 天 |
| 4 | 智能 Context 裁剪 | P1 | 精准上下文，等效窗口 ×2-3 | 5-7 天 |
| 5 | Qwen Prompt 适配 | P1 | 工具调用准确率 +20% | 1-2 天 |
| 6 | Qwen 专项调优 | P1 | prompt cache + 模型路由 + 结构化输出 | 3-5 天 |
| 7 | UX 体验补齐 | P1 | Diff 预览、错误恢复、streaming | 5-7 天 |
| 8 | 项目级配置 | P1 | AGENTS.md 等效物，项目级 few-shot | 2-3 天 |
| 9 | Reviewer Agent | P2 | 双 Agent 互检，代码质量 +15% | 2-3 天 |
| 10 | 分层 Context 管理 | P2 | 长对话稳定性 | 3-5 天 |
| 11 | 代码索引 | P3 | import/export 依赖图，降低模型理解负担 | 5-7 天 |

**总工作量**：约 35-55 人天（4-7 周）

## 边界说明

- 做完全部 11 项，预计到 CC+Sonnet 的 85%，剩余 15% 差距在模型推理能力本身
- Qwen 团队迭代速度快，半年后模型层差距可能从 30-40% 缩到 50-60%
- 工程优化 + 模型迭代双轮驱动，有机会在年内达到 CC+Sonnet 的 90%+
- 评测基准是一切的前提——先建基线，每次优化后重跑，用数据说话
