---
priority: P0
status: open
spec: docs/specs/2026-03-22-communication-architecture-redesign.md
plan: docs/plans/2026-03-22-communication-redesign-plan.md
---

# 通信架构重设计 — 端到端验证 & Phase 2/3

## 背景

Phase 1 代码已完成并提交（6 个 commit），核心改动：
- DirectServer 去 ECDH，改为纯 JSON + JWT 认证
- Runner chat 事件带 sessionId
- 前端 DirectWsClient 纯 JSON + DIRECT→TUNNEL→RELAY 回退
- 前端 handleChatEvent 统一处理
- Server ensure-config API + JWT_SECRET 传递

## 当前状态

### 已验证通过
- DirectServer 单元测试 8/8 通过
- 直连 WebSocket 连接成功（JWT 认证通过、ping/pong 正常）
- 文件树数据通过直连正常获取
- 手动 WebSocket 测试聊天（Runner secret 认证）返回完整 LLM 回复
- ensure-config API 成功推送 config 到 Runner，Provider 创建成功

### 待验证/修复
1. **端到端聊天回复显示**：通过 Playwright 测试发现直连聊天只收到 `session_done`（echo 模式），原因已定位为 debug 代码中 `fs` 变量错误导致 `ensure-config` 中途报错。debug 代码已清理，需要重新测试。
2. **开发环境 tsx watch 问题**：tsx watch 重启 Server 会杀掉 Runner 子进程，导致 binding 丢失、session 失效、需要重新登录。这是开发体验问题，不影响生产。

## 下一步

### 立即（P0）
- [ ] 清理环境后重新端到端验证直连聊天
- [ ] 确认 handleChatEvent 正确渲染 text_delta 到 UI

### Phase 2（P1）
- [ ] Server tunnel 改为 JSON 文本代理（当前还是 base64 binary）
- [ ] 端到端验证 tunnel 回退路径

### Phase 3（P2）
- [ ] 清理 ECDH 废弃代码（shared crypto 工具）
- [ ] 清理 RELAY 聊天中转路径（可选，确认 tunnel 可靠后）
- [ ] 清理前端 ws.ts 聊天相关代码
- [ ] 清理 shared agent-protocol.ts 废弃类型
- [ ] 移除临时调试日志
