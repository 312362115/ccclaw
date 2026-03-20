---
priority: P2
status: open
spec:
plan:
---

# Runner 作为独立 Agent 服务（OpenAI 兼容）

## 想法
Runner 可以作为一个 OpenAI API 兼容的服务商，对外提供 AI Agent 能力。
让其他人/系统可以通过标准 OpenAI SDK 接入 CCCLaw 的 Agent 能力。

## 核心要点
- Runner 暴露 OpenAI 兼容的 `/v1/chat/completions` 接口
- 支持 streaming（SSE）和非 streaming 模式
- 工具调用映射为 OpenAI function calling 格式
- 可独立部署，不依赖 CCCLaw Server
- 认证：API Key 或 Bearer Token

## 可能的场景
- 给团队成员提供统一的 AI Agent 入口
- 对接第三方工具（如 Cursor、Continue 等 IDE 插件）
- 作为微服务嵌入其他系统
