## 关联
- 方案：docs/specs/2026-03-24-terminal-direct-connection.md
- Backlog：docs/backlog/2026-03-24-direct-connection-expansion.md

## 子任务

- [x] 1. Runner DirectServer 支持 terminal channel
  - 做什么：handleDirectMessage 新增 terminal channel 处理（open/input/resize/close）
  - 涉及：`packages/agent-runtime/src/index.ts`（handleDirectMessage 函数）
  - 验收：DirectServer 收到 terminal 消息后正确调用 terminalManager

- [x] 2. Runner 终端输出通过直连回传
  - 做什么：TerminalManager onOutput/onExit 回调中增加 DirectServer broadcastToAll
  - 涉及：`packages/agent-runtime/src/index.ts`（initModules 函数）
  - 验收：终端输出同时通过直连和 relay 发出

- [x] 3. 前端 useDirectConnection 处理 terminal 事件
  - 做什么：onMessage 新增 terminal channel，维护回调 Map，暴露注册方法
  - 涉及：`packages/web/src/hooks/useDirectConnection.ts`
  - 验收：直连收到 terminal output/exit 时触发已注册的回调

- [x] 4. 前端 TerminalPanel 接收端走直连
  - 做什么：直连可用时用 onDirectTerminalOutput/Exit 替代 ws.ts 回调
  - 涉及：`packages/web/src/pages/chat/TerminalPanel.tsx`
  - 验收：终端输入输出全链路走直连，relay 作为 fallback
