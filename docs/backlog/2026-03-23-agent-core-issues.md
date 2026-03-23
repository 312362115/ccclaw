---
priority: P0
status: open
spec:
plan:
---

# Agent 核心能力修复

E2E 验证发现的 Agent 运行时问题，阻塞核心对话能力。

## 问题列表

### 1. Agent 工具执行失败 — tool arguments 解析问题（P0）
- **现象**：AI 调用 write 工具时 `path` 参数为 undefined，`resolve(WORKSPACE, undefined)` 报 `paths[1]` 错误
- **原因**：Gemini 模型通过 litellm 代理返回的 tool_call arguments 可能拼接不完整或参数名不匹配
- **影响**：Agent 无法执行文件操作工具，陷入无限重试
- **定位方向**：
  - 在 agent.ts tool_use_end 处添加 input 日志，确认实际收到的参数内容
  - 检查 OpenAIAdapter stream 中 tool_call delta 的拼接逻辑
  - 对比 Claude vs Gemini 返回的 tool_call 格式差异
- **复现**：`node scripts/e2e-tool-call-verify.mjs`

### 2. Agent 循环无最大迭代限制（P0）
- **现象**：tool 执行持续失败时 AI 无限重试（测试中重试 50 次直到 token 耗尽）
- **影响**：浪费 token、前端无响应假死
- **修复**：agent.ts 的 while 循环加 MAX_ITERATIONS 限制（建议 25），超限后发 error 事件

### 3. Tool 确认流程（confirm_request）未接通（P1）
- **现象**：ToolGuard 检测到危险操作时 confirmCallback 为空，直接放行
- **影响**：`git push --force`、`rm -rf`、`DROP TABLE` 等危险操作不弹确认
- **修复**：
  - 直连 chat handler 中注册 confirmCallback
  - callback 通过 directServer 发 confirm_request 事件到前端
  - 等待前端 confirm_response 返回 Promise<boolean>
  - RELAY 路径同理（通过 messageBus）
