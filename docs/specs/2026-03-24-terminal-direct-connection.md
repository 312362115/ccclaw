## 技术方案：终端直连

### 1. 背景与目标
- 当前终端走 Server relay（Browser → Server WS → Runner），多一跳导致输入延迟明显
- 聊天和文件树已走直连（Browser → Runner DirectWs），终端需要对齐
- 验收标准：终端输入无感知延迟（< 50ms）；直连断开时 graceful fallback 到 relay
- 不做：文件实时编辑（另一个 backlog）、relay 路径删除

### 2. 现状分析
- TerminalPanel 发送端已有双路径代码（sendDirectMessage 存在时走直连格式）
- 但 Runner DirectServer 未处理 terminal channel，消息发出后无人接收
- 接收端（terminal output/exit）仅走 ws.ts 回调，直连路径完全没接
- Tunnel 路径是 DirectMessage 透传，terminal channel 接通后自动可用

### 3. 方案设计

**整体思路**：Runner DirectServer 新增 terminal channel 处理，前端 useDirectConnection 新增 terminal 事件分发，TerminalPanel 接收端改走直连回调。

**消息协议**（复用 DirectMessage 格式）：

| 方向 | channel | action | data |
|------|---------|--------|------|
| 前端→Runner | terminal | open | `{ terminalId, cols, rows }` |
| 前端→Runner | terminal | input | `{ terminalId, data }` |
| 前端→Runner | terminal | resize | `{ terminalId, cols, rows }` |
| 前端→Runner | terminal | close | `{ terminalId }` |
| Runner→前端 | terminal | output | `{ terminalId, data }` |
| Runner→前端 | terminal | exit | `{ terminalId, code }` |

**改动点**：

1. **`packages/agent-runtime/src/direct-server.ts`**
   - handleDirectMessage 新增 terminal channel 分支，调用 terminalManager 对应方法
   - 需要从外部注入 terminalManager 引用

2. **`packages/agent-runtime/src/index.ts`**
   - TerminalManager onOutput/onExit 回调中增加直连广播路径
   - 优先通过 DirectServer broadcastToAll 发送，同时保留 sendToServer 路径（Server relay 客户端也需要收到）

3. **`packages/web/src/hooks/useDirectConnection.ts`**
   - onMessage 中新增 terminal channel 处理
   - 维护 terminalOutputCallbacks / terminalExitCallbacks Map
   - 暴露 onTerminalOutput / onTerminalExit / offTerminal 注册方法

4. **`packages/web/src/pages/chat/TerminalPanel.tsx`**
   - 直连可用时，用 useDirectConnection 暴露的回调注册方法替代 ws.ts 的 onTerminalOutput/onTerminalExit
   - 直连不可用时 fallback 到 ws.ts 回调（保持现有逻辑）

### 4. 风险与边界
- 风险：直连断开瞬间可能丢失终端输出 → 可接受，用户重开终端即可
- Tunnel 路径无需特殊处理，DirectMessage 透传自动兼容
- 不影响 Server relay 终端的现有功能
