---
priority: P0
status: done
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

## 完成状态（2026-03-23）

### 三条路径全部验证通过
- **RELAY 路径**：登录 → 创建 Workspace → WebSocket → 发消息 → Runner 本地启动 → LLM 流式回复 ✅
- **直连路径**：Runner directUrl 注册 → JWT 认证直连 → chat message → text_delta 流式回复 → sessionId 一致 → done 正常 ✅
- **Tunnel 路径**：Server tunnel JSON 文本透传 → DirectServer handleTunnelFrame → 聊天回复 → sessionId 一致 ✅

### Phase 2 ✅
- [x] Server tunnel 改为 JSON 文本代理（webui.ts base64→text）
- [x] 端到端验证 tunnel 回退路径

### Phase 3 ✅
- [x] 删除 ECDH 废弃代码（shared/src/ecdh.ts + ecdh.test.ts）
- [x] 清理 agent-protocol.ts 废弃字段（publicKey, encrypted, serverPublicKey）
- [x] 清理 Runner register 消息中的 publicKey 兼容字段
- [x] RELAY 路径保留（作为第三层回退，terminal 功能依赖）
- [x] 前端 ws.ts 保留（RELAY + terminal 功能依赖）
- [x] 无临时调试日志需要清理（均为有意义的 info 级别日志）

### 验证脚本
- `scripts/e2e-verify.mjs` — RELAY 路径
- `scripts/e2e-direct-verify.mjs` — 直连路径
- `scripts/e2e-tunnel-verify.mjs` — Tunnel 路径

### 已知问题（不阻塞）
- **开发环境 tsx watch 问题**：tsx watch 重启 Server 会杀掉 Runner 子进程，导致 binding 丢失、session 失效。开发体验问题，不影响生产。
