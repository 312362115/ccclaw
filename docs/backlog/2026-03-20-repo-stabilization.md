---
priority: P1
status: open
spec:
plan: docs/plans/2026-03-16-repo-stabilization.md
---

# Repo 稳定性加固

已有方案文档但未执行。核心目标：让 chat → Runner → Agent 链路在各种异常场景下稳定可靠。

## 关键项

- Server/Runner 协议对齐：消息格式一致性校验
- WebSocket 订阅生命周期：断连重连时的状态恢复
- 前端流式状态隔离：多 session 并发时互不干扰
- Runner 启动失败的优雅降级和用户提示

## 备注
方案在 `docs/plans/2026-03-16-repo-stabilization.md`，可直接按计划执行。
