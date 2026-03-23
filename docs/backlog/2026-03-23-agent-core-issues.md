---
priority: P0
status: open
spec:
plan:
---

# Agent 核心能力修复

E2E 验证发现的 Agent 运行时问题，阻塞核心对话能力。

## 问题列表

### 1. ~~Agent 工具执行失败 — tool arguments 解析问题~~（P0）✅ 已修复
- **根因**：OpenAIAdapter 流式解析中，第一个 chunk 同时含 id+name+arguments 时，arguments 被 else if 跳过
- **修复**：openai.ts tool_use_start 分支中增加 arguments 检查，同步 emit tool_use_delta

### 2. ~~Agent 循环无最大迭代限制~~（P0）✅ 已修复
- **修复**：DEFAULT_MAX_ITERATIONS 50→25 + 连续工具失败 3 次自动终止（MAX_CONSECUTIVE_TOOL_ERRORS）

### 3. Tool 确认流程（confirm_request）未接通（P1）
- **现象**：ToolGuard 检测到危险操作时 confirmCallback 为空，直接放行
- **影响**：`git push --force`、`rm -rf`、`DROP TABLE` 等危险操作不弹确认
- **修复**：
  - 直连 chat handler 中注册 confirmCallback
  - callback 通过 directServer 发 confirm_request 事件到前端
  - 等待前端 confirm_response 返回 Promise<boolean>
  - RELAY 路径同理（通过 messageBus）
