---
priority: P1
status: open
spec:
plan:
---

# 平台功能端到端验证

E2E 通信和 Agent 核心修复完成后，系统性验证剩余平台功能。

## 验证清单（按优先级排序）

### 第一批：核心能力（P0）
- [x] 1. **上下文压缩（Consolidator）** — 8 轮长对话连贯性 7/7 ✅ + LLM 回调接通 + 单元测试 25/25
- [ ] 2. **Terminal** — PTY 打开/输入/输出/关闭，前端通道透传（已修复 workspaceId→slug bug，node-pty 在子进程中可能有 native 模块加载问题待排查）
- [x] 3. **定时任务（Scheduler）** — CRUD + nextRunAt 自动计算/重算 + 无效 cron 拒绝 ✅（修复了创建时 nextRunAt 未设置的 bug）

### 第二批：Agent 高级能力（P1）
- [x] 4. **Sub-agent（spawn）** — 派生→独立执行（2 轮）→文件创建→结果回传 ✅（修复了 model 硬编码 bug）
- [x] 5. **Memory 工具** — write/read/search + 跨 session 持久化 ✅
- [x] 6. **Plan 模式** — /plan 触发 → plan_mode 事件 → 不调用工具 → 输出计划文本 ✅

### 第三批：平台功能（P2）
- [ ] 7. **Skill 管理** — 技能创建/加载/执行
- [ ] 8. **Session 管理** — 历史消息读取/会话列表
- [ ] 9. **Token 刷新** — refresh token 续期
- [ ] 10. **RBAC 工作区权限** — 跨用户访问隔离

## 已完成的验证（2026-03-23）
- ✅ 通信三路径（RELAY / 直连 / Tunnel）
- ✅ 文件系统全操作（tree/create/read/write/rename/delete/FileWatcher）
- ✅ Tool Call 事件流 + arguments 修复
- ✅ Tool Confirm 流程（拒绝 + 批准）
- ✅ Auth 登录 / Provider 配置 / Workspace CRUD / Runner 启动
