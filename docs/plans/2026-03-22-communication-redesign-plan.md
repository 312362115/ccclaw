# 通信架构重设计 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重设计 Web ↔ Runner 通信架构——直连作为主路径（去 ECDH，纯 JSON），Server tunnel 作为透明回退，前端统一一套消息处理逻辑，让聊天完整跑通。

**Architecture:** Runner DirectServer 简化为纯 JSON WebSocket（JWT 认证，可选 TLS）。前端 UnifiedChannel 封装连接管理（DIRECT → TUNNEL 回退），对外暴露统一的 send/onMessage 接口。Server tunnel 改为 JSON 文本级代理。所有聊天事件由 Runner 携带 sessionId，前端不再自行推断。

**Tech Stack:** Node.js 22 + TypeScript + vitest + ws + Hono + Zustand

**Spec:** `docs/specs/2026-03-22-communication-architecture-redesign.md`

---

## Phase 1：修复直连路径，让聊天跑通

### Task 1: DirectServer 去 ECDH，改为纯 JSON + JWT 认证

**Files:**
- Modify: `packages/agent-runtime/src/direct-server.ts` (264 行，大改)
- Modify: `packages/agent-runtime/src/direct-server.test.ts` (160 行，重写)

- [ ] **Step 1: 写 DirectServer 简化版的测试**

```typescript
// packages/agent-runtime/src/direct-server.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectServer } from './direct-server.js';
import WebSocket from 'ws';

describe('DirectServer (simplified)', () => {
  let server: DirectServer;
  const TEST_PORT = 19876;

  afterEach(async () => {
    server?.stop();
  });

  it('should reject connection without token', async () => {
    server = new DirectServer({
      host: '127.0.0.1',
      port: TEST_PORT,
      verifyToken: async () => true,
      onMessage: vi.fn(),
    });
    await server.start();

    // Connect without token query param
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const closed = new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(-1));
    });
    // Should be rejected (no ?token=)
    const code = await closed;
    expect(code).not.toBe(1000);
  });

  it('should accept connection with valid token and exchange JSON', async () => {
    const onMessage = vi.fn();
    server = new DirectServer({
      host: '127.0.0.1',
      port: TEST_PORT,
      verifyToken: async (token) => token === 'valid-jwt',
      onMessage,
    });
    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=valid-jwt`);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Send a JSON DirectMessage
    ws.send(JSON.stringify({ channel: 'system', action: 'ping', data: {} }));

    // Wait for message processing
    await new Promise((r) => setTimeout(r, 100));
    expect(onMessage).toHaveBeenCalledWith(
      expect.any(String), // clientId
      expect.objectContaining({ channel: 'system', action: 'ping' }),
    );
    ws.close();
  });

  it('should sendToClient as JSON text', async () => {
    const onMessage = vi.fn();
    server = new DirectServer({
      host: '127.0.0.1',
      port: TEST_PORT,
      verifyToken: async () => true,
      onMessage,
    });
    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=t`);
    const received = new Promise<any>((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });
    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Get clientId from onMessage by sending a message first
    ws.send(JSON.stringify({ channel: 'system', action: 'ping', data: {} }));
    await new Promise((r) => setTimeout(r, 50));
    const clientId = onMessage.mock.calls[0][0];

    // Send message to client
    server.sendToClient(clientId, { channel: 'system', action: 'pong', data: {} });
    const msg = await received;
    expect(msg.channel).toBe('system');
    expect(msg.action).toBe('pong');
    ws.close();
  });

  it('should handle tunnel clients (JSON text relay)', async () => {
    const onMessage = vi.fn();
    server = new DirectServer({
      host: '127.0.0.1',
      port: TEST_PORT,
      verifyToken: async () => true,
      onMessage,
    });
    await server.start();

    let tunnelSentData: any = null;
    server.setTunnelSend((clientId, data) => {
      tunnelSentData = { clientId, data };
    });

    // Simulate tunnel frame from Server (JSON string, not base64 binary)
    const tunnelClientId = 'tunnel-abc';
    server.handleTunnelFrame(tunnelClientId, JSON.stringify({
      channel: 'tree', action: 'list', data: { path: '/', depth: 1 },
    }));

    await new Promise((r) => setTimeout(r, 50));
    expect(onMessage).toHaveBeenCalledWith(
      tunnelClientId,
      expect.objectContaining({ channel: 'tree', action: 'list' }),
    );

    // Send response to tunnel client
    server.sendToClient(tunnelClientId, { channel: 'tree', action: 'snapshot', data: {} });
    expect(tunnelSentData).not.toBeNull();
    expect(tunnelSentData.clientId).toBe(tunnelClientId);
    // data should be JSON string (not base64 binary)
    const parsed = JSON.parse(tunnelSentData.data);
    expect(parsed.channel).toBe('tree');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @ccclaw/agent-runtime exec vitest run src/direct-server.test.ts`
Expected: FAIL（当前 DirectServer 需要 ECDH 握手才能收发消息）

- [ ] **Step 3: 重写 DirectServer 实现**

```typescript
// packages/agent-runtime/src/direct-server.ts
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from '@ccclaw/shared';
import type { DirectMessage } from '@ccclaw/shared';

export interface DirectServerOptions {
  host?: string;
  port: number;
  tls?: { cert: string; key: string };  // 云端 Docker 场景启用 TLS
  verifyToken: (token: string) => Promise<boolean>;
  onMessage: (clientId: string, msg: DirectMessage) => void;
}

interface ClientSession {
  ws: WebSocket | null;  // null = tunnel client
  clientId: string;
}

export class DirectServer {
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ClientSession>();
  private tunnelSend: ((clientId: string, data: string) => void) | null = null;

  private readonly host: string;
  private readonly port: number;
  private readonly tls?: { cert: string; key: string };
  private readonly verifyToken: (token: string) => Promise<boolean>;
  private readonly onMessage: (clientId: string, msg: DirectMessage) => void;

  constructor(options: DirectServerOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port;
    this.tls = options.tls;
    this.verifyToken = options.verifyToken;
    this.onMessage = options.onMessage;
  }

  async start(): Promise<void> {
    if (this.tls) {
      // 云端 Docker 场景：启用 TLS (wss://)
      const { createServer: createHttpsServer } = await import('node:https');
      this.httpServer = createHttpsServer(
        { cert: this.tls.cert, key: this.tls.key },
        (_, res) => { res.writeHead(404); res.end(); },
      );
    } else {
      this.httpServer = createServer((_, res) => {
        res.writeHead(404);
        res.end();
      });
    }

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', async (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const valid = await this.verifyToken(token);
        if (!valid) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws);
      });
    });

    return new Promise((resolve) => {
      this.httpServer!.listen(this.port, this.host, () => resolve());
    });
  }

  stop(): void {
    for (const [, session] of this.clients) {
      session.ws?.close(1000, 'server shutdown');
    }
    this.clients.clear();
    this.wss?.close();
    this.httpServer?.close();
  }

  getPort(): number {
    const addr = this.httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.port;
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = `direct-${nanoid()}`;
    this.clients.set(clientId, { ws, clientId });

    ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(text) as DirectMessage;
        if (msg.channel && msg.action !== undefined) {
          this.onMessage(clientId, msg);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });
  }

  sendToClient(clientId: string, msg: DirectMessage): void {
    const session = this.clients.get(clientId);
    if (!session) return;

    const json = JSON.stringify(msg);

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Direct WebSocket client
      session.ws.send(json);
    } else if (!session.ws && this.tunnelSend) {
      // Tunnel client — send JSON string via tunnel callback
      this.tunnelSend(clientId, json);
    }
  }

  broadcastToAll(msg: DirectMessage): void {
    const json = JSON.stringify(msg);
    for (const [, session] of this.clients) {
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(json);
      } else if (!session.ws && this.tunnelSend) {
        this.tunnelSend(session.clientId, json);
      }
    }
  }

  // --- Tunnel support ---

  setTunnelSend(send: (clientId: string, data: string) => void): void {
    this.tunnelSend = send;
  }

  handleTunnelFrame(clientId: string, data: string): void {
    if (!data) {
      // Empty data = tunnel disconnect
      this.clients.delete(clientId);
      return;
    }

    // Register tunnel client if not exists
    if (!this.clients.has(clientId)) {
      this.clients.set(clientId, { ws: null, clientId });
    }

    try {
      const msg = JSON.parse(data) as DirectMessage;
      if (msg.channel && msg.action !== undefined) {
        this.onMessage(clientId, msg);
      }
    } catch {
      // ignore malformed tunnel frames
    }
  }

  removeTunnelClient(clientId: string): void {
    const session = this.clients.get(clientId);
    if (session && !session.ws) {
      this.clients.delete(clientId);
    }
  }

}
// 注意：移除了 setMessageHandler，onMessage 通过构造函数注入，不可运行时替换
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @ccclaw/agent-runtime exec vitest run src/direct-server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/direct-server.ts packages/agent-runtime/src/direct-server.test.ts
git commit -m "refactor(agent-runtime): 简化 DirectServer，去 ECDH，改为纯 JSON + JWT 认证"
```

---

### Task 2: Runner index.ts 适配——去 ECDH 引用，chat 事件带 sessionId

**Files:**
- Modify: `packages/agent-runtime/src/index.ts` (574 行)

- [ ] **Step 1: 移除 ECDH 相关的 import 和注册逻辑**

在 `index.ts` 中：
- 移除 `generateECDHKeyPair`, `deriveSharedKey`, `publicKeyFromBase64`, `encrypt`, `decrypt`, `encryptFrame`, `decryptFrame` 等 import
- 移除 `const ecdh = generateECDHKeyPair()` 和注册消息中的 `publicKey` 字段
- `DirectServer` 构造不再传 `keyPair`
- Server 连接时的 `register` 消息改为 `{ type: 'register', directUrl }` （去掉 `publicKey`）
- `applyConfig` 中去掉 ECDH 解密逻辑，只处理明文 `config.data`

- [ ] **Step 2: 修改 handleDirectMessage 中 chat 回调，事件 data 加 sessionId**

当前代码（约 line 254-261）：
```typescript
const onStream = (event: AgentResponse) => {
  directServer?.sendToClient(clientId, {
    channel: 'chat',
    action: event.type,
    requestId,
    data: event,
  });
};
```

改为：
```typescript
const onStream = (event: AgentResponse) => {
  directServer?.sendToClient(clientId, {
    channel: 'chat',
    action: event.type,
    requestId,
    data: { ...event, sessionId: d.sessionId },
  });
};
```

- [ ] **Step 3: 修改 tunnel 帧处理，从 base64 binary 改为 JSON 文本**

当前的 `handleServerMessage` 中 `tunnel_frame` 处理：
```typescript
if (msg.type === 'tunnel_frame') {
  directServer?.handleTunnelFrame(msg.clientId, msg.data);
  return;
}
```

这部分不需要改——`msg.data` 现在就是 JSON 字符串而不是 base64 binary，因为 Server 侧会在 Phase 2 同步改。但为了 Phase 1 先让直连跑通，tunnel 可以暂时不工作。

- [ ] **Step 4: 修改 config 处理，去掉加密 config 的解密分支**

当前 `applyConfig` 处理加密配置的逻辑（`msg.encrypted` + `msg.serverPublicKey`），改为只处理明文：
```typescript
// 之前：有 encrypted/plaintext 两个分支
// 之后：只处理明文
if (msg.type === 'config' && msg.data) {
  applyConfig(msg.data);
}
```

- [ ] **Step 5: 验证 Runner 能正常启动**

Run: `pnpm --filter @ccclaw/agent-runtime exec tsx src/index.ts --mode runner 2>&1 | head -20`
Expected: 启动不报错（可能因为没有 Server 连不上，但不应有 import/type 错误）

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime/src/index.ts
git commit -m "refactor(agent-runtime): index.ts 去 ECDH，chat 事件带 sessionId"
```

---

### Task 3: Server 侧 — config 推送去加密，runner register 去 publicKey

**Files:**
- Modify: `packages/server/src/core/runner-manager.ts` (~430 行)
- Modify: `packages/server/src/channel/webui.ts` (~332 行，runner register 部分)

- [ ] **Step 1: RunnerManager.sendConfig 改为明文发送**

当前代码（约 line 291-312）有加密/明文两个分支，简化为只发明文：
```typescript
sendConfig(workspaceSlug: string, runtimeConfig: RuntimeConfig) {
  const runnerId = this.bindings.get(workspaceSlug);
  if (!runnerId) return;
  const runner = this.runners.get(runnerId);
  if (!runner || runner.ws.readyState !== WebSocket.OPEN) return;

  runner.ws.send(JSON.stringify({ type: 'config', data: runtimeConfig }));
  logger.info({ runnerId, providerType: runtimeConfig.providerType, model: runtimeConfig.model }, 'Config pushed to runner');
}
```

移除 `RunnerInfo` 中的 `publicKey` 字段和 `generateECDHKeyPair` 相关 import。

- [ ] **Step 2: Runner register 处理去掉 publicKey**

在 `webui.ts` 的 runner WebSocket handler 中，`msg.type === 'register'` 的处理：
- 不再读取 `msg.publicKey`
- 不再调用 `runnerManager.updateRunnerInfo(runnerId, msg.publicKey, msg.directUrl)`
- 改为 `runnerManager.updateRunnerInfo(runnerId, undefined, msg.directUrl)`（只更新 directUrl）

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/core/runner-manager.ts packages/server/src/channel/webui.ts
git commit -m "refactor(server): config 推送和 runner 注册去 ECDH"
```

---

### Task 4: 前端 — 简化 DirectWsClient，去 ECDH 加密

**Files:**
- Rewrite: `packages/web/src/api/direct-ws.ts` (456 行 → ~200 行)

- [ ] **Step 1: 重写 DirectWsClient 为纯 JSON WebSocket 客户端**

```typescript
// packages/web/src/api/direct-ws.ts
import { api, getAccessToken, ApiError } from './client';

export type ConnectionState = 'INIT' | 'CONNECTING' | 'DIRECT' | 'TUNNEL' | 'RELAY' | 'DISCONNECTED';

interface DirectWsClientOptions {
  workspaceId: string;
  onStateChange: (state: ConnectionState) => void;
  onMessage: (msg: any) => void;
}

interface RunnerInfo {
  directUrl: string;
  fallback: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 15000;
const PING_MISS_LIMIT = 3;
const RECONNECT_INTERVAL_MS = 30000;

export class DirectWsClient {
  private state: ConnectionState = 'INIT';
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly workspaceId: string;
  private readonly onStateChange: (state: ConnectionState) => void;
  private readonly onMessage: (msg: any) => void;

  constructor(options: DirectWsClientOptions) {
    this.workspaceId = options.workspaceId;
    this.onStateChange = options.onStateChange;
    this.onMessage = options.onMessage;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    this.cleanup();
    this.setState('CONNECTING');

    // 1. Try direct connection to Runner
    let info: RunnerInfo;
    try {
      info = await api<RunnerInfo>('/workspaces/' + this.workspaceId + '/runner-info');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        console.warn('[DirectWs] Runner not online (404), falling back to RELAY');
      } else {
        console.warn('[DirectWs] Failed to fetch runner-info, falling back to RELAY', err);
      }
      this.fallbackToRelay();
      return;
    }

    try {
      await this.tryDirect(info.directUrl);
    } catch {
      console.warn('[DirectWs] Direct connection failed, trying tunnel');
      try {
        await this.tryTunnel();
      } catch {
        console.warn('[DirectWs] Tunnel also failed, falling back to RELAY');
        this.fallbackToRelay();
      }
    }
  }

  private tryDirect(directUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getAccessToken();
      const ws = new WebSocket(directUrl + '?token=' + token);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Direct connection timeout'));
      }, HANDSHAKE_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.setState('DIRECT');
        this.startPing();
        resolve();
      };

      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
          if (msg.channel === 'system' && msg.action === 'pong') {
            this.missedPings = 0;
            return;
          }
          this.onMessage(msg);
        } catch (err) {
          console.error('[DirectWs] Message parse error', err);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        this.stopPing();
        if (!this.disposed && this.state === 'DIRECT') {
          this.scheduleReconnect();
        }
      };
    });
  }

  private tryTunnel(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getAccessToken();
      const serverUrl = new URL(window.location.origin);
      const protocol = serverUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const tunnelUrl = `${protocol}//${serverUrl.host}/ws/tunnel?token=${token}&workspaceId=${this.workspaceId}`;

      const ws = new WebSocket(tunnelUrl);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Tunnel connection timeout'));
      }, HANDSHAKE_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.setState('TUNNEL');
        this.startPing();
        resolve();
      };

      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
          if (msg.channel === 'system' && msg.action === 'pong') {
            this.missedPings = 0;
            return;
          }
          this.onMessage(msg);
        } catch (err) {
          console.error('[DirectWs] Tunnel message parse error', err);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Tunnel WebSocket error'));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        this.stopPing();
        if (!this.disposed && this.state === 'TUNNEL') {
          this.scheduleReconnect();
        }
      };
    });
  }

  async send(msg: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.disposed = true;
    this.cleanup();
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.onStateChange(s);
  }

  private fallbackToRelay(): void {
    this.setState('RELAY');
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private startPing(): void {
    this.missedPings = 0;
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ channel: 'system', action: 'ping', data: {} }));
        this.missedPings++;
        if (this.missedPings >= PING_MISS_LIMIT) {
          console.warn('[DirectWs] Too many missed pongs, closing');
          this.ws.close();
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState('DISCONNECTED');
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, RECONNECT_INTERVAL_MS);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/api/direct-ws.ts
git commit -m "refactor(web): DirectWsClient 去 ECDH，改为纯 JSON WebSocket"
```

---

### Task 5: 前端 — 统一消息处理，合并 useDirectConnection + initWsListener

**Files:**
- Rewrite: `packages/web/src/hooks/useDirectConnection.ts` (201 行)
- Modify: `packages/web/src/stores/chat.ts` (618 行)
- Modify: `packages/web/src/pages/chat/ChatPage.tsx` (125 行)

- [ ] **Step 1: 重写 useDirectConnection — 统一聊天消息处理**

关键变更：chat 事件从 `msg.data.sessionId` 取 sessionId，不再依赖 `chatStore.currentSessionId`。

```typescript
// packages/web/src/hooks/useDirectConnection.ts
import { useEffect, useRef, useCallback } from 'react';
import { DirectWsClient } from '../api/direct-ws';
import { useFileTreeStore } from '../stores/file-tree';
import { useChatStore } from '../stores/chat';

export function useDirectConnection(workspaceId: string | null) {
  const clientRef = useRef<DirectWsClient | null>(null);
  const store = useFileTreeStore;

  useEffect(() => {
    if (!workspaceId) return;

    const client = new DirectWsClient({
      workspaceId,
      onStateChange: (state) => {
        console.log('[DirectConnection] 状态变更:', state);
        store.getState().setConnectionState(state);

        if (state === 'DIRECT' || state === 'TUNNEL') {
          useChatStore.getState().setDirectSend((msg: unknown) => {
            client.send(msg).catch((err: unknown) => {
              console.error('[DirectConnection] Failed to send via direct channel', err);
            });
          });
        } else {
          useChatStore.getState().setDirectSend(null);
        }
      },
      onMessage: (msg) => {
        const s = store.getState();

        // ── Tree events ──
        if (msg.channel === 'tree') {
          if (msg.action === 'snapshot') {
            if (msg.data.path === '/') {
              s.setEntries(msg.data.entries, msg.data.truncated);
            } else {
              s.mergeSubtree(msg.data.path, msg.data.entries);
            }
          } else if (msg.action === 'event') {
            s.applyEvents(msg.data.events);
          }
        }

        // ── File events ──
        else if (msg.channel === 'file') {
          if (msg.action === 'read_result') {
            s.setPreview(msg.data.path, msg.data.content, msg.data.binary);
          }
        }

        // ── Chat events（统一处理，sessionId 从 event data 中取）──
        else if (msg.channel === 'chat') {
          handleChatEvent(msg);
        }
      },
    });

    clientRef.current = client;

    client
      .connect()
      .then(() => {
        client.send({
          channel: 'tree',
          action: 'list',
          requestId: 'init-' + Date.now(),
          data: { path: '/', depth: 2 },
        });
      })
      .catch(() => {});

    return () => {
      client.disconnect();
      clientRef.current = null;
      useChatStore.getState().setDirectSend(null);
    };
  }, [workspaceId]);

  const sendDirectMessage = useCallback((msg: any) => {
    clientRef.current?.send(msg);
  }, []);

  return { sendDirectMessage };
}

/**
 * 统一聊天事件处理器
 * sessionId 从每条事件的 data 中取（Runner 保证携带），不依赖前端 state
 */
function handleChatEvent(msg: { action: string; data: Record<string, unknown> }) {
  const chatStore = useChatStore.getState();
  const event = msg.data;
  const sessionId = (event.sessionId as string) || '';

  if (!sessionId) {
    console.warn('[Chat] 收到无 sessionId 的事件:', msg.action, event);
    return;
  }

  switch (msg.action) {
    case 'text_delta': {
      const text = (event.delta as string) || (event.content as string) || '';
      const newBufferMap = new Map(chatStore.streamBufferMap);
      newBufferMap.set(sessionId, (newBufferMap.get(sessionId) ?? '') + text);
      useChatStore.setState({ streamBufferMap: newBufferMap });
      break;
    }

    case 'tool_use_start': {
      const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
      const name = (event.name as string) || '';
      chatStore.onToolUseStart(sessionId, toolId, name);
      break;
    }

    case 'tool_use_delta': {
      const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
      const delta = (event.delta as string) || '';
      chatStore.onToolUseDelta(sessionId, toolId, delta);
      break;
    }

    case 'tool_use_end': {
      const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
      chatStore.onToolUseEnd(sessionId, toolId);
      break;
    }

    case 'tool_result': {
      const toolId = (event.toolCallId as string) || (event.toolId as string) || '';
      const output = (event.output as string) || '';
      chatStore.onToolResult(sessionId, toolId, output);
      break;
    }

    case 'thinking_delta': {
      const content = (event.delta as string) || (event.content as string) || '';
      chatStore.onThinkingDelta(sessionId, content);
      break;
    }

    case 'consolidation': {
      const summary = (event.summary as string) || (event.message as string) || '';
      chatStore.onConsolidation(sessionId, summary);
      break;
    }

    case 'plan_mode': {
      chatStore.onPlanMode(sessionId, (event.active as boolean) ?? false);
      break;
    }

    case 'subagent_started': {
      const label = (event.goal as string) || (event.subagentId as string) || '';
      chatStore.onConsolidation(sessionId, `[子 Agent 启动] ${label}`);
      break;
    }

    case 'subagent_result': {
      const subId = (event.subagentId as string) || '';
      const result = (event.result as string) || '';
      chatStore.onConsolidation(sessionId, `[子 Agent 完成] ${subId}: ${result}`);
      break;
    }

    case 'session_done':
    case 'done': {
      const usage = event.usage as { inputTokens: number; outputTokens: number } | undefined;
      const tokens = usage ?? { inputTokens: 0, outputTokens: 0 };
      chatStore.onSessionDone(sessionId, tokens);
      break;
    }

    case 'confirm_request': {
      const requestId = (event.confirmId as string) || (event.requestId as string) || '';
      const toolName = (event.toolName as string) || (event.tool as string) || (event.name as string) || '';
      const input = event.input;
      const reason = (event.reason as string) || '';
      chatStore.onConfirmRequest(sessionId, requestId, toolName, input, reason);
      break;
    }

    case 'error': {
      const errorMsg = (event.message as string) || '未知错误';
      const s = useChatStore.getState();
      const newErrorMap = new Map(s.streamErrorMap);
      newErrorMap.set(sessionId, errorMsg);
      const newStreamingMap = new Map(s.streamingMap);
      newStreamingMap.set(sessionId, false);
      const newBufferMap = new Map(s.streamBufferMap);
      newBufferMap.set(sessionId, '');
      useChatStore.setState({ streamErrorMap: newErrorMap, streamingMap: newStreamingMap, streamBufferMap: newBufferMap });
      break;
    }

    default:
      break;
  }
}
```

- [ ] **Step 2: 修改 chat.ts — 移除 initWsListener 中的聊天处理（保留 WS 连接用于认证）**

`initWsListener` 的聊天事件处理已经迁移到 `handleChatEvent`。将 `initWsListener` 简化为只保留必要的 WS 管理逻辑。

在 `chat.ts` 中，`sendWithImages` 方法保持不变（已有 directSend vs relay 分支逻辑）。

但 `initWsListener` 仍需保留作为 relay 路径的回退。当 `directSend` 为 null（RELAY 模式）时，消息通过 Server WS 发送，回复也通过 Server WS 回来，这时 `initWsListener` 仍需处理。

**所以 initWsListener 暂不删除**，但要确保它和 handleChatEvent 不会重复处理同一条消息：
- DIRECT/TUNNEL 模式：消息通过 directSend 发送 → 回复通过 DirectWsClient.onMessage → handleChatEvent 处理 → initWsListener 不会收到这些消息（它们不走 Server WS）
- RELAY 模式：消息通过 sendMessage 发送 → 回复通过 Server WS → initWsListener 处理

两条路径天然互斥，不会重复。**不需要改 initWsListener**。

- [ ] **Step 3: 修改 ChatPage.tsx — 清理调试日志，确认 setStoreSession 已添加**

确认之前的 `setStoreSession` 修复已包含。移除之前添加的临时调试 `console.log`。

```typescript
// ChatPage.tsx 关键部分（确认状态）
const setStoreSession = useChatStore((s) => s.setCurrentSession);

// 在所有 setCurrentSessionId 调用处，紧跟 setStoreSession
setCurrentSessionId(sid);
setStoreSession(sid);
```

- [ ] **Step 4: 移除临时调试日志**

清理之前在 `chat.ts`、`direct-ws.ts`、`useDirectConnection.ts` 中添加的 `console.log` 调试语句。保留 `console.warn` 和 `console.error` 级别的日志。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useDirectConnection.ts packages/web/src/stores/chat.ts packages/web/src/pages/chat/ChatPage.tsx packages/web/src/api/direct-ws.ts
git commit -m "refactor(web): 统一聊天消息处理，sessionId 从事件中取"
```

---

### Task 5b: 前端 handleChatEvent 单元测试

**Files:**
- Create: `packages/web/src/hooks/__tests__/handleChatEvent.test.ts`

- [ ] **Step 1: 写 handleChatEvent 单元测试**

```typescript
// packages/web/src/hooks/__tests__/handleChatEvent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore } from '../../stores/chat';

// 从 useDirectConnection 中导出 handleChatEvent 供测试
// （需要在 useDirectConnection.ts 中 export 这个函数）
import { handleChatEvent } from '../useDirectConnection';

describe('handleChatEvent', () => {
  beforeEach(() => {
    // 重置 store
    useChatStore.setState({
      messages: new Map(),
      streamingMap: new Map(),
      streamBufferMap: new Map(),
      streamErrorMap: new Map(),
    });
  });

  it('should extract sessionId from event data, not from store', () => {
    // 即使 store 的 currentSessionId 为 null，也能正确路由
    useChatStore.setState({ currentSessionId: null });

    handleChatEvent({
      action: 'text_delta',
      data: { type: 'text_delta', sessionId: 'session-abc', delta: 'hello' },
    });

    const buffer = useChatStore.getState().streamBufferMap.get('session-abc');
    expect(buffer).toBe('hello');
  });

  it('should drop events without sessionId', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    handleChatEvent({
      action: 'text_delta',
      data: { type: 'text_delta', delta: 'hello' },  // no sessionId
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('无 sessionId'),
      expect.anything(),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('should handle session_done correctly', () => {
    // 先模拟 streaming 状态
    const streamingMap = new Map([['s1', true]]);
    const bufferMap = new Map([['s1', 'some text']]);
    useChatStore.setState({ streamingMap, streamBufferMap: bufferMap });

    handleChatEvent({
      action: 'session_done',
      data: { type: 'session_done', sessionId: 's1', usage: { inputTokens: 10, outputTokens: 5 } },
    });

    expect(useChatStore.getState().streamingMap.get('s1')).toBe(false);
  });

  it('should handle error events', () => {
    handleChatEvent({
      action: 'error',
      data: { type: 'error', sessionId: 's1', message: 'API key invalid' },
    });

    expect(useChatStore.getState().streamErrorMap.get('s1')).toBe('API key invalid');
    expect(useChatStore.getState().streamingMap.get('s1')).toBe(false);
  });
});
```

- [ ] **Step 2: 在 useDirectConnection.ts 中 export handleChatEvent**

在文件底部添加 `export { handleChatEvent };` 使其可被测试导入。

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm --filter @ccclaw/web exec vitest run src/hooks/__tests__/handleChatEvent.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/__tests__/handleChatEvent.test.ts packages/web/src/hooks/useDirectConnection.ts
git commit -m "test(web): handleChatEvent 单元测试，验证 sessionId 从事件取"
```

---

### Task 6: 端到端验证 — 本地直连聊天

- [ ] **Step 1: 启动 Server**

Run: `pnpm dev`

- [ ] **Step 2: 启动 Web**

Run: `pnpm --filter @ccclaw/web dev`

- [ ] **Step 3: 确认 Runner 已启动并连接到 Server**

检查 Server 终端日志，应看到：
```
Runner registered (runnerId=xxx, startMode=local)
Runner info updated (directUrl=ws://127.0.0.1:XXXXX)
```

- [ ] **Step 4: 打开浏览器，发送聊天消息**

打开 DevTools Console，观察：
1. `[DirectConnection] 状态变更: DIRECT` — 直连成功
2. 发送消息后应看到 `text_delta`、`tool_use_*`、`session_done` 等事件
3. 聊天界面显示完整回复

- [ ] **Step 5: 测试错误场景**

- 关闭 Runner 进程，观察前端是否显示连接断开
- 配置无效的 API Key，观察是否显示错误消息

---

## Phase 2：Server Tunnel 透明代理

### Task 7: Server tunnel 改为 JSON 文本代理

**Files:**
- Modify: `packages/server/src/channel/webui.ts` (tunnel handler 部分，约 line 109-164)

- [ ] **Step 1: 修改 tunnel handler — binary base64 改为 JSON text**

当前逻辑：
```typescript
// Client → Runner: binary → base64
ws.on('message', (raw) => {
  const data = Buffer.from(raw as Buffer).toString('base64');
  runnerManager.sendToRunner(slug, { type: 'tunnel_frame', clientId, data });
});
```

改为：
```typescript
// Client → Runner: JSON text 直接转发
ws.on('message', (raw) => {
  const text = typeof raw === 'string' ? raw : raw.toString();
  runnerManager.sendToRunner(slug, { type: 'tunnel_frame', clientId, data: text });
});
```

Runner → Client 的回复同理：
```typescript
// 当前：base64 binary
// 改为：JSON text
runnerManager.setTunnelCallback(runnerId, (msg) => {
  const clientWs = tunnelClients.get(msg.clientId);
  if (clientWs && clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(msg.data); // msg.data 已经是 JSON string
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/channel/webui.ts
git commit -m "refactor(server): tunnel 改为 JSON 文本代理，去 base64 binary"
```

---

### Task 8: 端到端验证 — Tunnel 回退路径

- [ ] **Step 1: 模拟直连不可用**

临时把 runner-info API 返回一个不可达的 directUrl（或直接返回 404），迫使前端走 tunnel。

- [ ] **Step 2: 发送聊天消息，确认通过 tunnel 正常收发**

DevTools Console 应显示 `[DirectConnection] 状态变更: TUNNEL`，聊天功能正常。

- [ ] **Step 3: 恢复正常配置，确认直连优先**

---

## Phase 3：清理废弃代码

### Task 9: 清理 ECDH 和废弃的 shared 加密工具

**Files:**
- Modify: `packages/shared/src/index.ts` — 移除 ECDH/encrypt/decrypt 相关 export
- Modify: `packages/shared/src/crypto.ts` (或类似文件) — 如果只有 ECDH 相关代码则整个删除；如果有其他工具则保留其他部分
- Modify: `packages/server/src/core/runner-manager.ts` — 移除 `generateECDHKeyPair`, `deriveSharedKey`, `publicKeyFromBase64`, `encrypt` 的 import

- [ ] **Step 1: 确认 ECDH 相关函数无其他使用者**

Run: `grep -r "generateECDHKeyPair\|deriveSharedKey\|encryptFrame\|decryptFrame\|publicKeyFromBase64" packages/ --include="*.ts" -l`

确认只有已修改的文件引用这些函数。

- [ ] **Step 2: 清理 import 和 export**

逐一移除不再使用的加密函数。

- [ ] **Step 3: 运行全量测试**

Run: `pnpm -r exec vitest run 2>&1 | tail -20`
Expected: 所有测试通过（或只有预期中的已有失败）

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: 清理废弃的 ECDH 加密代码"
```

---

### Task 10: 清理 Server RELAY 路径的聊天中转

**Files:**
- Modify: `packages/server/src/core/agent-manager.ts` — 移除 `chat()` 方法和 `handleInboundMessage` 中的聊天处理
- Modify: `packages/server/src/channel/webui.ts` — 移除 `/ws` handler 中的 `user_message` publishInbound

**注意**：只有在 Phase 2 验证 tunnel 可靠工作后才执行此步骤。RELAY 路径作为最终兜底，确认 tunnel 可靠后再移除。

- [ ] **Step 1: 评估是否真的要移除 RELAY 聊天路径**

如果 tunnel 已验证可靠，RELAY 路径对聊天来说是多余的。但如果 tunnel 有问题，保留 RELAY 作为兜底是安全的。

决策点：与用户确认后再执行。

- [ ] **Step 2: 如确认移除，清理 agent-manager.ts 的 chat/handleInboundMessage**

- [ ] **Step 3: 清理 webui.ts 中 /ws handler 的聊天消息发布**

- [ ] **Step 4: 运行全量测试并验证**

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(server): 移除 RELAY 聊天中转路径，统一走 direct/tunnel"
```

---

### Task 11: 清理前端 ws.ts 聊天相关代码 + shared 协议类型

**Files:**
- Modify: `packages/web/src/api/ws.ts` — 移除 `sendMessage` 等聊天发送函数（保留 `connectWs`、认证、终端相关）
- Modify: `packages/shared/src/agent-protocol.ts` — 清理 `RunnerMessage`/`ServerMessage` 中不再使用的聊天相关变体
- Modify: `packages/web/src/stores/chat.ts` — 移除 `initWsListener` 中的聊天事件处理（如已确认 RELAY 聊天路径移除）

- [ ] **Step 1: 清理 `ws.ts` 中的 `sendMessage`、`sendConfirmResponse`**

保留：`connectWs`、`disconnectWs`、`onWsMessage`（终端等仍需要）、终端相关函数。
移除：`sendMessage`、`sendConfirmResponse`（聊天消息现在都走 directSend）。

- [ ] **Step 2: 清理 `agent-protocol.ts` 中废弃的类型**

`RunnerMessage` 中 `response` 类型不再需要（聊天走直连不经 Server 中转）。
`ServerMessage` 中 `request` 类型不再需要（同理）。
保留：`config`、`registered`、`pong`、`terminal_*`、`tunnel_frame`。

- [ ] **Step 3: 运行全量测试**

Run: `pnpm -r exec vitest run 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: 清理 ws.ts 聊天函数和 shared 协议废弃类型"
```
