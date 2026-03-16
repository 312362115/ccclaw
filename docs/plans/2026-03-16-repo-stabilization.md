# CCCLaw 核心执行链路稳定化实施方案

> **给执行型 Agent：** 必须使用 `superpowers:subagent-driven-development`（如果支持子 Agent）或 `superpowers:executing-plans` 来执行本方案。步骤使用 `- [ ]` 复选框跟踪。

**目标：** 让仓库中的聊天 -> Runner -> Agent 执行链路在协议、实现和验证层面保持一致、可运行、可验证。

**架构：** 把当前仓库视为“平台壳已搭好、核心执行链路尚未收口”的状态。先统一 `server` 和 `agent-runtime` 的协议边界，再把 runtime 的真实依赖和持久化接通，然后修正前端流式状态与 WebSocket 订阅问题，最后补上执行路径的安全拦截和端到端验证。

**技术栈：** pnpm monorepo、TypeScript、Hono、Drizzle ORM、WebSocket、React 19、Zustand、Vitest、Dockerode

---

## 文件分布

**主要修改文件**
- `packages/server/src/core/agent-manager.ts`：Server 侧上下文组装、Provider 解析、下发给 Runner 前的请求整理
- `packages/server/src/core/runner-manager.ts`：Runner 启动方式、请求响应协议、本地 Runner 启动逻辑
- `packages/server/src/channel/webui.ts`：WebSocket 订阅生命周期、会话消息转发
- `packages/server/src/api/sessions.ts`：会话创建和加载逻辑，必要时与 runtime 持久化对齐
- `packages/agent-runtime/src/protocol.ts`：runtime 使用的标准请求/响应协议
- `packages/agent-runtime/src/index.ts`：Runner 启动入口、请求分发、依赖注入
- `packages/agent-runtime/src/agent.ts`：主 Agent Loop、上下文消费、工具执行、完成/错误语义
- `packages/agent-runtime/src/context-assembler.ts`：合并 server 上下文与 workspace 本地状态、工具清单
- `packages/agent-runtime/src/workspace-db.ts`：会话和消息持久化
- `packages/web/src/api/ws.ts`：前端 WebSocket 协议
- `packages/web/src/stores/chat.ts`：按会话划分的流式状态和消息缓冲
- `packages/web/src/pages/chat/ChatLayout.tsx`：监听器生命周期和会话切换行为

**主要新增文件**
- `packages/server/src/core/agent-manager.test.ts`：Server 侧请求协议测试
- `packages/server/src/channel/webui.test.ts`：订阅清理和消息转发测试
- `packages/agent-runtime/src/agent.integration.test.ts`：runtime 请求 -> LLM/工具执行集成测试
- `packages/web/src/stores/chat.test.ts`：多会话流式状态测试
- `packages/shared/src/agent-protocol.ts`：如果协议抽到共享层更稳，就在这里统一定义

**实现过程中要参考的文件**
- `packages/server/src/bus/index.ts`
- `packages/server/src/core/tool-guard.ts`
- `packages/server/src/core/workspace-storage.ts`
- `packages/shared/src/schemas.ts`
- `README.md`

## Chunk 1：统一 Server 与 Runner 协议

### 任务 1：定义唯一可信的 Agent 协议

**文件：**
- 修改：`packages/agent-runtime/src/protocol.ts`
- 修改：`packages/server/src/core/runner-manager.ts`
- 修改：`packages/server/src/core/agent-manager.ts`
- 新增：`packages/server/src/core/agent-manager.test.ts`
- 新增：`packages/shared/src/agent-protocol.ts`（仅当抽到共享层比重复定义更合理时）

- [ ] **步骤 1：先写失败测试**

写一个测试，断言 Server 下发给 Runner 的 payload 中显式包含 `workspaceId`、可用时的 `workspaceName`、`userPreferences`、`skills`、`memories`、`history` 以及 runtime 真正消费的 provider 字段。

- [ ] **步骤 2：运行测试，确认当前会失败**

运行：`pnpm --filter @ccclaw/server test -- agent-manager`
预期：FAIL，因为当前 payload 结构不完整或字段语义不一致。

- [ ] **步骤 3：定义标准请求/响应类型**

用一份统一协议替代当前分散的临时结构，移除“把 `systemPrompt` 塞进 `workspaceId`”这类兼容性 hack。

- [ ] **步骤 4：调整 Server 侧上下文组装**

让 `assembleContext()` 直接返回 runtime 能消费的结构化字段。字段命名保持稳定，不要让字段承担隐式语义。

- [ ] **步骤 5：再次运行聚焦测试**

运行：`pnpm --filter @ccclaw/server test -- agent-manager`
预期：PASS

- [ ] **步骤 6：提交**

```bash
git add packages/agent-runtime/src/protocol.ts packages/server/src/core/runner-manager.ts packages/server/src/core/agent-manager.ts packages/server/src/core/agent-manager.test.ts packages/shared/src/agent-protocol.ts
git commit -m "refactor: align server runner agent protocol"
```

### 任务 2：让本地 Runner 启动方式可预测

**文件：**
- 修改：`packages/server/src/core/runner-manager.ts`
- 修改：`packages/agent-runtime/package.json`
- 修改：`package.json`

- [ ] **步骤 1：先写失败用例或明确复现路径**

把“开发模式下不依赖过期 `dist` 产物”写成可验证的预期。

- [ ] **步骤 2：运行复现**

运行：`pnpm --filter @ccclaw/server dev`
预期：如果 `@ccclaw/agent-runtime/dist/index.js` 缺失或过期，当前实现会暴露出脆弱性。

- [ ] **步骤 3：实现确定性的启动路径**

二选一并明确下来：
- 开发环境：用 `tsx` 从源码启动 runtime
- 生产环境：只允许从构建产物启动

不要继续维持“开发时默认依赖 dist、但又不显式说明”的混合模式。

- [ ] **步骤 4：再次验证**

运行：`pnpm --filter @ccclaw/server dev`
预期：本地 Runner 启动路径清晰且稳定。

- [ ] **步骤 5：提交**

```bash
git add packages/server/src/core/runner-manager.ts packages/agent-runtime/package.json package.json
git commit -m "fix: make local runner startup deterministic"
```

## Chunk 2：打通真实 Runtime 执行链路

### 任务 3：用真实依赖替换 `echo` 回退

**文件：**
- 修改：`packages/agent-runtime/src/index.ts`
- 修改：`packages/agent-runtime/src/agent.ts`
- 修改：`packages/agent-runtime/src/context-assembler.ts`
- 新增：`packages/agent-runtime/src/agent.integration.test.ts`

- [ ] **步骤 1：先写失败的集成测试**

写一个测试，发送结构化 `run` 请求，并验证：
- 用户消息被持久化
- LLM Client 收到正确的 system prompt、history、tools
- assistant 返回内容会被流式发回
- `done` 事件带 usage 信息

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm --filter @ccclaw/agent-runtime test -- agent.integration`
预期：FAIL，因为 runtime 依赖尚未完整接通。

- [ ] **步骤 3：接好 runtime 启动依赖**

在 Runner 启动时实例化 `WorkspaceDB`、`ContextAssembler`、`ToolRegistry`、`Consolidator`、`LLMClient`、`MCPManager`，并稳定地传给 `runAgent()`。

- [ ] **步骤 4：去掉协议兼容性 hack**

让 runtime 直接消费标准协议中的 `workspaceId`、`userPreferences`、`skills`、`memories`、`history`，不要再伪造字段。

- [ ] **步骤 5：再次运行聚焦测试**

运行：`pnpm --filter @ccclaw/agent-runtime test -- agent.integration`
预期：PASS

- [ ] **步骤 6：提交**

```bash
git add packages/agent-runtime/src/index.ts packages/agent-runtime/src/agent.ts packages/agent-runtime/src/context-assembler.ts packages/agent-runtime/src/agent.integration.test.ts
git commit -m "feat: wire runtime agent execution path"
```

### 任务 4：让会话和消息由 runtime 负责持久化

**文件：**
- 修改：`packages/agent-runtime/src/workspace-db.ts`
- 修改：`packages/agent-runtime/src/agent.ts`
- 修改：`packages/server/src/api/sessions.ts`

- [ ] **步骤 1：先写失败的持久化测试**

覆盖 `workspace.db` 中会话创建、会话加载、消息追加，至少包括 user、assistant、tool 三类消息。

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm --filter @ccclaw/agent-runtime test -- workspace-db`
预期：FAIL，因为现有行为不完整或字段不一致。

- [ ] **步骤 3：补最小实现**

明确由 runtime 负责消息持久化，Server 不再假装拥有 runtime 本地历史的最终真相。

- [ ] **步骤 4：再次运行测试**

运行：`pnpm --filter @ccclaw/agent-runtime test -- workspace-db`
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add packages/agent-runtime/src/workspace-db.ts packages/agent-runtime/src/agent.ts packages/server/src/api/sessions.ts
git commit -m "feat: persist runtime chat sessions and messages"
```

## Chunk 3：修正流式状态与订阅正确性

### 任务 5：让 WebSocket 出站订阅幂等且可清理

**文件：**
- 修改：`packages/server/src/channel/webui.ts`
- 新增：`packages/server/src/channel/webui.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖以下场景：
- 同一 session 多次发送消息
- `done` 之前 socket 关闭
- `error` 路径下监听器清理

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm --filter @ccclaw/server test -- webui`
预期：FAIL，因为当前 handler 会堆积或不能稳定清理。

- [ ] **步骤 3：实现确定性的订阅生命周期**

按 `socket + session` 维度跟踪订阅。已有监听器就复用或替换，不要每次发消息都盲目追加。

- [ ] **步骤 4：再次运行聚焦测试**

运行：`pnpm --filter @ccclaw/server test -- webui`
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add packages/server/src/channel/webui.ts packages/server/src/channel/webui.test.ts
git commit -m "fix: stabilize websocket session subscriptions"
```

### 任务 6：让前端聊天流式状态按会话隔离

**文件：**
- 修改：`packages/web/src/stores/chat.ts`
- 修改：`packages/web/src/pages/chat/ChatLayout.tsx`
- 新增：`packages/web/src/stores/chat.test.ts`

- [ ] **步骤 1：先写失败测试**

构造两个 session 交错收到 `text_delta` 和 `done` 的场景，验证缓冲区不会串到另一个会话里。

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm --filter @ccclaw/web test -- chat`
预期：FAIL，因为当前 `streamBuffer` 和 `streaming` 是全局状态。

- [ ] **步骤 3：重构 store 为按 session 存储**

按 `sessionId` 保存缓冲区和 streaming 状态。切换会话时不能覆盖其他正在流式返回的会话状态。

- [ ] **步骤 4：再次运行聚焦测试**

运行：`pnpm --filter @ccclaw/web test -- chat`
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add packages/web/src/stores/chat.ts packages/web/src/pages/chat/ChatLayout.tsx packages/web/src/stores/chat.test.ts
git commit -m "fix: isolate chat streaming state by session"
```

## Chunk 4：补安全拦截和端到端验证

### 任务 7：把 ToolGuard 接入真实执行链路

**文件：**
- 修改：`packages/server/src/core/agent-manager.ts`
- 修改：`packages/server/src/core/tool-guard.ts`
- 修改：`packages/agent-runtime/src/tool-registry.ts`

- [ ] **步骤 1：先写失败的集成测试**

验证危险工具输入在真实执行路径中会被阻止，或在执行前要求确认。

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm --filter @ccclaw/server test -- tool-guard`
预期：FAIL，因为当前 guard 决策还没有真正落到执行路径里。

- [ ] **步骤 3：确定唯一拦截点并实现**

在工具执行前只保留一个可信拦截点，避免 Server 和 runtime 两边各自做一半，形成策略分裂。

- [ ] **步骤 4：再次运行聚焦测试**

运行：`pnpm --filter @ccclaw/server test -- tool-guard`
预期：PASS

- [ ] **步骤 5：提交**

```bash
git add packages/server/src/core/agent-manager.ts packages/server/src/core/tool-guard.ts packages/agent-runtime/src/tool-registry.ts
git commit -m "feat: enforce tool guard in execution path"
```

### 任务 8：补一条端到端聊天执行 smoke test

**文件：**
- 新增：`packages/server/src/core/chat-execution.e2e.test.ts`
- 修改：`package.json`
- 修改：`README.md`

- [ ] **步骤 1：先写失败的 smoke test**

在 test 模式下启动 server/runtime，使用 fake LLM client，并验证：
- 用户消息通过 WebSocket 或 bus 进入系统
- runner 收到请求
- runtime 发出 `text_delta` 和 `done`
- 面向前端的 payload 结构保持稳定

- [ ] **步骤 2：运行测试，确认失败**

运行：`pnpm test -- chat-execution`
预期：FAIL，直到完整链路真的打通。

- [ ] **步骤 3：实现最小测试支架和夹具**

让 smoke test 只证明“整条路径能工作”，不要在这里重复做所有单元测试。

- [ ] **步骤 4：再次运行 smoke test**

运行：`pnpm test -- chat-execution`
预期：PASS

- [ ] **步骤 5：更新文档**

在 `README.md` 里补充标准执行链路说明和测试命令。

- [ ] **步骤 6：提交**

```bash
git add packages/server/src/core/chat-execution.e2e.test.ts package.json README.md
git commit -m "test: cover end to end chat execution path"
```

## 推荐执行顺序

1. 先做 Chunk 1，先把协议和 Runner 启动方式收口
2. 再做 Chunk 2，把 runtime 真实执行链路接通
3. 再做 Chunk 3，等后端语义稳定后修正流式状态
4. 最后做 Chunk 4，补上安全拦截和端到端验证

## 重点风险

- 不要让 `server` 和 `agent-runtime` 继续维护两份会漂移的协议定义
- 不要让 Server 和 runtime 同时声称自己拥有会话历史
- 不要保留依赖隐式构建产物的本地 Runner 启动方式
- 不要让前端继续用全局 streaming 状态承载多会话
- 测试先聚焦关键路径，协议没稳定前不要急着堆脆弱的浏览器端测试

## 验证命令

每做完一个 Chunk 跑一次，全部完成后再全量跑一次：

```bash
pnpm --filter @ccclaw/shared test
pnpm --filter @ccclaw/server test
pnpm --filter @ccclaw/agent-runtime test
pnpm --filter @ccclaw/web test
pnpm typecheck
```

方案已保存到 `docs/plans/2026-03-16-repo-stabilization.md`。可以继续执行。
