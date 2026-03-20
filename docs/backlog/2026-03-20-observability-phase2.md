---
priority: P2
status: open
spec:
plan:
---

# 可观测性二期

一期（已完成）：Pino 日志、请求延迟中间件、health 端点增强。
二期聚焦指标导出和数据治理。

## Prometheus Metrics 导出
- HTTP 请求计数/延迟直方图
- WebSocket 连接数
- Agent 请求计数/延迟
- Token 消耗速率
- Runner 在线数
- Scheduler 队列深度

## 数据治理
- token_usage 按天聚合视图（保留 2 年）
- session 老化归档（超过 N 天的 session 压缩存档）
- 异地备份对接（S3/OSS）

## 备注
部署文档 `docs/specs/system-design/deployment.md` 有完整的 metrics 和告警规则设计。
