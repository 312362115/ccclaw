# Runner 直连加密 + 目录树同步 + 文件操作 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立前端↔Runner ECDH 加密直连通道，在其上实现 workspace 目录树实时同步和轻量文件管理器（只读预览 + 新建/删除）。

**Architecture:** Runner 启动时生成 ECDH 密钥对并开放直连 WS 端口，前端通过 Web Crypto API 握手建立 AES-256-GCM 加密通道。消息按 `channel:action` 命名空间路由。fs.watch 监听 workspace 目录推送变更事件，前端增量更新目录树。

**Tech Stack:** Node.js 22 + TypeScript + Web Crypto API + ws + vitest + React 19 + Zustand

**Spec:** `docs/superpowers/specs/2026-03-18-direct-connect-filetree-design.md`

---

## File Structure

### packages/shared/src/
- **Create:** `ecdh.ts` — ECDH 密钥生成、共享密钥派生、AES-256-GCM 帧加解密（Node.js crypto）
- **Create:** `ecdh.test.ts` — ECDH 工具测试
- **Create:** `path-validator.ts` — 路径校验工具（resolve + symlink 检查），从 workspace-storage.ts 提取
- **Create:** `path-validator.test.ts` — 路径校验测试
- **Create:** `direct-message.ts` — DirectMessage 类型定义 + channel:action 路由工具
- **Create:** `direct-message.test.ts` — 消息路由测试
- **Modify:** `index.ts` — 新增导出

### packages/agent-runtime/src/
- **Create:** `direct-server.ts` — Runner 直连 WS 服务（端口开放、握手、加密通信、消息路由）
- **Create:** `direct-server.test.ts` — 直连服务测试
- **Create:** `file-watcher.ts` — fs.watch 递归监听 + debounce + 忽略规则 + 事件推送
- **Create:** `file-watcher.test.ts` — 文件监听测试
- **Create:** `handlers/tree-handler.ts` — tree:list/snapshot 处理
- **Create:** `handlers/file-handler.ts` — file:read/create/delete/stat 处理
- **Create:** `handlers/tree-handler.test.ts` — 目录树处理测试
- **Create:** `handlers/file-handler.test.ts` — 文件操作处理测试
- **Modify:** `protocol.ts` — 新增 DirectMessage 相关类型 + 注册公钥字段
- **Modify:** `index.ts` — 启动直连服务 + 注册带公钥 + directUrl 上报

### packages/server/src/
- **Modify:** `core/runner-manager.ts` — 缓存 runner 公钥 + directUrl，加密 config 下发
- **Create:** `api/runner-info.ts` — GET /api/workspaces/:id/runner-info 路由
- **Modify:** `channel/webui.ts` — 注册消息接收公钥 + directUrl
- **Modify:** `core/workspace-storage.ts` — 移除 validatePath/validatePathStrict（已迁移到 shared）

### packages/web/src/
- **Create:** `api/direct-ws.ts` — 直连 WS 客户端（Web Crypto ECDH 握手 + 加密通道 + fallback 状态机）
- **Create:** `stores/file-tree.ts` — 目录树 Zustand store
- **Create:** `components/workspace/FileTree.tsx` — 目录树组件
- **Create:** `components/workspace/FilePreview.tsx` — 文件只读预览组件
- **Create:** `components/workspace/FilePanel.tsx` — 右侧面板（树 + 预览 + 操作栏）

---

## Chunk 1: ECDH 密钥工具 + 路径校验（shared 包）

### Task 1: ECDH 密钥工具

**Files:**
- Create: `packages/shared/src/ecdh.ts`
- Create: `packages/shared/src/ecdh.test.ts`

- [ ] **Step 1: 写测试 — ECDH 密钥生成与共享密钥派生**

```typescript
// packages/shared/src/ecdh.test.ts
import { describe, it, expect } from 'vitest';
import {
  generateECDHKeyPair,
  deriveSharedKey,
  encryptFrame,
  decryptFrame,
} from './ecdh.js';

describe('ECDH', () => {
  it('should generate P-256 key pair', () => {
    const kp = generateECDHKeyPair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
    expect(kp.publicKeyBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('should derive identical shared keys on both sides', () => {
    const alice = generateECDHKeyPair();
    const bob = generateECDHKeyPair();

    const sharedA = deriveSharedKey(alice.privateKey, bob.publicKey);
    const sharedB = deriveSharedKey(bob.privateKey, alice.publicKey);

    expect(sharedA.toString('hex')).toBe(sharedB.toString('hex'));
    expect(sharedA.length).toBe(32); // 256 bits
  });

  it('should encrypt and decrypt frame', () => {
    const alice = generateECDHKeyPair();
    const bob = generateECDHKeyPair();
    const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

    const plaintext = JSON.stringify({ channel: 'chat', action: 'message', data: { text: 'hello' } });
    let sendCounter = 0;

    const frame = encryptFrame(plaintext, sharedKey, sendCounter);
    expect(frame).toBeInstanceOf(Buffer);
    expect(frame.length).toBeGreaterThan(12 + 16); // nonce + tag + ciphertext

    const decrypted = decryptFrame(frame, sharedKey, sendCounter);
    expect(decrypted).toBe(plaintext);
  });

  it('should reject frame with wrong counter', () => {
    const alice = generateECDHKeyPair();
    const bob = generateECDHKeyPair();
    const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

    const frame = encryptFrame('test', sharedKey, 0);
    expect(() => decryptFrame(frame, sharedKey, 1)).toThrow();
  });

  it('should produce different ciphertexts for different counters', () => {
    const alice = generateECDHKeyPair();
    const bob = generateECDHKeyPair();
    const sharedKey = deriveSharedKey(alice.privateKey, bob.publicKey);

    const frame0 = encryptFrame('test', sharedKey, 0);
    const frame1 = encryptFrame('test', sharedKey, 1);
    expect(frame0.equals(frame1)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/shared && npx vitest run src/ecdh.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 ECDH 工具**

```typescript
// packages/shared/src/ecdh.ts
import { createECDH, createCipheriv, createDecipheriv } from 'node:crypto';

const CURVE = 'prime256v1'; // P-256
const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;

export interface ECDHKeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
  publicKeyBase64: string;
}

export function generateECDHKeyPair(): ECDHKeyPair {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey();
  const privateKey = ecdh.getPrivateKey();
  return {
    publicKey,
    privateKey,
    publicKeyBase64: publicKey.toString('base64'),
  };
}

export function deriveSharedKey(privateKey: Buffer, otherPublicKey: Buffer): Buffer {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(privateKey);
  // ECDH 共享密钥取前 32 bytes 作为 AES-256 密钥
  const shared = ecdh.computeSecret(otherPublicKey);
  // P-256 共享密钥是 32 bytes，直接用
  return shared;
}

export function publicKeyFromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

/**
 * 加密帧：[12 bytes nonce] + [ciphertext + GCM tag]
 * nonce 由 counter 生成：big-endian uint64 写入高 8 bytes，低 4 bytes 补零
 */
export function encryptFrame(plaintext: string, sharedKey: Buffer, counter: number): Buffer {
  const nonce = counterToNonce(counter);
  const cipher = createCipheriv(ALGORITHM, sharedKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, tag]);
}

/**
 * 解密帧：验证 nonce（counter 匹配）后解密
 */
export function decryptFrame(frame: Buffer, sharedKey: Buffer, expectedCounter: number): string {
  const nonce = frame.subarray(0, NONCE_LENGTH);
  const expectedNonce = counterToNonce(expectedCounter);
  if (!nonce.equals(expectedNonce)) {
    throw new Error('Nonce mismatch: possible replay or out-of-order message');
  }
  // GCM tag is last 16 bytes
  const tagStart = frame.length - 16;
  const encrypted = frame.subarray(NONCE_LENGTH, tagStart);
  const tag = frame.subarray(tagStart);
  const decipher = createDecipheriv(ALGORITHM, sharedKey, nonce);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Counter → 12-byte nonce.
 * Layout: [4 bytes zero][4 bytes high][4 bytes low] — big-endian uint64 at offset 4.
 * IMPORTANT: Browser (Web Crypto) counterToNonce must use identical layout.
 */
function counterToNonce(counter: number): Buffer {
  const buf = Buffer.alloc(NONCE_LENGTH);
  // big-endian uint64 at offset 4: high 32 bits at offset 4, low 32 bits at offset 8
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 4);
  buf.writeUInt32BE(counter >>> 0, 8);
  return buf;
}

export const RENEGOTIATE_THRESHOLD = 2 ** 48;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/shared && npx vitest run src/ecdh.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/ecdh.ts packages/shared/src/ecdh.test.ts
git commit -m "feat(shared): add ECDH key exchange + AES-256-GCM frame encryption"
```

### Task 2: 路径校验工具提取

**Files:**
- Create: `packages/shared/src/path-validator.ts`
- Create: `packages/shared/src/path-validator.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/src/core/workspace-storage.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/shared/src/path-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePath, validatePathStrict } from './path-validator.js';
import { mkdtemp, symlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('validatePath', () => {
  it('should resolve relative path within base', () => {
    const result = validatePath('/workspace', 'src/index.ts');
    expect(result).toBe('/workspace/src/index.ts');
  });

  it('should reject path traversal', () => {
    expect(() => validatePath('/workspace', '../etc/passwd')).toThrow('路径越界');
  });

  it('should reject absolute path outside base', () => {
    expect(() => validatePath('/workspace', '/etc/passwd')).toThrow('路径越界');
  });
});

describe('validatePathStrict', () => {
  it('should reject symlink pointing outside workspace', async () => {
    const base = await mkdtemp(join(tmpdir(), 'test-'));
    const inside = join(base, 'workspace');
    await mkdir(inside, { recursive: true });
    await writeFile(join(inside, 'ok.txt'), 'ok');
    await symlink('/etc/hosts', join(inside, 'evil-link'));

    const okResult = await validatePathStrict(inside, 'ok.txt');
    expect(okResult).toBe(join(inside, 'ok.txt'));

    await expect(validatePathStrict(inside, 'evil-link')).rejects.toThrow('符号链接');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/shared && npx vitest run src/path-validator.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现路径校验工具**

```typescript
// packages/shared/src/path-validator.ts
import { resolve } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

export function validatePath(basePath: string, userPath: string): string {
  const base = resolve(basePath);
  const resolved = resolve(basePath, userPath);
  // 严格前缀校验：防止 /workspace-evil 匹配 /workspace
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }
  return resolved;
}

export async function validatePathStrict(basePath: string, userPath: string): Promise<string> {
  const resolved = resolve(basePath, userPath);
  const base = resolve(basePath);
  if (!resolved.startsWith(base)) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }

  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const real = await realpath(resolved);
      if (!real.startsWith(base)) {
        throw new Error('符号链接指向工作区外：拒绝访问');
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  return resolved;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/shared && npx vitest run src/path-validator.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 更新 shared/index.ts 导出**

```typescript
// packages/shared/src/index.ts — 追加导出
export * from './ecdh.js';
export * from './path-validator.js';
export * from './direct-message.js';
```

- [ ] **Step 6: 更新 workspace-storage.ts 引用**

把 `packages/server/src/core/workspace-storage.ts` 中的 `validatePath` 和 `validatePathStrict` 函数体删除，改为从 `@ccclaw/shared` re-export：

```typescript
// packages/server/src/core/workspace-storage.ts — 删除 validatePath/validatePathStrict 函数定义
// 在文件顶部 import 中添加：
import { validatePath, validatePathStrict } from '@ccclaw/shared';
// 并在文件底部 re-export（保持现有引用不断）
export { validatePath, validatePathStrict };
```

- [ ] **Step 7: 提交**

```bash
git add packages/shared/src/path-validator.ts packages/shared/src/path-validator.test.ts packages/shared/src/index.ts packages/server/src/core/workspace-storage.ts
git commit -m "refactor(shared): extract path validation to shared package"
```

### Task 3: DirectMessage 类型与路由

**Files:**
- Create: `packages/shared/src/direct-message.ts`
- Create: `packages/shared/src/direct-message.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/shared/src/direct-message.test.ts
import { describe, it, expect } from 'vitest';
import { parseDirectMessage, serializeDirectMessage, type DirectMessage } from './direct-message.js';

describe('DirectMessage', () => {
  it('should serialize and parse a message', () => {
    const msg: DirectMessage = {
      channel: 'chat',
      action: 'message',
      requestId: 'req-1',
      data: { text: 'hello' },
    };
    const json = serializeDirectMessage(msg);
    const parsed = parseDirectMessage(json);
    expect(parsed).toEqual(msg);
  });

  it('should parse message without requestId', () => {
    const json = JSON.stringify({ channel: 'tree', action: 'event', data: { events: [] } });
    const parsed = parseDirectMessage(json);
    expect(parsed.channel).toBe('tree');
    expect(parsed.requestId).toBeUndefined();
  });

  it('should throw on invalid message (missing channel)', () => {
    expect(() => parseDirectMessage('{"action":"test"}')).toThrow();
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseDirectMessage('not json')).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/shared && npx vitest run src/direct-message.test.ts`

- [ ] **Step 3: 实现 DirectMessage**

```typescript
// packages/shared/src/direct-message.ts

export interface DirectMessage {
  channel: string;    // 'chat' | 'tree' | 'file' | 'terminal' | 'system'
  action: string;     // 具体操作
  requestId?: string; // 请求-响应配对
  data: unknown;      // 业务载荷
}

export interface DirectError {
  code: string;
  message: string;
}

// ====== Tree 类型 ======

export interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtime?: number;
  children?: TreeEntry[];
}

export interface TreeListData {
  path: string;
  depth?: number;
}

export interface TreeSnapshotData {
  path: string;
  truncated: boolean;
  entries: TreeEntry[];
}

export type TreeEventType = 'created' | 'deleted' | 'modified';

export interface TreeEvent {
  type: TreeEventType;
  path: string;
  entryType: 'file' | 'directory';
  size?: number;
  mtime?: number;
}

export interface TreeEventData {
  events: TreeEvent[];
}

// ====== File 类型 ======

export interface FileReadData {
  path: string;
}

export interface FileReadResult {
  path: string;
  content: string | null;
  size: number;
  mtime: number;
  binary: boolean;
}

export interface FileCreateData {
  path: string;
  type: 'file' | 'directory';
  content?: string;
}

export interface FileCreateResult {
  success: boolean;
  path: string;
}

export interface FileDeleteData {
  path: string;
}

export interface FileDeleteResult {
  success: boolean;
  path: string;
}

export interface FileStatData {
  path: string;
}

export interface FileStatResult {
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  binary: boolean;
}

// ====== 序列化 ======

export function serializeDirectMessage(msg: DirectMessage): string {
  return JSON.stringify(msg);
}

export function parseDirectMessage(raw: string): DirectMessage {
  const parsed = JSON.parse(raw);
  if (typeof parsed.channel !== 'string' || typeof parsed.action !== 'string' || !('data' in parsed)) {
    throw new Error('Invalid DirectMessage: missing channel, action, or data');
  }
  return parsed as DirectMessage;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/shared && npx vitest run src/direct-message.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 确保 index.ts 已导出 direct-message，运行全包 typecheck**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/direct-message.ts packages/shared/src/direct-message.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add DirectMessage types and channel:action routing"
```

---

## Chunk 2: Runner 直连服务（agent-runtime）

### Task 4: Runner 直连 WS 服务

**Files:**
- Create: `packages/agent-runtime/src/direct-server.ts`
- Create: `packages/agent-runtime/src/direct-server.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/agent-runtime/src/direct-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DirectServer } from './direct-server.js';
import { generateECDHKeyPair, deriveSharedKey, encryptFrame, decryptFrame } from '@ccclaw/shared';
import { WebSocket } from 'ws';

describe('DirectServer', () => {
  let server: DirectServer;
  let serverKeyPair: ReturnType<typeof generateECDHKeyPair>;

  beforeAll(async () => {
    serverKeyPair = generateECDHKeyPair();
    server = new DirectServer({
      keyPair: serverKeyPair,
      verifyToken: async (token) => token === 'valid-token',
      onMessage: () => {},
    });
    await server.start();
  });

  afterAll(() => {
    server.stop();
  });

  it('should expose a port and directUrl', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.directUrl).toMatch(/^ws:\/\//);
  });

  it('should reject connection without valid token', async () => {
    const ws = new WebSocket(`${server.directUrl}?token=bad-token`);
    await new Promise<void>((resolve) => {
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
    });
  });

  it('should complete ECDH handshake with valid token', async () => {
    const ws = new WebSocket(`${server.directUrl}?token=valid-token`);
    const clientKP = generateECDHKeyPair();

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: clientKP.publicKeyBase64 }));
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'handshake_ok') {
          expect(msg.runnerPublicKey).toBeDefined();
          ws.close();
          resolve();
        }
      });
    });
  });

  it('should exchange encrypted messages after handshake', async () => {
    const ws = new WebSocket(`${server.directUrl}?token=valid-token`);
    const clientKP = generateECDHKeyPair();
    let sharedKey: Buffer;
    let sendCounter = 0;

    const received: string[] = [];
    server.setMessageHandler((clientId, msg) => {
      // Echo back
      server.sendToClient(clientId, { channel: 'chat', action: 'echo', data: msg.data });
    });

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: clientKP.publicKeyBase64 }));
      });
      ws.on('message', (raw) => {
        if (typeof raw === 'string' || (raw instanceof Buffer && raw[0] === 0x7b)) {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'handshake_ok') {
            const serverPub = Buffer.from(msg.runnerPublicKey, 'base64');
            sharedKey = deriveSharedKey(clientKP.privateKey, serverPub);
            // Send encrypted message
            const frame = encryptFrame(
              JSON.stringify({ channel: 'chat', action: 'message', data: { text: 'hello' } }),
              sharedKey, sendCounter++,
            );
            ws.send(frame);
          }
        } else {
          // Binary = encrypted frame
          const buf = Buffer.from(raw as ArrayBuffer);
          const decrypted = decryptFrame(buf, sharedKey, 0);
          received.push(decrypted);
          ws.close();
          resolve();
        }
      });
    });

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.channel).toBe('chat');
    expect(parsed.action).toBe('echo');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/agent-runtime && npx vitest run src/direct-server.test.ts`

- [ ] **Step 3: 实现 DirectServer**

```typescript
// packages/agent-runtime/src/direct-server.ts
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  generateECDHKeyPair,
  deriveSharedKey,
  publicKeyFromBase64,
  encryptFrame,
  decryptFrame,
  serializeDirectMessage,
  type ECDHKeyPair,
  type DirectMessage,
} from '@ccclaw/shared';

export interface DirectServerOptions {
  keyPair: ECDHKeyPair;
  verifyToken: (token: string) => Promise<boolean>;
  onMessage: (clientId: string, msg: DirectMessage) => void;
  host?: string; // default: '127.0.0.1'
}

interface ClientSession {
  ws: WebSocket;
  sharedKey: Buffer;
  sendCounter: number;
  recvCounter: number;
}

export class DirectServer {
  private httpServer: Server;
  private wss: WebSocketServer;
  private clients = new Map<string, ClientSession>();
  private options: DirectServerOptions;
  private _port = 0;

  constructor(options: DirectServerOptions) {
    this.options = options;
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.setupUpgrade();
    this.setupConnection();
  }

  get port(): number { return this._port; }
  get directUrl(): string {
    const host = this.options.host || '127.0.0.1';
    return `ws://${host}:${this._port}`;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(0, this.options.host || '127.0.0.1', () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') this._port = addr.port;
        resolve();
      });
    });
  }

  stop(): void {
    for (const [, client] of this.clients) {
      client.ws.close(1000);
    }
    this.clients.clear();
    this.wss.close();
    this.httpServer.close();
  }

  setMessageHandler(handler: (clientId: string, msg: DirectMessage) => void) {
    this.options.onMessage = handler;
  }

  sendToClient(clientId: string, msg: DirectMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;
    const plaintext = serializeDirectMessage(msg);
    const frame = encryptFrame(plaintext, client.sharedKey, client.sendCounter++);
    client.ws.send(frame);
  }

  broadcastToAll(msg: DirectMessage): void {
    for (const [clientId] of this.clients) {
      this.sendToClient(clientId, msg);
    }
  }

  private setupUpgrade() {
    this.httpServer.on('upgrade', async (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token || !(await this.options.verifyToken(token))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws);
      });
    });
  }

  private setupConnection() {
    this.wss.on('connection', (ws: WebSocket) => {
      let clientId: string | null = null;

      ws.on('message', (raw) => {
        // 握手阶段：JSON 文本消息
        if (!clientId) {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'handshake' && msg.clientPublicKey) {
              // 为每个连接生成临时密钥对（前向保密）
              const sessionKP = generateECDHKeyPair();
              const clientPub = publicKeyFromBase64(msg.clientPublicKey);
              const sharedKey = deriveSharedKey(sessionKP.privateKey, clientPub);

              clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              this.clients.set(clientId, {
                ws,
                sharedKey,
                sendCounter: 0,
                recvCounter: 0,
              });

              ws.send(JSON.stringify({
                type: 'handshake_ok',
                runnerPublicKey: sessionKP.publicKeyBase64,
              }));
            }
          } catch {
            ws.close(4002, 'Invalid handshake');
          }
          return;
        }

        // 握手后：二进制加密帧
        const client = this.clients.get(clientId);
        if (!client) return;

        try {
          const frame = Buffer.from(raw as ArrayBuffer);
          const plaintext = decryptFrame(frame, client.sharedKey, client.recvCounter++);
          const msg = JSON.parse(plaintext) as DirectMessage;
          this.options.onMessage(clientId, msg);
        } catch (err) {
          console.error('[DirectServer] Frame decrypt/parse error:', err);
        }
      });

      ws.on('close', () => {
        if (clientId) {
          this.clients.delete(clientId);
        }
      });
    });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/agent-runtime && npx vitest run src/direct-server.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/direct-server.ts packages/agent-runtime/src/direct-server.test.ts
git commit -m "feat(agent-runtime): add DirectServer for ECDH encrypted WebSocket connections"
```

### Task 5: fs.watch 文件监听

**Files:**
- Create: `packages/agent-runtime/src/file-watcher.ts`
- Create: `packages/agent-runtime/src/file-watcher.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// packages/agent-runtime/src/file-watcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from './file-watcher.js';
import { mkdtemp, writeFile, mkdir, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TreeEvent } from '@ccclaw/shared';

function waitForEvents(watcher: FileWatcher, count: number, timeoutMs = 3000): Promise<TreeEvent[]> {
  return new Promise((resolve, reject) => {
    const events: TreeEvent[] = [];
    const timer = setTimeout(() => resolve(events), timeoutMs);
    watcher.on('events', (batch) => {
      events.push(...batch);
      if (events.length >= count) {
        clearTimeout(timer);
        resolve(events);
      }
    });
  });
}

describe('FileWatcher', () => {
  let dir: string;
  let watcher: FileWatcher;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fw-test-'));
    watcher = new FileWatcher(dir, { debounceMs: 100, ignorePatterns: ['node_modules', '.git'] });
    await watcher.start();
  });

  afterEach(async () => {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('should emit created event for new file', async () => {
    const eventPromise = waitForEvents(watcher, 1);
    await writeFile(join(dir, 'test.txt'), 'hello');
    const events = await eventPromise;
    expect(events.some(e => e.type === 'created' && e.path.includes('test.txt'))).toBe(true);
  });

  it('should emit deleted event', async () => {
    await writeFile(join(dir, 'del.txt'), 'bye');
    // Wait for created event to pass
    await new Promise(r => setTimeout(r, 200));
    const eventPromise = waitForEvents(watcher, 1);
    await unlink(join(dir, 'del.txt'));
    const events = await eventPromise;
    expect(events.some(e => e.type === 'deleted' && e.path.includes('del.txt'))).toBe(true);
  });

  it('should ignore node_modules', async () => {
    const nmDir = join(dir, 'node_modules');
    await mkdir(nmDir, { recursive: true });
    const eventPromise = waitForEvents(watcher, 0, 500);
    await writeFile(join(nmDir, 'pkg.json'), '{}');
    const events = await eventPromise;
    const nmEvents = events.filter(e => e.path.includes('node_modules'));
    expect(nmEvents).toHaveLength(0);
  });

  it('should emit modified event for content change', async () => {
    await writeFile(join(dir, 'mod.txt'), 'v1');
    await new Promise(r => setTimeout(r, 200));
    const eventPromise = waitForEvents(watcher, 1);
    await writeFile(join(dir, 'mod.txt'), 'v2');
    const events = await eventPromise;
    expect(events.some(e => (e.type === 'modified' || e.type === 'created') && e.path.includes('mod.txt'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/agent-runtime && npx vitest run src/file-watcher.test.ts`

- [ ] **Step 3: 实现 FileWatcher**

```typescript
// packages/agent-runtime/src/file-watcher.ts
import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import type { TreeEvent } from '@ccclaw/shared';

export interface FileWatcherOptions {
  debounceMs?: number;
  ignorePatterns?: string[];
  maxDepth?: number;
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.cache', '.next', '.nuxt'];

export class FileWatcher extends EventEmitter {
  private rootDir: string;
  private debounceMs: number;
  private ignorePatterns: string[];
  private maxDepth: number;
  private watchers: FSWatcher[] = [];
  private pendingEvents = new Map<string, TreeEvent>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Track known files to distinguish created vs modified
  private knownPaths = new Set<string>();

  constructor(rootDir: string, options: FileWatcherOptions = {}) {
    super();
    this.rootDir = rootDir;
    this.debounceMs = options.debounceMs ?? 200;
    this.ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE;
    this.maxDepth = options.maxDepth ?? 10;
  }

  async start(): Promise<void> {
    // Scan existing files to populate knownPaths
    await this.scanExisting(this.rootDir, 0);
    // Start recursive watch
    this.watchDir(this.rootDir, 0);
  }

  stop(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private shouldIgnore(name: string): boolean {
    return this.ignorePatterns.includes(name);
  }

  private async scanExisting(dir: string, depth: number): Promise<void> {
    if (depth > this.maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (this.shouldIgnore(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        const relPath = '/' + relative(this.rootDir, fullPath);
        this.knownPaths.add(relPath);
        if (entry.isDirectory()) {
          await this.scanExisting(fullPath, depth + 1);
        }
      }
    } catch { /* directory may not exist yet */ }
  }

  private watchDir(dir: string, depth: number): void {
    if (depth > this.maxDepth) return;
    try {
      const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Check if any path component is ignored
        const parts = filename.split('/');
        if (parts.some(p => this.shouldIgnore(p))) return;

        const fullPath = join(dir, filename);
        const relPath = '/' + relative(this.rootDir, fullPath);

        this.enqueueEvent(relPath, fullPath);
      });
      this.watchers.push(watcher);
    } catch { /* watch may fail on some platforms */ }
  }

  private enqueueEvent(relPath: string, fullPath: string): void {
    // Determine event type asynchronously
    stat(fullPath).then((s) => {
      const isKnown = this.knownPaths.has(relPath);
      const eventType: TreeEvent['type'] = isKnown ? 'modified' : 'created';
      this.knownPaths.add(relPath);
      this.pendingEvents.set(relPath, {
        type: eventType,
        path: relPath,
        entryType: s.isDirectory() ? 'directory' : 'file',
        size: s.size,
        mtime: Math.floor(s.mtimeMs / 1000),
      });
      this.scheduleDebouncedFlush();
    }).catch(() => {
      // File deleted
      this.knownPaths.delete(relPath);
      this.pendingEvents.set(relPath, {
        type: 'deleted',
        path: relPath,
        entryType: 'file', // can't determine after deletion
      });
      this.scheduleDebouncedFlush();
    });
  }

  private scheduleDebouncedFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    if (this.pendingEvents.size === 0) return;
    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();
    this.emit('events', events);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/agent-runtime && npx vitest run src/file-watcher.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/file-watcher.ts packages/agent-runtime/src/file-watcher.test.ts
git commit -m "feat(agent-runtime): add FileWatcher with fs.watch, debounce, and ignore rules"
```

### Task 6: Tree 和 File 请求处理器

**Files:**
- Create: `packages/agent-runtime/src/handlers/tree-handler.ts`
- Create: `packages/agent-runtime/src/handlers/file-handler.ts`
- Create: `packages/agent-runtime/src/handlers/tree-handler.test.ts`
- Create: `packages/agent-runtime/src/handlers/file-handler.test.ts`

- [ ] **Step 1: 写 tree-handler 测试**

```typescript
// packages/agent-runtime/src/handlers/tree-handler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TreeHandler } from './tree-handler.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TreeHandler', () => {
  let dir: string;
  let handler: TreeHandler;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tree-test-'));
    handler = new TreeHandler(dir);
    // Create test structure
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'index.ts'), 'export {}');
    await writeFile(join(dir, 'package.json'), '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should list root with depth 1', async () => {
    const result = await handler.list('/', 1);
    expect(result.truncated).toBe(false);
    expect(result.entries.some(e => e.name === 'src' && e.type === 'directory')).toBe(true);
    expect(result.entries.some(e => e.name === 'package.json' && e.type === 'file')).toBe(true);
    // depth 1: src directory should not have children
    const srcEntry = result.entries.find(e => e.name === 'src');
    expect(srcEntry?.children).toBeUndefined();
  });

  it('should list root with depth 2', async () => {
    const result = await handler.list('/', 2);
    const srcEntry = result.entries.find(e => e.name === 'src');
    expect(srcEntry?.children).toBeDefined();
    expect(srcEntry!.children!.some(e => e.name === 'index.ts')).toBe(true);
  });

  it('should list subdirectory', async () => {
    const result = await handler.list('/src', 1);
    expect(result.entries.some(e => e.name === 'index.ts')).toBe(true);
  });

  it('should truncate at maxEntries', async () => {
    // Create many files
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `file${i}.txt`), `content ${i}`);
    }
    const result = await handler.list('/', 1, 5);
    expect(result.truncated).toBe(true);
    expect(result.entries.length).toBeLessThanOrEqual(5);
  });

  it('should reject path outside workspace', async () => {
    await expect(handler.list('../../etc', 1)).rejects.toThrow('路径越界');
  });
});
```

- [ ] **Step 2: 写 file-handler 测试**

```typescript
// packages/agent-runtime/src/handlers/file-handler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileHandler } from './file-handler.js';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileHandler', () => {
  let dir: string;
  let handler: FileHandler;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-test-'));
    handler = new FileHandler(dir);
    await writeFile(join(dir, 'hello.txt'), 'Hello World');
    await mkdir(join(dir, 'sub'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should read a text file', async () => {
    const result = await handler.read('/hello.txt');
    expect(result.content).toBe('Hello World');
    expect(result.binary).toBe(false);
    expect(result.size).toBeGreaterThan(0);
  });

  it('should detect binary file', async () => {
    await writeFile(join(dir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0xFF]));
    const result = await handler.read('/binary.bin');
    expect(result.binary).toBe(true);
    expect(result.content).toBeNull();
  });

  it('should reject file larger than 1MB', async () => {
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 1));
    await expect(handler.read('/big.txt')).rejects.toThrow('FILE_TOO_LARGE');
  });

  it('should create a new file', async () => {
    const result = await handler.create('/new.txt', 'file', 'content');
    expect(result.success).toBe(true);
    const content = await readFile(join(dir, 'new.txt'), 'utf-8');
    expect(content).toBe('content');
  });

  it('should create a new directory', async () => {
    const result = await handler.create('/new-dir', 'directory');
    expect(result.success).toBe(true);
  });

  it('should reject creating existing file', async () => {
    await expect(handler.create('/hello.txt', 'file')).rejects.toThrow('ALREADY_EXISTS');
  });

  it('should delete a file', async () => {
    const result = await handler.delete('/hello.txt');
    expect(result.success).toBe(true);
  });

  it('should delete a directory recursively', async () => {
    await writeFile(join(dir, 'sub', 'deep.txt'), 'deep');
    const result = await handler.delete('/sub');
    expect(result.success).toBe(true);
  });

  it('should stat a file', async () => {
    const result = await handler.stat('/hello.txt');
    expect(result.type).toBe('file');
    expect(result.size).toBeGreaterThan(0);
  });

  it('should reject path outside workspace', async () => {
    await expect(handler.read('/../../etc/passwd')).rejects.toThrow('PATH_OUTSIDE_WORKSPACE');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/agent-runtime && npx vitest run src/handlers/`

- [ ] **Step 4: 实现 TreeHandler**

```typescript
// packages/agent-runtime/src/handlers/tree-handler.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePath, type TreeEntry, type TreeSnapshotData } from '@ccclaw/shared';

const DEFAULT_MAX_ENTRIES = 2000;

export class TreeHandler {
  constructor(private workspaceDir: string) {}

  async list(path: string, depth: number = 2, maxEntries: number = DEFAULT_MAX_ENTRIES): Promise<TreeSnapshotData> {
    const fullPath = validatePath(this.workspaceDir, path === '/' ? '.' : path);
    let count = 0;
    let truncated = false;

    const entries = await this.readDir(fullPath, depth, () => {
      count++;
      if (count > maxEntries) {
        truncated = true;
        return false; // stop
      }
      return true; // continue
    });

    return { path, truncated, entries };
  }

  private async readDir(dir: string, depth: number, onEntry: () => boolean): Promise<TreeEntry[]> {
    const entries: TreeEntry[] = [];
    try {
      const items = await readdir(dir, { withFileTypes: true });
      // Sort: directories first, then files, alphabetical
      items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (!onEntry()) break;
        const fullPath = join(dir, item.name);

        if (item.isDirectory()) {
          const entry: TreeEntry = { name: item.name, type: 'directory' };
          if (depth > 1) {
            entry.children = await this.readDir(fullPath, depth - 1, onEntry);
          }
          entries.push(entry);
        } else if (item.isFile()) {
          try {
            const s = await stat(fullPath);
            entries.push({
              name: item.name,
              type: 'file',
              size: s.size,
              mtime: Math.floor(s.mtimeMs / 1000),
            });
          } catch {
            entries.push({ name: item.name, type: 'file' });
          }
        }
      }
    } catch { /* directory may not exist */ }
    return entries;
  }
}
```

- [ ] **Step 5: 实现 FileHandler**

```typescript
// packages/agent-runtime/src/handlers/file-handler.ts
import { readFile, writeFile, mkdir, rm, stat as fsStat, access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validatePathStrict, type FileReadResult, type FileCreateResult, type FileDeleteResult, type FileStatResult } from '@ccclaw/shared';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const BINARY_CHECK_SIZE = 8192;

class FileError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FileError';
  }
}

export class FileHandler {
  constructor(private workspaceDir: string) {}

  async read(path: string): Promise<FileReadResult> {
    const fullPath = await this.validateAndResolve(path);
    const s = await fsStat(fullPath);

    if (s.size > MAX_FILE_SIZE) {
      throw new FileError('FILE_TOO_LARGE', `文件大小 ${s.size} 超过限制 ${MAX_FILE_SIZE}`);
    }

    const buf = await readFile(fullPath);
    const binary = this.isBinary(buf);

    return {
      path,
      content: binary ? null : buf.toString('utf-8'),
      size: s.size,
      mtime: Math.floor(s.mtimeMs / 1000),
      binary,
    };
  }

  async create(path: string, type: 'file' | 'directory', content?: string): Promise<FileCreateResult> {
    const fullPath = await this.validateAndResolve(path, true);

    // Check if already exists
    try {
      await access(fullPath, constants.F_OK);
      throw new FileError('ALREADY_EXISTS', `路径已存在: ${path}`);
    } catch (err: any) {
      if (err instanceof FileError) throw err;
      // ENOENT is expected — path doesn't exist yet
    }

    if (type === 'directory') {
      await mkdir(fullPath, { recursive: true });
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content ?? '', 'utf-8');
    }

    return { success: true, path };
  }

  async delete(path: string): Promise<FileDeleteResult> {
    const fullPath = await this.validateAndResolve(path);

    // Ensure it exists
    try {
      await access(fullPath, constants.F_OK);
    } catch {
      throw new FileError('NOT_FOUND', `文件或目录不存在: ${path}`);
    }

    await rm(fullPath, { recursive: true, force: true });
    return { success: true, path };
  }

  async stat(path: string): Promise<FileStatResult> {
    const fullPath = await this.validateAndResolve(path);
    const s = await fsStat(fullPath);

    let binary = false;
    if (s.isFile() && s.size > 0 && s.size <= BINARY_CHECK_SIZE) {
      const buf = await readFile(fullPath);
      binary = this.isBinary(buf);
    } else if (s.isFile() && s.size > BINARY_CHECK_SIZE) {
      // Read only first BINARY_CHECK_SIZE bytes
      const { createReadStream } = await import('node:fs');
      const buf = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        const stream = createReadStream(fullPath, { start: 0, end: BINARY_CHECK_SIZE - 1 });
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
      binary = this.isBinary(buf);
    }

    return {
      path,
      type: s.isDirectory() ? 'directory' : 'file',
      size: s.size,
      mtime: Math.floor(s.mtimeMs / 1000),
      binary,
    };
  }

  private async validateAndResolve(path: string, allowNew = false): Promise<string> {
    try {
      return await validatePathStrict(this.workspaceDir, path === '/' ? '.' : path.replace(/^\//, ''));
    } catch (err: any) {
      if (err.message.includes('路径越界') || err.message.includes('符号链接')) {
        throw new FileError('PATH_OUTSIDE_WORKSPACE', err.message);
      }
      if (err.code === 'ENOENT' && allowNew) {
        // For create operations, validate without strict (file doesn't exist yet)
        const { validatePath } = await import('@ccclaw/shared');
        return validatePath(this.workspaceDir, path === '/' ? '.' : path.replace(/^\//, ''));
      }
      throw new FileError('IO_ERROR', err.message);
    }
  }

  private isBinary(buf: Buffer): boolean {
    const checkLen = Math.min(buf.length, BINARY_CHECK_SIZE);
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd packages/agent-runtime && npx vitest run src/handlers/`
Expected: 11+ tests PASS

- [ ] **Step 7: 提交**

```bash
git add packages/agent-runtime/src/handlers/
git commit -m "feat(agent-runtime): add TreeHandler and FileHandler for direct channel"
```

---

## Chunk 3: Runner 注册 + Server 加密 Config + runner-info API

### Task 7: 更新协议 + Runner 注册带公钥

**Files:**
- Modify: `packages/agent-runtime/src/protocol.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/server/src/core/runner-manager.ts`
- Modify: `packages/server/src/channel/webui.ts`
- Create: `packages/server/src/api/runner-info.ts`

- [ ] **Step 1: 更新 protocol.ts — 新增公钥和 directUrl 字段**

在 `RunnerMessage` 类型中新增 `register` 消息类型：

```typescript
// packages/agent-runtime/src/protocol.ts — 追加到 RunnerMessage union
  | { type: 'register'; publicKey: string; directUrl: string }
```

在 `ServerMessage` 类型中新增 `config_update`：

```typescript
// packages/agent-runtime/src/protocol.ts — 追加到 ServerMessage union
  | { type: 'config_update'; encrypted: string; serverPublicKey: string }
```

修改 `config` 消息类型为加密格式：

```typescript
// 将原有的 { type: 'config'; data: RuntimeConfig }
// 改为同时支持明文和加密两种格式（过渡期兼容）
  | { type: 'config'; data?: RuntimeConfig; encrypted?: string; serverPublicKey?: string }
```

- [ ] **Step 2: 更新 runner-manager.ts — 缓存公钥 + directUrl，加密 config**

在 `RunnerInfo` 接口新增字段：

```typescript
interface RunnerInfo {
  // ... 现有字段 ...
  publicKey?: string;      // Runner ECDH 公钥 (base64)
  directUrl?: string;      // Runner 直连地址
}
```

修改 `registerRunner` 方法签名和实现，接收公钥和 directUrl：

```typescript
registerRunner(ws: WebSocket, runnerId: string, startMode: StartMode = 'remote', terminalCallback?: (msg: Record<string, unknown>) => void, publicKey?: string, directUrl?: string) {
  // ... 现有逻辑 ...
  const info: RunnerInfo = { ws, runnerId, startMode, lastPing: Date.now(), workspaces: new Set(), terminalCallback, publicKey, directUrl };
  // ...
}
```

修改 `sendConfig` 方法，如果 runner 有公钥则加密发送：

```typescript
sendConfig(workspaceSlug: string, runtimeConfig: import('./runner-manager.js').RuntimeConfig) {
  const runnerId = this.bindings.get(workspaceSlug);
  if (!runnerId) return;
  const runner = this.runners.get(runnerId);
  if (!runner || runner.ws.readyState !== WebSocket.OPEN) return;

  if (runner.publicKey) {
    // 加密发送（注意：generateECDHKeyPair 等需在文件顶部 import）
    // import { generateECDHKeyPair, deriveSharedKey, publicKeyFromBase64, encrypt } from '@ccclaw/shared';
    const serverKP = generateECDHKeyPair();
    const runnerPub = publicKeyFromBase64(runner.publicKey);
    const sharedKey = deriveSharedKey(serverKP.privateKey, runnerPub);
    const plaintext = JSON.stringify(runtimeConfig);
    const encrypted = encrypt(plaintext, sharedKey.toString('hex'));
    runner.ws.send(JSON.stringify({
      type: 'config',
      encrypted,
      serverPublicKey: serverKP.publicKeyBase64,
    }));
  } else {
    // 明文发送（兼容）
    runner.ws.send(JSON.stringify({ type: 'config', data: runtimeConfig }));
  }
  logger.info({ runnerId, providerType: runtimeConfig.providerType, model: runtimeConfig.model }, 'Config pushed to runner');
}
```

新增 `getRunnerInfo` 方法：

```typescript
getRunnerInfo(workspaceSlug: string): { directUrl: string; fallback: boolean } | null {
  const runnerId = this.bindings.get(workspaceSlug);
  if (!runnerId) return null;
  const runner = this.runners.get(runnerId);
  if (!runner || runner.ws.readyState !== WebSocket.OPEN) return null;
  if (!runner.directUrl) return null;
  return { directUrl: runner.directUrl, fallback: true };
}
```

- [ ] **Step 3: 更新 webui.ts — 注册时接收公钥和 directUrl**

在 `handleRunnerUpgrade` 中，保持现有 `registerRunner()` 不变（升级时注册），新增处理 `register` 消息来**更新**已注册 runner 的公钥和 directUrl（避免重复注册导致 WebSocket 被关闭）：

```typescript
// 在 runnerManager.registerRunner() 调用之后，给 ws 加 message handler：
ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'register') {
      // Runner 主动上报公钥和 directUrl — 更新已注册的 runner 信息
      runnerManager.updateRunnerInfo(runnerId!, msg.publicKey, msg.directUrl);
      return;
    }
  } catch { /* ignore */ }
});
```

在 `RunnerManager` 中新增 `updateRunnerInfo` 方法（不要再次调用 `registerRunner`）：

```typescript
updateRunnerInfo(runnerId: string, publicKey?: string, directUrl?: string) {
  const runner = this.runners.get(runnerId);
  if (!runner) return;
  if (publicKey) runner.publicKey = publicKey;
  if (directUrl) runner.directUrl = directUrl;
  logger.info({ runnerId, publicKey: !!publicKey, directUrl }, 'Runner info updated');
}
```

- [ ] **Step 4: 更新 agent-runtime/index.ts — 启动直连服务 + 注册带公钥**

在 Runner 启动时：
1. 生成 ECDH 密钥对
2. 启动 DirectServer
3. 连接 Server 后发送 register 消息包含公钥和 directUrl
4. 处理加密 config 消息

```typescript
// 在 initModules() 之后、connect() 之前添加：
import { generateECDHKeyPair, deriveSharedKey, publicKeyFromBase64, decrypt as aesDecrypt } from '@ccclaw/shared';
import { DirectServer } from './direct-server.js';
import { FileWatcher } from './file-watcher.js';
import { TreeHandler } from './handlers/tree-handler.js';
import { FileHandler } from './handlers/file-handler.js';

const registrationKeyPair = generateECDHKeyPair();
let directServer: DirectServer | null = null;

// 启动直连服务
async function startDirectServer() {
  const treeHandler = new TreeHandler(WORKSPACE_DIR);
  const fileHandler = new FileHandler(WORKSPACE_DIR);
  const fileWatcher = new FileWatcher(WORKSPACE_DIR);

  directServer = new DirectServer({
    keyPair: registrationKeyPair,
    verifyToken: async (token) => {
      // JWT 验证：Runner 需要 Server 的 JWT_SECRET 来校验
      // 启动时通过 RuntimeConfig 或环境变量注入 JWT_SECRET
      try {
        const { jwtVerify } = await import('jose');
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
        await jwtVerify(token, secret);
        return true;
      } catch {
        return false;
      }
    },
    onMessage: (clientId, msg) => {
      handleDirectMessage(clientId, msg, treeHandler, fileHandler);
    },
  });

  await directServer.start();
  await fileWatcher.start();

  // 广播文件变更事件
  fileWatcher.on('events', (events) => {
    directServer?.broadcastToAll({
      channel: 'tree',
      action: 'event',
      data: { events },
    });
  });

  console.log(`[runner:${RUNNER_ID}] 直连服务启动: ${directServer.directUrl}`);
}
```

修改 `connect()` 的 `ws.on('open')` 回调：

```typescript
ws.on('open', () => {
  console.log(`[runner:${RUNNER_ID}] 已连接 Server`);
  reconnectAttempts = 0;
  startHeartbeat();
  // 发送注册消息（带公钥和 directUrl）
  sendToServer({
    type: 'register',
    publicKey: registrationKeyPair.publicKeyBase64,
    directUrl: directServer?.directUrl || '',
  } as any);
});
```

修改 `applyConfig()` 支持加密 config：

```typescript
function applyConfig(msg: any) {
  let cfg: import('./protocol.js').RuntimeConfig;
  if (msg.encrypted && msg.serverPublicKey) {
    // 加密模式
    const serverPub = publicKeyFromBase64(msg.serverPublicKey);
    const sharedKey = deriveSharedKey(registrationKeyPair.privateKey, serverPub);
    const plaintext = aesDecrypt(msg.encrypted, sharedKey.toString('hex'));
    cfg = JSON.parse(plaintext);
  } else if (msg.data) {
    cfg = msg.data;
  } else {
    console.error(`[runner:${RUNNER_ID}] 无法解析 config`);
    return;
  }
  // ... 现有 applyConfig 逻辑 ...
}
```

- [ ] **Step 5: 创建 runner-info API 路由**

```typescript
// packages/server/src/api/runner-info.ts
import { Hono } from 'hono';
import { runnerManager } from '../core/runner-manager.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const runnerInfoRoute = new Hono();

// 注意：workspaceId 是 UUID，需要先查 slug 再查 runner
runnerInfoRoute.get('/workspaces/:id/runner-info', async (c) => {
  const workspaceId = c.req.param('id');
  // 查询 workspace slug
  const [ws] = await db.select({ slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return c.json({ error: '工作区不存在' }, 404);

  const info = runnerManager.getRunnerInfo(ws.slug);
  if (!info) {
    return c.json({ error: 'Runner 不在线或不支持直连' }, 404);
  }
  return c.json(info);
});

export { runnerInfoRoute };
```

**注册路由**：在 `packages/server/src/api/index.ts` 中添加：

```typescript
import { runnerInfoRoute } from './runner-info.js';
// 在 api 路由注册处添加：
api.route('/', runnerInfoRoute);
```

- [ ] **Step 6: typecheck 全部 4 个包**

Run: `pnpm -r run typecheck` 或 `cd packages/shared && npx tsc --noEmit && cd ../agent-runtime && npx tsc --noEmit && cd ../server && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add packages/agent-runtime/src/protocol.ts packages/agent-runtime/src/index.ts packages/server/src/core/runner-manager.ts packages/server/src/channel/webui.ts packages/server/src/api/runner-info.ts
git commit -m "feat: Runner ECDH registration + encrypted config + runner-info API"
```

---

## Chunk 4: 前端直连客户端 + Fallback 状态机

### Task 8: 前端 ECDH 直连 WS 客户端

**Files:**
- Create: `packages/web/src/api/direct-ws.ts`

- [ ] **Step 1: 实现直连 WS 客户端**

```typescript
// packages/web/src/api/direct-ws.ts
import { api, getAccessToken } from './client';

export type ConnectionState = 'INIT' | 'CONNECTING' | 'DIRECT' | 'RELAY' | 'DISCONNECTED';

type MessageHandler = (msg: any) => void;

interface DirectWsOptions {
  workspaceId: string;
  onStateChange: (state: ConnectionState) => void;
  onMessage: (msg: any) => void;
}

const HANDSHAKE_TIMEOUT = 3000;
const RECONNECT_INTERVAL = 30000;
const PING_INTERVAL = 15000;
const PING_TIMEOUT = 45000; // 3 missed pings

export class DirectWsClient {
  private options: DirectWsOptions;
  private state: ConnectionState = 'INIT';
  private directWs: WebSocket | null = null;
  private sharedKey: CryptoKey | null = null;
  private privateKey: CryptoKey | null = null;
  private sendCounter = 0;
  private recvCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;

  constructor(options: DirectWsOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.setState('CONNECTING');
    try {
      // 1. 获取 runner-info
      const info = await api<{ directUrl: string; fallback: boolean }>(
        `/workspaces/${this.options.workspaceId}/runner-info`
      );

      // 2. 生成 ECDH 密钥对 (Web Crypto API)
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
      );
      this.privateKey = keyPair.privateKey;

      // 3. 导出公钥
      const pubKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const pubKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(pubKeyRaw)));

      // 4. 连接直连 WS
      const token = getAccessToken();
      const ws = new WebSocket(`${info.directUrl}?token=${token}`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Handshake timeout'));
        }, HANDSHAKE_TIMEOUT);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: pubKeyBase64 }));
        };

        ws.onmessage = async (e) => {
          if (typeof e.data === 'string') {
            const msg = JSON.parse(e.data);
            if (msg.type === 'handshake_ok') {
              clearTimeout(timeout);
              // 导入 Runner 公钥
              const runnerPubBytes = Uint8Array.from(atob(msg.runnerPublicKey), c => c.charCodeAt(0));
              const runnerPubKey = await crypto.subtle.importKey(
                'raw', runnerPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
              );
              // 派生共享密钥
              const sharedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: runnerPubKey },
                this.privateKey!, 256
              );
              this.sharedKey = await crypto.subtle.importKey(
                'raw', sharedBits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
              );
              this.directWs = ws;
              this.sendCounter = 0;
              this.recvCounter = 0;
              this.setupEncryptedHandler(ws);
              this.startPing();
              this.setState('DIRECT');
              resolve();
            }
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Connection failed'));
        };
      });
    } catch {
      this.setState('RELAY');
      this.scheduleReconnect();
    }
  }

  async send(msg: any): Promise<void> {
    if (this.state === 'DIRECT' && this.directWs && this.sharedKey) {
      const plaintext = JSON.stringify(msg);
      const frame = await this.encryptFrame(plaintext);
      this.directWs.send(frame);
    }
    // RELAY mode: handled by existing ws.ts
  }

  disconnect(): void {
    this.clearTimers();
    this.directWs?.close();
    this.directWs = null;
    this.setState('DISCONNECTED');
  }

  getState(): ConnectionState { return this.state; }

  private setupEncryptedHandler(ws: WebSocket) {
    ws.onmessage = async (e) => {
      if (e.data instanceof Blob) {
        const buf = await e.data.arrayBuffer();
        const plaintext = await this.decryptFrame(new Uint8Array(buf));
        const msg = JSON.parse(plaintext);

        // Handle system messages internally
        if (msg.channel === 'system' && msg.action === 'pong') {
          this.lastPong = Date.now();
          return;
        }

        this.options.onMessage(msg);
      }
    };

    ws.onclose = () => {
      this.clearTimers();
      this.setState('RELAY');
      this.scheduleReconnect();
    };
  }

  private async encryptFrame(plaintext: string): Promise<ArrayBuffer> {
    const nonce = this.counterToNonce(this.sendCounter++);
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      this.sharedKey!,
      encoded
    );
    // Combine: nonce (12 bytes) + ciphertext (includes GCM tag)
    const frame = new Uint8Array(12 + encrypted.byteLength);
    frame.set(nonce, 0);
    frame.set(new Uint8Array(encrypted), 12);
    return frame.buffer;
  }

  private async decryptFrame(frame: Uint8Array): Promise<string> {
    const nonce = frame.slice(0, 12);
    const expectedNonce = this.counterToNonce(this.recvCounter++);
    // Verify nonce matches expected counter
    for (let i = 0; i < 12; i++) {
      if (nonce[i] !== expectedNonce[i]) {
        throw new Error('Nonce mismatch');
      }
    }
    const ciphertext = frame.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      this.sharedKey!,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  /**
   * Counter → 12-byte nonce.
   * Layout: [4 bytes zero][4 bytes high][4 bytes low] — big-endian uint64 at offset 4.
   * MUST match Node.js counterToNonce in @ccclaw/shared/ecdh.ts.
   */
  private counterToNonce(counter: number): Uint8Array {
    const buf = new Uint8Array(12);
    const view = new DataView(buf.buffer);
    view.setUint32(4, Math.floor(counter / 0x100000000));
    view.setUint32(8, counter >>> 0);
    return buf;
  }

  private startPing(): void {
    this.lastPong = Date.now();
    this.pingTimer = setInterval(async () => {
      if (Date.now() - this.lastPong > PING_TIMEOUT) {
        // Dead connection
        this.directWs?.close();
        return;
      }
      await this.send({ channel: 'system', action: 'ping', data: { ts: Date.now() } });
    }, PING_INTERVAL);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL);
  }

  private clearTimers(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.options.onStateChange(state);
  }
}
```

- [ ] **Step 2: typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/api/direct-ws.ts
git commit -m "feat(web): add DirectWsClient with ECDH handshake, AES-GCM encryption, and fallback state machine"
```

---

## Chunk 5: 前端目录树 + 文件管理 UI

### Task 9: File Tree Store

**Files:**
- Create: `packages/web/src/stores/file-tree.ts`

- [ ] **Step 1: 实现 file-tree store**

```typescript
// packages/web/src/stores/file-tree.ts
import { create } from 'zustand';
import type { TreeEntry, TreeEvent, DirectMessage, FileReadResult } from '@ccclaw/shared';

interface FileTreeState {
  // 树状态
  entries: TreeEntry[];
  loading: boolean;
  truncated: boolean;
  // 展开的目录集合
  expandedPaths: Set<string>;
  // 当前预览的文件
  previewPath: string | null;
  previewContent: string | null;
  previewBinary: boolean;
  previewLoading: boolean;
  previewChanged: boolean; // 文件被外部修改

  // 连接状态
  connectionState: 'INIT' | 'CONNECTING' | 'DIRECT' | 'RELAY' | 'DISCONNECTED';

  // Actions
  setEntries: (entries: TreeEntry[], truncated: boolean) => void;
  applyEvents: (events: TreeEvent[]) => void;
  toggleDir: (path: string) => void;
  setPreview: (path: string | null, content: string | null, binary: boolean) => void;
  setPreviewLoading: (loading: boolean) => void;
  setPreviewChanged: (changed: boolean) => void;
  setConnectionState: (state: FileTreeState['connectionState']) => void;
  setLoading: (loading: boolean) => void;
  mergeSubtree: (parentPath: string, children: TreeEntry[]) => void;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  entries: [],
  loading: false,
  truncated: false,
  expandedPaths: new Set(),
  previewPath: null,
  previewContent: null,
  previewBinary: false,
  previewLoading: false,
  previewChanged: false,
  connectionState: 'INIT',

  setEntries: (entries, truncated) => set({ entries, truncated, loading: false }),

  applyEvents: (events) => {
    const state = get();
    const newEntries = [...state.entries];

    for (const event of events) {
      if (event.type === 'created') {
        insertEntry(newEntries, event);
      } else if (event.type === 'deleted') {
        removeEntry(newEntries, event.path);
      } else if (event.type === 'modified') {
        updateEntry(newEntries, event);
        // Check if preview file was modified
        if (state.previewPath === event.path) {
          set({ previewChanged: true });
        }
      }
    }

    set({ entries: newEntries });
  },

  toggleDir: (path) => {
    const state = get();
    const newExpanded = new Set(state.expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    set({ expandedPaths: newExpanded });
  },

  setPreview: (path, content, binary) => set({
    previewPath: path,
    previewContent: content,
    previewBinary: binary,
    previewLoading: false,
    previewChanged: false,
  }),

  setPreviewLoading: (loading) => set({ previewLoading: loading }),
  setPreviewChanged: (changed) => set({ previewChanged: changed }),
  setConnectionState: (state) => set({ connectionState: state }),
  setLoading: (loading) => set({ loading }),

  mergeSubtree: (parentPath, children) => {
    const entries = [...get().entries];
    mergeChildren(entries, parentPath, children);
    set({ entries });
  },
}));

// ====== 树操作工具函数 ======

function insertEntry(entries: TreeEntry[], event: TreeEvent): void {
  const parts = event.path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = findParent(entries, parts);
  if (!parent) return;

  const target = Array.isArray(parent) ? parent : (parent.children ??= []);
  // 避免重复
  if (target.some(e => e.name === name)) return;
  target.push({
    name,
    type: event.entryType,
    size: event.size,
    mtime: event.mtime,
  });
  // Sort: directories first, then alphabetical
  target.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function removeEntry(entries: TreeEntry[], path: string): void {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = findParent(entries, parts);
  if (!parent) return;
  const target = Array.isArray(parent) ? parent : (parent.children ?? []);
  const idx = target.findIndex(e => e.name === name);
  if (idx !== -1) target.splice(idx, 1);
}

function updateEntry(entries: TreeEntry[], event: TreeEvent): void {
  const parts = event.path.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = findParent(entries, parts);
  if (!parent) return;
  const target = Array.isArray(parent) ? parent : (parent.children ?? []);
  const entry = target.find(e => e.name === name);
  if (entry) {
    entry.size = event.size;
    entry.mtime = event.mtime;
  }
}

function mergeChildren(entries: TreeEntry[], parentPath: string, children: TreeEntry[]): void {
  if (parentPath === '/') {
    entries.length = 0;
    entries.push(...children);
    return;
  }
  const parts = parentPath.split('/').filter(Boolean);
  const name = parts.pop()!;
  const parent = findParent(entries, parts);
  if (!parent) return;
  const target = Array.isArray(parent) ? parent : (parent.children ?? []);
  const dir = target.find(e => e.name === name && e.type === 'directory');
  if (dir) dir.children = children;
}

function findParent(entries: TreeEntry[], pathParts: string[]): TreeEntry[] | TreeEntry | null {
  if (pathParts.length === 0) return entries;
  let current: TreeEntry[] = entries;
  for (const part of pathParts) {
    const found = current.find(e => e.name === part && e.type === 'directory');
    if (!found) return null;
    current = found.children ?? [];
  }
  return current;
}
```

- [ ] **Step 2: typecheck**

Run: `cd packages/web && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/stores/file-tree.ts
git commit -m "feat(web): add file tree Zustand store with incremental updates"
```

### Task 10: 前端 UI 组件

**Files:**
- Create: `packages/web/src/components/workspace/FileTree.tsx`
- Create: `packages/web/src/components/workspace/FilePreview.tsx`
- Create: `packages/web/src/components/workspace/FilePanel.tsx`

- [ ] **Step 1: 实现 FileTree 组件**

```tsx
// packages/web/src/components/workspace/FileTree.tsx
import { useFileTreeStore } from '../../stores/file-tree';
import type { TreeEntry } from '@ccclaw/shared';

interface FileTreeProps {
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
}

export function FileTree({ onFileClick, onDeleteClick }: FileTreeProps) {
  const { entries, expandedPaths, toggleDir, previewPath } = useFileTreeStore();

  return (
    <div className="file-tree overflow-y-auto text-sm">
      {entries.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          path={`/${entry.name}`}
          depth={0}
          expandedPaths={expandedPaths}
          selectedPath={previewPath}
          onToggle={toggleDir}
          onFileClick={onFileClick}
          onDeleteClick={onDeleteClick}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  entry: TreeEntry;
  path: string;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  onDeleteClick: (path: string, type: 'file' | 'directory') => void;
}

function TreeNode({ entry, path, depth, expandedPaths, selectedPath, onToggle, onFileClick, onDeleteClick }: TreeNodeProps) {
  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;
  const indent = depth * 16;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group ${
          isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={() => {
          if (isDir) {
            onToggle(path);
          } else {
            onFileClick(path);
          }
        }}
      >
        <span className="w-4 text-center text-gray-400">
          {isDir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span className="flex-1 truncate">
          {entry.name}{isDir ? '/' : ''}
        </span>
        {entry.size != null && !isDir && (
          <span className="text-xs text-gray-400 hidden group-hover:block">
            {formatSize(entry.size)}
          </span>
        )}
        <button
          className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 text-xs px-1"
          onClick={(e) => { e.stopPropagation(); onDeleteClick(path, entry.type); }}
          title="删除"
        >
          ✕
        </button>
      </div>
      {isDir && isExpanded && entry.children?.map((child) => (
        <TreeNode
          key={child.name}
          entry={child}
          path={`${path}/${child.name}`}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onFileClick={onFileClick}
          onDeleteClick={onDeleteClick}
        />
      ))}
      {isDir && isExpanded && !entry.children && (
        <div style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} className="text-xs text-gray-400 py-1">
          加载中...
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
```

- [ ] **Step 2: 实现 FilePreview 组件**

```tsx
// packages/web/src/components/workspace/FilePreview.tsx
import { useFileTreeStore } from '../../stores/file-tree';

interface FilePreviewProps {
  onReload: () => void;
}

export function FilePreview({ onReload }: FilePreviewProps) {
  const { previewPath, previewContent, previewBinary, previewLoading, previewChanged } = useFileTreeStore();

  if (!previewPath) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        点击文件预览内容
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        加载中...
      </div>
    );
  }

  if (previewBinary) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        二进制文件不可预览
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b text-xs text-gray-500">
        <span className="truncate">{previewPath}</span>
        {previewChanged && (
          <button
            className="text-blue-500 hover:text-blue-700 ml-2 whitespace-nowrap"
            onClick={onReload}
          >
            文件已变更，点击重新加载
          </button>
        )}
      </div>
      <pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap break-all bg-gray-50 dark:bg-gray-900">
        {previewContent}
      </pre>
    </div>
  );
}
```

- [ ] **Step 3: 实现 FilePanel 组件**

```tsx
// packages/web/src/components/workspace/FilePanel.tsx
import { useState, useCallback } from 'react';
import { FileTree } from './FileTree';
import { FilePreview } from './FilePreview';
import { useFileTreeStore } from '../../stores/file-tree';

interface FilePanelProps {
  onSendDirectMessage: (msg: any) => void;
}

export function FilePanel({ onSendDirectMessage }: FilePanelProps) {
  const { connectionState, setPreviewLoading, expandedPaths } = useFileTreeStore();
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'directory' | null>(null);
  const [createName, setCreateName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; type: string } | null>(null);

  const requestId = () => `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const handleFileClick = useCallback((path: string) => {
    setPreviewLoading(true);
    onSendDirectMessage({
      channel: 'file',
      action: 'read',
      requestId: requestId(),
      data: { path },
    });
  }, [onSendDirectMessage, setPreviewLoading]);

  const handleDirExpand = useCallback((path: string) => {
    const store = useFileTreeStore.getState();
    store.toggleDir(path);
    // If expanding and no children loaded, fetch
    if (!store.expandedPaths.has(path)) {
      // Was just toggled on (toggleDir runs first)
      return;
    }
    // Lazy load
    onSendDirectMessage({
      channel: 'tree',
      action: 'list',
      requestId: requestId(),
      data: { path, depth: 1 },
    });
  }, [onSendDirectMessage]);

  const handleCreate = useCallback(() => {
    if (!createType || !createName.trim()) return;
    onSendDirectMessage({
      channel: 'file',
      action: 'create',
      requestId: requestId(),
      data: { path: `/${createName.trim()}`, type: createType },
    });
    setCreateType(null);
    setCreateName('');
    setShowCreateMenu(false);
  }, [createType, createName, onSendDirectMessage]);

  const handleDelete = useCallback((path: string) => {
    onSendDirectMessage({
      channel: 'file',
      action: 'delete',
      requestId: requestId(),
      data: { path },
    });
    setDeleteConfirm(null);
  }, [onSendDirectMessage]);

  const handleReloadPreview = useCallback(() => {
    const path = useFileTreeStore.getState().previewPath;
    if (path) {
      setPreviewLoading(true);
      onSendDirectMessage({
        channel: 'file',
        action: 'read',
        requestId: requestId(),
        data: { path },
      });
    }
  }, [onSendDirectMessage, setPreviewLoading]);

  const stateLabel = {
    INIT: '初始化',
    CONNECTING: '连接中...',
    DIRECT: '直连',
    RELAY: '中转',
    DISCONNECTED: '断开',
  }[connectionState];

  const stateColor = {
    INIT: 'text-gray-400',
    CONNECTING: 'text-yellow-500',
    DIRECT: 'text-green-500',
    RELAY: 'text-yellow-500',
    DISCONNECTED: 'text-red-500',
  }[connectionState];

  return (
    <div className="flex flex-col h-full border-l">
      {/* 操作栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="relative">
          <button
            className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded"
            onClick={() => setShowCreateMenu(!showCreateMenu)}
          >
            + 新建
          </button>
          {showCreateMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg z-10">
              <button className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => { setCreateType('file'); setShowCreateMenu(false); }}>
                新建文件
              </button>
              <button className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => { setCreateType('directory'); setShowCreateMenu(false); }}>
                新建目录
              </button>
            </div>
          )}
        </div>
        <span className={`text-xs ${stateColor}`}>{stateLabel}</span>
      </div>

      {/* 新建输入框 */}
      {createType && (
        <div className="flex items-center gap-1 px-3 py-2 border-b bg-blue-50 dark:bg-blue-900/20">
          <input
            className="flex-1 text-sm px-2 py-1 border rounded"
            placeholder={createType === 'file' ? '文件名' : '目录名'}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreateType(null); }}
            autoFocus
          />
          <button className="text-sm px-2 py-1 bg-blue-500 text-white rounded" onClick={handleCreate}>确定</button>
          <button className="text-sm px-2 py-1" onClick={() => setCreateType(null)}>取消</button>
        </div>
      )}

      {/* 目录树 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <FileTree onFileClick={handleFileClick} onDeleteClick={(path, type) => setDeleteConfirm({ path, type })} />
        </div>

        {/* 文件预览 */}
        <div className="h-1/3 border-t">
          <FilePreview onReload={handleReloadPreview} />
        </div>
      </div>

      {/* 删除确认 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm">
            <p className="text-sm mb-3">确定删除 {deleteConfirm.path}？{deleteConfirm.type === 'directory' ? '（含所有子文件）' : ''}</p>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 text-sm" onClick={() => setDeleteConfirm(null)}>取消</button>
              <button className="px-3 py-1 text-sm bg-red-500 text-white rounded" onClick={() => handleDelete(deleteConfirm.path)}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/workspace/ packages/web/src/stores/file-tree.ts
git commit -m "feat(web): add FilePanel with directory tree, file preview, and create/delete UI"
```

---

## Chunk 6: 直连消息路由集成 + 端到端联调

### Task 11: Runner 侧消息路由器

**Files:**
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: 在 index.ts 中添加 handleDirectMessage 路由函数**

```typescript
// 添加到 agent-runtime/src/index.ts

async function handleDirectMessage(
  clientId: string,
  msg: DirectMessage,
  treeHandler: TreeHandler,
  fileHandler: FileHandler,
) {
  try {
    switch (msg.channel) {
      case 'tree': {
        if (msg.action === 'list') {
          const data = msg.data as TreeListData;
          const result = await treeHandler.list(data.path, data.depth ?? 2);
          directServer?.sendToClient(clientId, {
            channel: 'tree', action: 'snapshot', requestId: msg.requestId, data: result,
          });
        }
        break;
      }
      case 'file': {
        if (msg.action === 'read') {
          const data = msg.data as FileReadData;
          const result = await fileHandler.read(data.path);
          directServer?.sendToClient(clientId, {
            channel: 'file', action: 'read_result', requestId: msg.requestId, data: result,
          });
        } else if (msg.action === 'create') {
          const data = msg.data as FileCreateData;
          const result = await fileHandler.create(data.path, data.type, data.content);
          directServer?.sendToClient(clientId, {
            channel: 'file', action: 'create_result', requestId: msg.requestId, data: result,
          });
        } else if (msg.action === 'delete') {
          const data = msg.data as FileDeleteData;
          const result = await fileHandler.delete(data.path);
          directServer?.sendToClient(clientId, {
            channel: 'file', action: 'delete_result', requestId: msg.requestId, data: result,
          });
        } else if (msg.action === 'stat') {
          const data = msg.data as FileStatData;
          const result = await fileHandler.stat(data.path);
          directServer?.sendToClient(clientId, {
            channel: 'file', action: 'stat_result', requestId: msg.requestId, data: result,
          });
        }
        break;
      }
      case 'system': {
        if (msg.action === 'ping') {
          directServer?.sendToClient(clientId, {
            channel: 'system', action: 'pong', data: msg.data,
          });
        }
        break;
      }
      case 'chat': {
        // Phase 1 设计决策：chat 消息暂不走直连通道。
        // 原因：chat 需要 Server 侧的 AgentManager 做上下文组装、Provider 解析、
        // MessageBus 订阅等编排逻辑，直接在 Runner 侧处理会绕过这些流程。
        // 当前 chat 继续走 Server WS 中转（前端 ws.ts），
        // 直连通道仅承载 tree/file/system/terminal 业务。
        // 后续 Phase 2 可将 chat 流式事件通过直连推送以降低延迟。
        break;
      }
    }
  } catch (err: any) {
    directServer?.sendToClient(clientId, {
      channel: msg.channel,
      action: 'error',
      requestId: msg.requestId,
      data: {
        code: err.code || 'IO_ERROR',
        message: err.message || String(err),
      },
    });
  }
}
```

- [ ] **Step 2: typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`

- [ ] **Step 3: 提交**

```bash
git add packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): add direct message router for tree/file/system channels"
```

### Task 12: 前端直连消息响应处理

**Files:**
- Modify: `packages/web/src/stores/file-tree.ts` (if needed)
- 集成 DirectWsClient 到 FilePanel

- [ ] **Step 1: 在 FilePanel 中集成 DirectWsClient 并处理响应消息**

在 FilePanel 组件的父组件（或 ChatLayout）中初始化 DirectWsClient，将响应消息路由到 file-tree store：

```typescript
// 在使用 FilePanel 的地方添加消息处理逻辑
import { DirectWsClient } from '../../api/direct-ws';
import { useFileTreeStore } from '../../stores/file-tree';

// 初始化直连客户端
const directClient = new DirectWsClient({
  workspaceId,
  onStateChange: (state) => {
    useFileTreeStore.getState().setConnectionState(state);
  },
  onMessage: (msg) => {
    const store = useFileTreeStore.getState();
    if (msg.channel === 'tree') {
      if (msg.action === 'snapshot') {
        if (msg.data.path === '/') {
          store.setEntries(msg.data.entries, msg.data.truncated);
        } else {
          store.mergeSubtree(msg.data.path, msg.data.entries);
        }
      } else if (msg.action === 'event') {
        store.applyEvents(msg.data.events);
      }
    } else if (msg.channel === 'file') {
      if (msg.action === 'read_result') {
        store.setPreview(msg.data.path, msg.data.content, msg.data.binary);
      }
      // create_result / delete_result: tree:event 会自动更新目录树
    }
  },
});

// 连接并请求初始目录树
await directClient.connect();
directClient.send({
  channel: 'tree', action: 'list', requestId: 'init', data: { path: '/', depth: 2 },
});
```

- [ ] **Step 2: typecheck**

Run: `cd packages/web && npx tsc --noEmit`

- [ ] **Step 3: 全包 typecheck + 测试**

Run: `pnpm -r run typecheck && cd packages/shared && npx vitest run && cd ../agent-runtime && npx vitest run`
Expected: All typecheck PASS, all tests PASS

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/
git commit -m "feat(web): integrate DirectWsClient with FilePanel for end-to-end direct connection"
```

### Task 13: 全链路验证

- [ ] **Step 1: 全部 4 包 typecheck**

Run: `pnpm -r run typecheck`
Expected: 4 packages PASS

- [ ] **Step 2: 全部测试**

Run: `pnpm -r run test`
Expected: All tests PASS (166 existing + new tests)

- [ ] **Step 3: 提交最终验证**

```bash
git commit --allow-empty -m "chore: full integration verification — typecheck + all tests passing"
```
