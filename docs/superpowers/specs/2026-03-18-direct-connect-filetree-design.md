# Runner 直连加密 + 目录树同步 + 文件操作 设计文档

> **Date:** 2026-03-18
> **Status:** Approved
> **Scope:** Runner ECDH 直连加密通道、workspace 目录树实时同步、轻量文件管理器

---

## 一、总体架构

```
前端 ←── ECDH 直连（加密 WS）──→ Runner
         │
         │ fallback
         ↓
前端 ←── Server WS 中转 ──→ Runner
```

所有与 Runner 的操作统一走直连通道（fallback 时走 Server 中转）。消息按 `channel:action` 命名空间分层路由。

### 消息通道划分

| Channel | 职责 |
|---------|------|
| `chat:*` | 聊天消息、流式事件、confirm |
| `tree:*` | 目录树快照、watch 变更推送 |
| `file:*` | 文件读取、新建、删除 |
| `terminal:*` | 终端交互（已有） |
| `system:*` | 心跳、握手、连接管理 |

### 消息信封格式

```typescript
// 明文消息格式（加密前/解密后）
interface DirectMessage {
  channel: string;    // 'chat' | 'tree' | 'file' | 'terminal' | 'system'
  action: string;     // 具体操作
  requestId?: string; // 请求-响应配对（可选，单向推送时无）
  data: unknown;      // 业务载荷
}

// 加密帧（线上传输格式）— 使用 WebSocket Binary Frame
// 格式: [12 bytes nonce] + [ciphertext with appended GCM auth tag]
// 不使用 JSON 包装，直接 ArrayBuffer 传输，避免 base64 的 33% 开销
```

### 通用错误响应

所有 channel 共用统一错误格式：
```typescript
{
  channel: '<same-as-request>',
  action: 'error',
  requestId: '<same-as-request>',
  data: {
    code: string,     // 错误码
    message: string   // 人类可读描述
  }
}
```

---

## 二、Phase 1 — ECDH 直连加密

### 2.1 Runner 注册阶段

Runner 启动时生成两套 ECDH 密钥对：
- **注册密钥对**：用于 Server↔Runner 的 config 加密通道（生命周期跟随进程）
- 前端直连时为每个连接生成**临时密钥对**（见 2.3），提供前向保密

```
Runner 启动:
  1. 生成注册 ECDH 密钥对（P-256 曲线）
  2. 额外开启 HTTP/WS 直连端口（:0 随机端口，仅绑定内网地址）
  3. 连接 Server WebSocket /ws/runner
  4. 发送 { type: 'register', publicKey: <base64>, directUrl: 'ws://192.168.x.x:PORT' }

Server 收到注册:
  1. 缓存 runner 注册公钥 + directUrl
  2. 生成临时 ECDH 密钥对
  3. 用 runner 公钥 + 临时私钥导出共享密钥
  4. AES-256-GCM 加密 RuntimeConfig（含 API Key）
  5. 发送 { type: 'config', encrypted: <base64>, serverPublicKey: <base64> }

Runner 收到 config:
  1. 用注册私钥 + serverPublicKey 导出共享密钥
  2. AES-256-GCM 解密得到 RuntimeConfig
  3. 缓存到内存（不落盘，进程退出即销毁）
```

### 2.2 前端请求直连信息

```
GET /api/workspaces/:id/runner-info
Response: {
  directUrl: "ws://192.168.x.x:12345",
  fallback: true
}
```

注意：不返回 Runner 公钥。前端在握手阶段从 Runner 获取临时公钥，每次连接不同，提供前向保密。

### 2.3 ECDH 握手（前端 ↔ Runner）

Runner 为每个前端连接生成临时 ECDH 密钥对，确保前向保密。

**认证时机**：Token 在 WebSocket HTTP Upgrade 阶段校验（query parameter `?token=<jwt>`），拒绝未认证的 TCP 连接。

```
前端:
  1. Web Crypto API 生成临时 ECDH 密钥对（P-256）
  2. 连接 runner directUrl?token=<jwt>
  3. 连接建立后发送 { type: 'handshake', clientPublicKey: <base64> }

Runner:
  1. （token 已在 upgrade 阶段验证通过）
  2. 生成本次连接专用的临时 ECDH 密钥对
  3. 用 clientPublicKey + 临时私钥导出共享密钥
  4. 返回 { type: 'handshake_ok', runnerPublicKey: <base64> }

前端:
  1. 用 runnerPublicKey + 自己私钥导出同一共享密钥
  2. 后续所有消息用 AES-256-GCM 加解密
```

### 2.4 加密通信与 Nonce 管理

**加密帧格式**：WebSocket Binary Frame = `[12 bytes nonce] + [ciphertext + GCM tag]`

GCM auth tag 由 Web Crypto API / Node.js crypto 自动追加到 ciphertext 末尾，无需单独传输。

**Nonce 协议**：
- 每个方向独立计数器：client→runner 计数器 和 runner→client 计数器
- 初始值：0（uint64，big-endian 写入 12 bytes 的高 8 位，低 4 位补零）
- 发送方：每发一条消息，自增 send-counter，用作 nonce
- 接收方：维护 expected-counter，收到的 nonce 必须严格等于 expected 值，否则断开连接
- 计数器达到 2^48 时，双方重新握手（renegotiate），生成新密钥对

### 2.5 直连心跳

直连通道使用 `system:ping` / `system:pong` 心跳，间隔 15s。

```typescript
// 前端 → Runner（加密后发送）
{ channel: 'system', action: 'ping', data: { ts: 1710720000 } }

// Runner → 前端
{ channel: 'system', action: 'pong', data: { ts: 1710720000 } }
```

连续 3 次 ping 无响应（45s），判定连接死亡，触发 fallback。

### 2.6 Fallback 状态机

```
         ┌─────────────┐
         │    INIT      │
         └──────┬───────┘
                │ 请求 runner-info
                ▼
         ┌─────────────┐
    ┌───►│ CONNECTING   │ （尝试直连）
    │    └──────┬───────┘
    │           │
    │    成功    │    失败/超时(3s)
    │    ▼      │      ▼
    │  ┌────────┐  ┌─────────┐
    │  │ DIRECT │  │ RELAY   │ （Server 中转）
    │  └────────┘  └────┬────┘
    │                   │ 定时重试(30s)
    └───────────────────┘
```

- 直连失败/中断自动切换到 RELAY（现有 Server WS 链路）
- RELAY 期间每 30s 尝试重新直连
- 切换过程 drain + swap，不丢消息

### 2.7 Config 变更下发

```
用户修改 Provider / Model:
  Server 生成新的临时 ECDH 密钥对
  用 runner 注册公钥 + 新临时私钥导出新共享密钥
  发送 { type: 'config_update', encrypted: <base64>, serverPublicKey: <base64> }
  Runner 用注册私钥 + 新 serverPublicKey 解密更新内存缓存
```

每次 config 更新使用新密钥对，前一次的共享密钥不被复用。

### 2.8 安全考量

| 威胁 | 防护 |
|------|------|
| WS 中间人截获 API Key | ECDH + AES-256-GCM 端到端加密 |
| Runner 进程内存 dump | 密钥不落盘，进程退出即销毁 |
| 重放攻击 | 每方向独立 nonce 严格递增计数器 |
| 伪造 Runner | Server 注册时验证 RUNNER_SECRET |
| 伪造前端直连 | HTTP Upgrade 阶段 JWT 校验，拒绝未认证连接 |
| 直连端口暴露 | 只监听内网地址，不绑 0.0.0.0 |
| 过往会话密钥泄露 | 每连接临时密钥对，前向保密 |
| Config 密钥复用 | 每次 config 更新生成新临时密钥对 |

### 2.9 消息类型迁移映射

现有 `protocol.ts` 的 `type` 字段迁移到 `channel:action` 格式：

| 旧消息类型 | 新 channel:action |
|-----------|------------------|
| `request` (method: 'run') | `chat:message` |
| `response` (text_delta) | `chat:text_delta` |
| `response` (tool_use_start) | `chat:tool_use_start` |
| `response` (tool_use_delta) | `chat:tool_use_delta` |
| `response` (tool_use_end) | `chat:tool_use_end` |
| `response` (tool_result) | `chat:tool_result` |
| `response` (thinking_delta) | `chat:thinking_delta` |
| `response` (confirm_request) | `chat:confirm_request` |
| `confirm_response` | `chat:confirm_response` |
| `response` (consolidation) | `chat:consolidation` |
| `response` (done) | `chat:done` |
| `response` (session_done) | `chat:session_done` |
| `response` (error) | `chat:error` |
| `terminal_open` | `terminal:open` |
| `terminal_input` | `terminal:input` |
| `terminal_resize` | `terminal:resize` |
| `terminal_close` | `terminal:close` |
| `terminal_output` | `terminal:output` |
| `terminal_exit` | `terminal:exit` |
| `ping` / `pong` | `system:ping` / `system:pong` |
| `registered` | `system:registered` |
| `config` | `system:config` |
| `config_update` | `system:config_update` |

---

## 三、Phase 2 — 目录树同步

### 3.1 首次加载

前端连接建立后，发送 `tree:list` 获取初始目录树。

**请求**:
```typescript
{
  channel: 'tree',
  action: 'list',
  requestId: '<uuid>',
  data: {
    path: '/',       // 相对于 home/ 的路径
    depth: 2         // 展开深度，默认 2
  }
}
```

**响应**:
```typescript
{
  channel: 'tree',
  action: 'snapshot',
  requestId: '<uuid>',
  data: {
    path: '/',
    truncated: false,  // true 表示条目数超出上限，需缩小 depth 或 path
    entries: [
      {
        name: 'src',
        type: 'directory',
        children: [
          { name: 'index.ts', type: 'file', size: 1024, mtime: 1710720000 },
          { name: 'utils.ts', type: 'file', size: 512, mtime: 1710720000 }
        ]
      },
      { name: 'package.json', type: 'file', size: 256, mtime: 1710720000 }
    ]
  }
}
```

- 深层目录前端点击展开时，按需发送 `tree:list` 懒加载该子目录
- 单次响应最大 2000 条目，超出返回 `truncated: true`

### 3.2 实时推送（fs.watch）

Runner 启动 `fs.watch` 递归监听 `home/` 目录。

**监听配置**:
- 忽略目录: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.cache`, `.next`, `.nuxt`
- 最大监听深度: 10 层
- debounce 窗口: 200ms（同一文件/目录的连续事件合并）

**推送事件**:
```typescript
{
  channel: 'tree',
  action: 'event',
  data: {
    events: [
      { type: 'created', path: '/src/new-file.ts', entryType: 'file', size: 0, mtime: 1710720100 },
      { type: 'deleted', path: '/old-file.ts', entryType: 'file' },
      { type: 'modified', path: '/src/index.ts', entryType: 'file', size: 2048, mtime: 1710720200 }
    ]
  }
}
```

事件类型: `created` | `deleted` | `modified`

**关于 rename 事件**：`fs.watch` 在多数平台上无法可靠提供 rename 的 oldPath/newPath。重命名操作表现为 `deleted` + `created` 事件对，前端按此处理即可。

前端收到后增量更新内存中的树结构，无需重新拉取全量。对于 `modified` 事件，如果当前预览的文件被修改，前端应显示"文件已变更"提示或自动重新加载。

### 3.3 重连恢复

直连重连或 fallback 切换后，前端重新发送 `tree:list` 拉取全量快照，覆盖本地缓存。

### 3.4 tree 错误响应

```typescript
{
  channel: 'tree',
  action: 'error',
  requestId: '<uuid>',
  data: {
    code: 'PATH_OUTSIDE_WORKSPACE' | 'NOT_FOUND' | 'IO_ERROR',
    message: '目录不存在'
  }
}
```

---

## 四、Phase 3 — 轻量文件管理器

### 4.1 文件操作消息

| 消息 | 方向 | 功能 |
|------|------|------|
| `file:read` | 前端→Runner→前端 | 读取文件内容（只读预览） |
| `file:create` | 前端→Runner→前端 | 新建文件或目录 |
| `file:delete` | 前端→Runner→前端 | 删除文件或目录 |
| `file:stat` | 前端→Runner→前端 | 获取文件元信息（不含内容） |

### 4.2 file:read

**请求**:
```typescript
{
  channel: 'file',
  action: 'read',
  requestId: '<uuid>',
  data: { path: '/src/index.ts' }
}
```

**响应**:
```typescript
{
  channel: 'file',
  action: 'read_result',
  requestId: '<uuid>',
  data: {
    path: '/src/index.ts',
    content: 'import ...',
    size: 1024,
    mtime: 1710720000,
    binary: false        // true 时 content 为 null，前端提示"二进制文件不可预览"
  }
}
```

二进制检测：读取前 8192 bytes，检查是否包含 null byte（0x00）。

### 4.3 file:create

**请求**:
```typescript
{
  channel: 'file',
  action: 'create',
  requestId: '<uuid>',
  data: {
    path: '/src/new-file.ts',
    type: 'file',            // 'file' | 'directory'
    content?: ''             // 仅 type='file' 时有效，可选初始内容
  }
}
```

**响应**:
```typescript
{
  channel: 'file',
  action: 'create_result',
  requestId: '<uuid>',
  data: { success: true, path: '/src/new-file.ts' }
}
```

创建完成后 `fs.watch` 自动触发 `tree:event` 推送，前端无需手动刷新目录树。

**事件时序说明**：`tree:event` 推送和 `create_result` 响应的到达顺序不保证。前端应能处理 `tree:event` 先于 `create_result` 到达的情况（去重即可）。

### 4.4 file:delete

**请求**:
```typescript
{
  channel: 'file',
  action: 'delete',
  requestId: '<uuid>',
  data: { path: '/src/old-file.ts' }
}
```

**响应**:
```typescript
{
  channel: 'file',
  action: 'delete_result',
  requestId: '<uuid>',
  data: { success: true, path: '/src/old-file.ts' }
}
```

目录删除为递归删除。前端在发送前需弹出确认对话框。

### 4.5 file:stat

**请求**:
```typescript
{
  channel: 'file',
  action: 'stat',
  requestId: '<uuid>',
  data: { path: '/src/index.ts' }
}
```

**响应**:
```typescript
{
  channel: 'file',
  action: 'stat_result',
  requestId: '<uuid>',
  data: {
    path: '/src/index.ts',
    type: 'file',        // 'file' | 'directory'
    size: 1024,
    mtime: 1710720000,
    binary: false
  }
}
```

### 4.6 错误响应

所有 `file:*` 操作的错误统一格式：
```typescript
{
  channel: 'file',
  action: 'error',
  requestId: '<uuid>',
  data: {
    code: 'PATH_OUTSIDE_WORKSPACE' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'PERMISSION_DENIED' | 'IO_ERROR' | 'FILE_TOO_LARGE',
    message: '路径越界：禁止访问工作区外的文件'
  }
}
```

### 4.7 安全约束

- 所有路径限制在 `home/` 内，使用路径校验工具（resolve + symlink 检查），该工具提取到 `packages/shared` 供 server 和 agent-runtime 共用
- 二进制文件（前 8192 bytes null byte 检测）只返回元信息，不返回 content
- 单文件读取上限 1MB，超出返回 `FILE_TOO_LARGE` 错误

---

## 五、前端 UI

### 5.1 右侧面板布局

```
┌──────────────────────┐
│ /src                 │  ← 面包屑路径
│ [+ 新建] [连接状态]  │  ← 操作栏 + 状态指示（直连 / 中转 / 断开）
├──────────────────────┤
│ > src/               │  ← 目录树（可展开/收起）
│     index.ts         │
│     utils.ts         │
│ > test/              │
│   package.json       │
│   README.md          │
├──────────────────────┤
│ ┌──────────────────┐ │  ← 文件预览区（点击文件时显示）
│ │ // index.ts      │ │
│ │ import { ... }   │ │
│ │ ...              │ │
│ └──────────────────┘ │
└──────────────────────┘
```

### 5.2 交互说明

- 点击目录：展开/收起，未加载的目录触发 `tree:list` 懒加载
- 点击文件：下方预览区显示文件内容（只读，纯文本渲染）
- 新建按钮：下拉选择「新建文件」/「新建目录」，弹出输入框输入名称
- 删除：目录树节点右侧操作按钮或右键菜单，弹出确认对话框
- 连接状态指示：实时显示当前通信模式
- 文件变更提示：预览中的文件被 Agent 修改时，显示"文件已变更，点击重新加载"

---

## 六、实施顺序

| Phase | 内容 | 涉及包 |
|-------|------|--------|
| 1a | ECDH 密钥工具（P-256 密钥生成/导出/共享密钥派生）+ 路径校验工具提取到 shared | shared |
| 1b | Runner 注册带公钥 + Server 加密 config 下发 + Runner 解密 | server, agent-runtime |
| 1c | Runner 直连 WS 端口（HTTP Upgrade 认证）+ runner-info API | agent-runtime, server |
| 1d | 前端 Web Crypto ECDH 握手 + 加密通道 + fallback 状态机 + 心跳 | web |
| 1e | 消息命名空间路由器 + 现有 chat/terminal 消息迁移到 channel:action 格式 | agent-runtime, server, web |
| 2a | Runner fs.watch 递归监听 + tree:list/snapshot 处理 | agent-runtime |
| 2b | tree:event 推送 + debounce + 忽略规则 | agent-runtime |
| 2c | 前端目录树组件 + 懒加载 + 增量更新 | web |
| 3a | Runner file:read/create/delete/stat 处理 | agent-runtime |
| 3b | 前端文件预览 + 新建/删除 UI + 变更提示 | web |
