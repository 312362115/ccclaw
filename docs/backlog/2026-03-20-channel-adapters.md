---
priority: P2
status: open
spec:
plan:
---

# 渠道适配器扩展

目前只有飞书渠道，需要扩展 Telegram 和 Email。

## Telegram
- Bot API 接入（长轮询或 Webhook）
- 消息格式转换（Markdown → Telegram HTML）
- 文件/图片收发

## Email
- IMAP 监听收件 / SMTP 发件
- 邮件解析（提取正文、附件）
- 线程追踪（Subject/In-Reply-To）

## 备注
参考 `packages/server/src/channel/feishu.ts` 的适配器模式。
