# Agent 工程层提升 — 开发计划

## 关联
- 方案：docs/specs/2026-03-25-agent-engineering-boost.md
- Backlog：docs/backlog/2026-03-25-agent-engineering-boost.md

## 子任务

### Phase 0：基础设施

- [x] 1. ModelProfile 抽象层（3.5）
  - 做什么：新建 model-profile.ts 接口定义 + ProfileRegistry + 各厂商 Profile 文件 + ModelRouter；改造 Provider/Agent/ContextAssembler 读取 Profile
  - 涉及：`packages/agent-runtime/src/llm/model-profile.ts`（新建）、`profiles/`（新建目录 + 7 文件）、`model-router.ts`（新建）、`llm/types.ts`（改）、`llm/openai.ts`（改）、`llm/anthropic.ts`（改）、`llm/factory.ts`（改）、`agent.ts`（改）、`context-assembler.ts`（改）
  - 验收：所有现有 Provider 通过 ProfileRegistry 获取 capabilities；新增模型只需加 Profile 文件

- [x] 2. 评测基准（3.11）
  - 做什么：设计测试用例集（20-30 题）+ 自动化跑分脚本 + 验收判断器 + 报告生成
  - 涉及：`tests/eval/`（新建目录）
  - 验收：能自动跑全量用例并输出对比报告

### Phase 1：P0 核心

- [x] 3. Write-Verify-Fix 循环（3.1）
  - 做什么：ToolRegistry 新增 verifier 机制 + TypeScript/ESLint/Python/通用验证器
  - 涉及：`tool-registry.ts`（改）、`verify/`（新建）
  - 验收：write/edit 后自动验证，失败信息追加到工具结果

- [x] 4. 自动 Plan 拆解（3.2）
  - 做什么：新建 Planner + planning prompt + 集成到 Agent 循环
  - 涉及：`planner.ts`（新建）、`prompts/planning.ts`（新建）、`agent.ts`（改）
  - 验收：复杂任务自动拆解为结构化 JSON 计划并逐步执行

### Phase 2：P1 适配

- [x] 5. 分阶段 Prompt（3.4）
  - 做什么：新建 prompts/ 目录，实现 base/coding/reviewing 模板；ContextAssembler 按 Profile 选择策略
  - 涉及：`prompts/`（新建 4 文件）、`context-assembler.ts`（改）、工具 description 增强
  - 验收：弱模型走分阶段 prompt，强模型走单体 prompt

- [x] 6. 智能 Context 裁剪（3.3）
  - 做什么：新建 CodeIndex（正则扫描 + 关键词搜索 + 依赖追踪）；ContextAssembler 分层注入
  - 涉及：`code-index.ts`（新建）、`context-assembler.ts`（改）、`index.ts`（改）
  - 验收：context 中自动包含任务相关文件的签名

- [x] 7. 项目级配置增强（3.7）
  - 做什么：增强 AGENTS.md 解析，支持结构化指令
  - 涉及：`context-assembler.ts`（改）
  - 验收：AGENTS.md 中的编码规范/禁止操作能影响 Agent 行为

### Phase 3：UX + P2

- [x] 8. UX 体验补齐（3.6）
  - 做什么：Diff 预览 + bash streaming + 错误恢复 UI + thinking 展示优化
  - 涉及：`agent.ts`（改）、`tools/bash.ts`（改）、`packages/web/`（前端组件）
  - 验收：编辑前展示 diff，bash 实时输出，错误后有可选操作

- [x] 9. Reviewer Agent（3.8）
  - 做什么：SubagentManager 新增 review 角色 + 角色参数差异化
  - 涉及：`subagent-manager.ts`（改）、`agent.ts`（改）
  - 验收：Plan 步骤完成后触发 review，发现问题能反馈修复

- [x] 10. 分层 Context 管理（3.9）
  - 做什么：Consolidator 新增相关性评分，按相关性压缩而非按时间
  - 涉及：`consolidator.ts`（改）
  - 验收：高相关性对话在压缩时保留，低相关性优先压缩

### Phase 4：P3

- [x] 11. 代码索引完整版（3.10）
  - 做什么：扩展 CodeIndex 支持反向引用和影响分析
  - 涉及：`code-index.ts`（改）
  - 验收：改了 A 文件能自动推断可能影响 B、C 文件
