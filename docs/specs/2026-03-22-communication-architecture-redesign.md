## 技术方案：通信架构重设计

### 1. 背景与目标

**问题**：当前 Web ↔ Runner 的聊天通信不可用。根因是 RELAY（Server 中转）和 DIRECT（直连）两条路径都不完整——RELAY 把所有事件降级为 `text_delta`，DIRECT 的前端状态管理有 bug（`currentSessionId` 未同步到 Zustand store），且 ECDH 加密对 localhost 场景过度设计。

**三种网络拓扑**：

| 场景 | Web | Runner | 网络 | 传输方式 |
|------|-----|--------|------|---------|
| 本地开发（主场景） | 浏览器 | 本地进程 | localhost | `ws://localhost:PORT`，无需加密 |
| 云端 Docker | 浏览器 | Server 旁 Docker 容器 | 公网 | `wss://runner-host:PORT`，**需要 TLS** |
| 外网访问（少见） | 手机/外网 | 内网机器 | NAT 隔离 | Server tunnel 中转 (`wss://server`) |

**目标**：
1. 直连作为主路径，简单可靠，覆盖所有功能（聊天、文件、终端）
2. Server 中转作为透明回退，同一协议、同一处理逻辑
3. 前端只维护一套消息处理代码，不因传输方式不同而分叉
4. 加密作为传输层关注点（TLS），不侵入应用协议

**验收标准**：
- 本地直连：发消息能收到完整回复（文本 + 工具调用 + 思考过程）
- 云端 Docker 直连：同上，且通过 TLS 加密传输
- Server 中转：同样的消息能通过 Server 透明转发到 Runner 并返回
- 连接中断自动切换，用户无感知

**不做**：P2P 打洞、1:N Runner 模型、Runner 自动发现

---

### 2. 现状分析

#### 当前架构

```
Web ─── /ws ──── Server ── RunnerWS ── Runner    (RELAY 路径)
Web ─── direct-ws ──────────────── Runner    (DIRECT 路径)
Web ─── /ws/tunnel ── Server ── tunnel ── Runner  (TUNNEL 路径)
```

**三条路径、三种协议、两套前端处理逻辑**：

| 路径 | 协议 | 前端处理 | 问题 |
|------|------|---------|------|
| RELAY | MessageBus OutboundMessage | `initWsListener()` | `onDelta` 把所有事件转为 `text_delta`，丢失工具/思考事件 |
| DIRECT | DirectMessage (ECDH 加密) | `useDirectConnection.onMessage` | `currentSessionId` 未同步到 store，回复存到了空 session |
| TUNNEL | DirectMessage (ECDH 加密经 Server 转发) | 同 DIRECT | 同 DIRECT，且增加了 Server 中转复杂度 |

#### 涉及的文件

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `packages/shared/src/agent-protocol.ts` | 协议定义 | 扩展 |
| `packages/shared/src/direct-message.ts` | 直连消息协议 | **保留，作为统一协议** |
| `packages/agent-runtime/src/direct-server.ts` | Runner 直连服务 | **简化**，去 ECDH |
| `packages/agent-runtime/src/index.ts` | Runner 入口 | 调整消息路由 |
| `packages/server/src/channel/webui.ts` | Server WS 处理 | **简化**，tunnel 改为透明代理 |
| `packages/server/src/core/agent-manager.ts` | Agent 调度 | 简化回调 |
| `packages/server/src/core/runner-manager.ts` | Runner 管理 | 微调 |
| `packages/web/src/api/direct-ws.ts` | 前端直连客户端 | **大改**，去 ECDH |
| `packages/web/src/hooks/useDirectConnection.ts` | 前端直连 hook | **重写为统一通信层** |
| `packages/web/src/stores/chat.ts` | 聊天状态 | **简化**，去掉双路径处理 |
| `packages/web/src/api/ws.ts` | 前端 relay WS | **可能移除**，统一到通信层 |
| `packages/web/src/pages/chat/ChatPage.tsx` | 聊天页面 | 简化初始化 |

---

### 3. 方案设计

#### 核心思路

**一套协议、一个处理器、透明传输切换。**

```
                   ┌─────────────────────────┐
                   │       Web (Browser)      │
                   │                          │
                   │  UnifiedChannel          │
                   │   ├─ send(msg)           │
                   │   ├─ onMessage(handler)  │
                   │   └─ state: DIRECT|RELAY │
                   └────────┬────────────────┘
                            │
                 ┌──────────┴──────────┐
                 │ 尝试直连             │ 直连失败
                 ▼                     ▼
          ws://localhost:PORT    wss://server/ws/tunnel
          (Runner DirectServer)  (Server 透明代理)
                 │                     │
                 │              ┌──────┴──────┐
                 │              │   Server    │
                 │              │  (透明转发)  │
                 │              └──────┬──────┘
                 │                     │
                 └──────────┬──────────┘
                            ▼
                   ┌────────────────┐
                   │     Runner     │
                   │  DirectServer  │
                   │  (统一入口)     │
                   └────────────────┘
```

#### 3.1 统一协议：DirectMessage

所有通信（直连和中转）使用同一个 `DirectMessage` 协议：

```typescript
interface DirectMessage {
  channel: 'chat' | 'tree' | 'file' | 'terminal' | 'system';
  action: string;
  requestId?: string;
  data: unknown;
}
```

聊天相关的 action：

| action | 方向 | data |
|--------|------|------|
| `message` | Web → Runner | `{ sessionId, message, content? }` |
| `confirm_response` | Web → Runner | `{ requestId, approved }` |
| `cancel` | Web → Runner | `{ sessionId }` |
| `text_delta` | Runner → Web | `{ sessionId, delta }` |
| `thinking_delta` | Runner → Web | `{ sessionId, delta }` |
| `tool_use_start` | Runner → Web | `{ sessionId, toolCallId, name }` |
| `tool_use_delta` | Runner → Web | `{ sessionId, toolCallId, delta }` |
| `tool_use_end` | Runner → Web | `{ sessionId, toolCallId }` |
| `tool_result` | Runner → Web | `{ sessionId, toolCallId, output }` |
| `confirm_request` | Runner → Web | `{ sessionId, requestId, name, input, reason }` |
| `session_done` | Runner → Web | `{ sessionId, usage }` |
| `error` | Runner → Web | `{ sessionId?, message }` |

**关键变更**：Runner 发送的聊天事件**必须包含 `sessionId`**，前端不再依赖自行维护的 `currentSessionId` 去猜。

#### 3.2 Runner DirectServer 简化

**去掉应用层 ECDH 加密，加密下沉到传输层（TLS）**。理由：
- 本地场景（localhost）不需要加密
- 云端 Docker 场景用标准 TLS（wss://）即可，不需要自建加密
- ECDH + AES-GCM + counter 管理是当前 bug 的主要来源，用标准 TLS 替代更安全也更简单

**加密策略**：

| 部署模式 | 协议 | 加密 | 证书 |
|---------|------|------|------|
| 本地进程 | `ws://` | 无（localhost 安全） | 无 |
| Docker（本地映射） | `ws://` | 无（localhost 安全） | 无 |
| Docker（云端公网） | `wss://` | TLS | Server 下发或 Let's Encrypt |

Runner 启动时根据环境变量决定是否启用 TLS：
- `DIRECT_TLS_CERT` + `DIRECT_TLS_KEY` 存在 → 启动 HTTPS + WSS
- 否则 → 启动 HTTP + WS

**认证方式**：JWT token（从 Server 获取，直连时通过 URL query 传递）。

```typescript
// 简化后的 DirectServer
class DirectServer {
  // 启动 WS 服务
  // - 有 TLS 证书 → wss://host:PORT
  // - 无 TLS 证书 → ws://host:PORT
  start(port: number, tls?: { cert: string; key: string }): void;

  // 客户端连接：验证 JWT → 注册 clientId → 开始收发 JSON
  // 无 ECDH 握手，纯 JSON text frames over WebSocket
  onConnection(ws: WebSocket, token: string): void;

  // 发送消息给客户端（直连或 tunnel）
  sendToClient(clientId: string, msg: DirectMessage): void;
}
```

消息收发改为 **纯 JSON text frames**，不再使用 binary encrypted frames。

#### 3.3 Server Tunnel 简化

Server 的 `/ws/tunnel` 改为**JSON 级别的透明代理**：

```
Web ──JSON──▷ Server(/ws/tunnel) ──JSON──▷ Runner
Web ◁──JSON── Server(/ws/tunnel) ◁──JSON── Runner
```

当前实现是 base64 编码的 binary relay，改为直接转发 JSON 文本。Server 不解析消息内容，只做路由（根据 workspaceId 找到 Runner）。

```typescript
// Server tunnel handler (简化)
// Web → Server: JSON DirectMessage
// Server → Runner: { type: 'tunnel_frame', clientId, data: DirectMessage }
// Runner → Server: { type: 'tunnel_frame', clientId, data: DirectMessage }
// Server → Web: JSON DirectMessage
```

**Server 不再需要 MessageBus 处理聊天消息**。MessageBus 的 inbound/outbound 机制可以保留给未来需要 Server 主动处理的场景（如通知、webhook），但聊天流不经过它。

#### 3.4 前端统一通信层

**合并 `ws.ts` + `direct-ws.ts` + `useDirectConnection.ts` 为一个 `UnifiedChannel`**：

```typescript
class UnifiedChannel {
  state: 'CONNECTING' | 'DIRECT' | 'RELAY' | 'DISCONNECTED';

  constructor(options: {
    workspaceId: string;
    serverUrl: string;       // wss://server
    onMessage: (msg: DirectMessage) => void;
    onStateChange: (state) => void;
  });

  async connect(): Promise<void> {
    // 1. 从 Server 获取 runner-info（directUrl）
    // 2. 尝试直连 ws://localhost:PORT?token=xxx
    // 3. 失败 → 回退到 wss://server/ws/tunnel?token=xxx&workspaceId=xxx
    // 4. 都失败 → DISCONNECTED，定期重试
  }

  send(msg: DirectMessage): void {
    // 无论 DIRECT 还是 RELAY，发送同一格式的 JSON
  }

  disconnect(): void;
}
```

**前端消息处理只有一个入口**：

```typescript
// 之前：两个处理器
// initWsListener() — relay 专用，丢失事件类型
// useDirectConnection.onMessage — direct 专用，sessionId 有 bug

// 之后：一个处理器
channel.onMessage = (msg: DirectMessage) => {
  if (msg.channel === 'chat') handleChatEvent(msg);
  if (msg.channel === 'tree') handleTreeEvent(msg);
  if (msg.channel === 'file') handleFileEvent(msg);
};
```

#### 3.5 Chat Store 简化

```typescript
// 之前：从 msg.data 取字段，自行维护 sessionId
const sessionId = chatStore.currentSessionId ?? '';  // bug: 经常是空

// 之后：从 msg.data.sessionId 取，Runner 保证每条消息带 sessionId
function handleChatEvent(msg: DirectMessage) {
  const { sessionId, ...payload } = msg.data;
  switch (msg.action) {
    case 'text_delta': store.appendBuffer(sessionId, payload.delta); break;
    case 'tool_use_start': store.onToolUseStart(sessionId, ...); break;
    case 'session_done': store.onSessionDone(sessionId, ...); break;
    // ... 一套逻辑处理所有事件
  }
}
```

#### 3.6 Server 的 RELAY WebSocket (`/ws`) 处理

原来的 `/ws` 路径承担了聊天消息中转，通过 MessageBus + AgentManager 调度。简化后：

- **保留** `/ws` 用于：认证、工作区/会话管理等 REST-over-WS 操作
- **移除** `/ws` 的聊天消息中转职责（聊天走 DirectMessage 协议，经直连或 tunnel）
- **保留** AgentManager 用于：Runner 启动、配置推送
- **简化** RunnerManager：不再承担 request/response 追踪（那是 direct 通道的事）

---

### 4. 实施计划

分 3 个阶段，每个阶段独立可验证：

#### Phase 1：修复直连路径，让聊天跑通（核心）

**目标**：去掉 ECDH，Runner 聊天事件带 sessionId，前端统一处理。

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1.1 | `agent-runtime/src/direct-server.ts` | 去 ECDH，改为 JWT 认证 + 纯 JSON text frames |
| 1.2 | `agent-runtime/src/index.ts` | `handleDirectMessage` 中聊天回调，事件 data 加 `sessionId` |
| 1.3 | `web/src/api/direct-ws.ts` | 去 ECDH，简化为纯 JSON WebSocket 客户端 |
| 1.4 | `web/src/hooks/useDirectConnection.ts` | 统一 `onMessage` 入口，从 `msg.data.sessionId` 取 session |
| 1.5 | `web/src/stores/chat.ts` | 去掉 `initWsListener` 中的重复处理，统一到一个 handler |
| 1.6 | `web/src/pages/chat/ChatPage.tsx` | 简化初始化，去掉 `initWsListener` |

**验证**：本地启动 Runner + Web，发消息能收到完整回复。

#### Phase 2：Server Tunnel 透明代理

**目标**：当直连不可用时，通过 Server 透明转发 DirectMessage。

| 步骤 | 文件 | 改动 |
|------|------|------|
| 2.1 | `server/src/channel/webui.ts` | `/ws/tunnel` 改为 JSON 文本代理（去 binary/base64） |
| 2.2 | `agent-runtime/src/direct-server.ts` | tunnel 帧改为 JSON 文本 |
| 2.3 | `web/src/api/direct-ws.ts` | 连接回退逻辑：direct 失败 → tunnel |

**验证**：断开直连，消息自动走 Server 中转，功能不变。

#### Phase 3：清理废弃代码

**目标**：删除不再需要的 RELAY 路径代码。

| 步骤 | 文件 | 改动 |
|------|------|------|
| 3.1 | `web/src/api/ws.ts` | 移除聊天相关的 `sendMessage`，保留认证/管理 |
| 3.2 | `server/src/core/agent-manager.ts` | 移除 `chat()` 方法和 MessageBus 聊天监听 |
| 3.3 | `server/src/bus/` | MessageBus 简化，移除聊天相关类型 |
| 3.4 | `shared/src/agent-protocol.ts` | 清理不再使用的 RunnerMessage/ServerMessage 中聊天相关类型 |

**验证**：全量功能回归测试。

---

### 5. 风险与边界

| 风险 | 应对 |
|------|------|
| HTTPS 页面连 `ws://localhost` 被浏览器拦截 | Chrome/Firefox 对 localhost 有豁免；Safari 需测试 |
| 云端 Docker 的 TLS 证书管理 | Server 创建容器时注入证书，或用 Server 域名的通配符证书 |
| JWT token 过期后直连断开 | 直连断开时自动走 tunnel 回退，tunnel 用新 token |
| Runner 未启动时前端卡在连接中 | 设 3 秒超时，超时后提示用户启动 Runner |
| 去掉 ECDH 后 tunnel 路径的安全性 | Server 的 wss:// 提供传输加密，Server 是用户自己信任的服务 |

**明确不做**：
- 不改 Runner 的 Agent 执行逻辑（`agent.ts`、LLM adapters）
- 不改文件树、终端等非聊天功能的直连协议（它们已经工作正常）
- 不改 Server 的认证、工作区管理等功能
