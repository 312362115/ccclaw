---
priority: P2
status: done
spec: docs/specs/2026-03-20-frontend-agent-adaptation.md
plan:
---

# 前端适配 Agent 新能力

今日 agent-runtime 新增了多项能力，前端需要同步适配。

## 待适配项

### 工具结果展示
- edit 工具的 diff 结果可视化（高亮替换前后）
- read 工具带行号的输出格式化
- write 工具的文件创建/覆写提示

### Plan 模式 UI
- 监听 `plan_mode` 事件，显示"计划模式"状态标识
- plan 输出使用 Markdown 渲染（编号列表、文件路径高亮）
- 提供"执行计划"快捷按钮（发送确认消息）

### 多模态（图片上传）
- 聊天输入框增加图片上传入口（粘贴/拖拽/按钮）
- 图片转 base64 ContentBlock 通过 AgentRequest.params.content 发送
- 消息列表中渲染图片内容块

### Hook 状态提示
- after hook 的输出（如 lint 结果）显示在工具结果区域
- before hook 警告信息高亮展示

## 相关代码
- `packages/agent-runtime/src/llm/types.ts` — ContentBlock / plan_mode 事件定义
- `packages/agent-runtime/src/protocol.ts` — AgentRequest.params.content
- `packages/web/src/stores/chat.ts` — 前端状态管理
