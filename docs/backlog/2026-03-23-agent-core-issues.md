---
priority: P0
status: done
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

### 3. ~~Tool 确认流程（confirm_request）未接通~~（P1）✅ 已修复
- **修复**：直连和 RELAY 两条路径均注册 confirmCallback
  - 直连：通过 directServer.sendToClient 发 confirm_request，waitForConfirm 等待回复
  - RELAY：通过 sendResponse 发 confirm_request，waitForConfirm 等待 Server 转发的 confirm_response
- **验证**：拒绝 rm -r（返回"用户拒绝"）、批准读 .env（成功读取内容）均通过
