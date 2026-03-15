# CCCLaw 系统设计文档

> 登录即用的 AI Agent 服务平台 — 当前基于 Claude Agent SDK，架构支持多 Provider 扩展，支持云端部署和本地私有化，开箱即用。

---

## 一、核心定位

**登录即用的云端 OpenClaw**：注册登录后，即可在浏览器中获得完整的 AI Agent 开发体验。

- 开箱即用：登录即用，无需本地安装任何开发工具
- 灵活部署：支持云端 VPS 或本地私有化部署，数据全在自己手中
- 沙箱隔离：每个工作区独立运行环境（Docker 容器 / 本地进程 / 远端 Runner），互不干扰
- 完整能力：内置工具集、Skill、Memory、计划模式（当前基于 Claude Agent SDK，后续支持多 Provider）
- 随时随地：浏览器 + 在线终端 + 手机，随时进行开发、审查、运维
- 多渠道接入：WebUI 优先，后续支持 Telegram / 飞书 / 企微
- 邀请制注册：管理员通过邀请码控制用户准入

## 二、技术选型

### 基建（需安装/部署）

| 组件 | 用途 |
|------|------|
| PostgreSQL / MySQL / SQLite | 数据持久化（通过 `DB_DIALECT` 环境变量切换） |
| Docker | Agent 沙箱容器 + 服务编排 |
| Node.js 22 | 运行时 |

> **三数据库支持**：初期可用 SQLite 低配部署，快速验证核心流程；生产环境推荐 PostgreSQL；企业内网可选 MySQL。Drizzle ORM 同时支持三种方言，schema 分别定义在 `schema.pg.ts`、`schema.mysql.ts` 和 `schema.sqlite.ts`，运行时通过 `DB_DIALECT` 环境变量选择。

### 框架（npm 依赖）

| 包 | 用途 |
|---|------|
| Hono | HTTP 框架，API 路由 + 静态文件托管 |
| Drizzle | ORM，类型安全（支持 PostgreSQL + MySQL + SQLite 三方言） |
| better-sqlite3 | SQLite 驱动（低配模式） |
| mysql2 | MySQL 驱动（企业模式） |
| postgres | PostgreSQL 驱动（生产模式） |
| ws | WebSocket 实时通信 |
| node-cron | 定时任务调度 |
| p-queue | 并发控制 |
| pino | 结构化日志 |
| jose | JWT 认证 |
| dockerode | Docker API 管理沙箱 |
| @anthropic-ai/claude-code | Agent SDK（当前 Claude，架构支持多 Provider） |
| zod | 输入校验 |
| bcryptjs | 密码哈希 |
| node-pty | PTY 进程（在线终端，agent-runtime 侧） |
| React + Vite | WebUI 前端 |
| xterm + xterm-addon-fit | 浏览器终端组件（WebUI 侧） |

### 部署架构

支持云端 VPS 和本地私有化两种部署方式，Docker Compose 编排：

**云端生产模式（PostgreSQL）：**

```yaml
services:
  caddy:        # 反向代理 + 自动 HTTPS
  server:       # 主服务（API + WebUI 静态文件）
  postgres:     # 数据库
```

**企业内网模式（MySQL）：**

```yaml
services:
  caddy:        # 反向代理 + 自动 HTTPS
  server:       # 主服务（API + WebUI 静态文件）
  mysql:        # 数据库
```

**本地 / 低配模式（SQLite）：**

```yaml
services:
  caddy:        # 反向代理 + 自动 HTTPS（本地可选 HTTP）
  server:       # 主服务（API + WebUI 静态文件，内嵌 SQLite）
```

> SQLite 模式无需独立数据库服务，数据文件存储在 `/data/ccclaw/ccclaw.db`，适合本地私有化部署和个人使用。所有数据（主数据库 + 工作区文件 + workspace.db）都在本地磁盘，不外传。

沙箱容器由 server 通过 Docker API 动态创建管理。

### 最低 VPS 配置

| 资源 | PostgreSQL 模式 | SQLite 模式（低配） |
|------|----------------|-------------------|
| 内存 | 8GB（PostgreSQL ~1GB + Server ~512MB + 最多 5 个沙箱 × 512MB + 系统） | 4GB（Server ~512MB + 最多 3 个沙箱 × 512MB + 系统） |
| CPU | 4 vCPU | 2 vCPU |
| 磁盘 | 100GB SSD | 50GB SSD |
| 系统 | Ubuntu 22.04+ / Debian 12+ | Ubuntu 22.04+ / Debian 12+ |

最大并发沙箱数默认 5（SQLite 模式默认 3），超出排队等待（p-queue 控制）。

## 三、整体架构

```
                    ┌─────────────────────────────┐
   WebUI ──────────▶│       CCCLaw API Server      │
   TG Bot ─────────▶│         (Hono + ws)          │
   飞书 ───────────▶│                               │
                    │  ┌─────┐ ┌──────┐ ┌────────┐ │
                    │  │Auth │ │Router│ │Scheduler│ │
                    │  └─────┘ └──────┘ └────────┘ │
                    │       ┌──────────────┐        │
                    │       │ RunnerManager │        │
                    │       └──────┬───────┘        │
                    │    /ws/runner │ WebSocket      │
                    └──────────────┼────────────────┘
                                   │ Runner 主动连接
              ┌────────────────────▼────────────────────┐
              │         Runners (agent-runtime)          │
              │  ┌──────────┐ ┌────────┐ ┌───────────┐  │
              │  │Docker 容器│ │本地进程│ │远端（内网）│  │
              │  │  Runner1  │ │Runner2 │ │  Runner3  │  │
              │  └──────────┘ └────────┘ └───────────┘  │
              └─────────────────────────────────────────┘
```

### 数据流

```
用户消息(WebUI/TG/飞书)
  → Channel Adapter（统一格式）
  → Auth 鉴权（JWT/API Key）
  → Workspace Router（找到目标工作区）
  → Provider 解析（工作区绑定 > 用户默认）
  → Agent Manager（创建/复用 Agent 会话）
  → RunnerManager（路由到工作区绑定的 Runner）
  → Runner 进程执行 Agent（通过 WebSocket 通信）
  → 流式响应回传 → Channel Adapter → 用户
```

### 主服务模块划分

```
packages/server/
├── api/              # HTTP 路由层
│   ├── auth.ts       # 认证
│   ├── workspaces.ts   # 工作区 CRUD
│   ├── sessions.ts   # 会话管理（代理 Runner 查询 workspace.db）
│   ├── preferences.ts # 用户偏好
│   ├── memories.ts   # 工作区记忆管理（代理 Runner 查询 workspace.db）
│   ├── skills.ts     # 技能管理
│   ├── mcp-servers.ts # MCP Server 管理
│   ├── tasks.ts      # 定时任务
│   ├── providers.ts  # Provider 管理（API Key / OAuth）
│   ├── users.ts      # 用户管理
│   ├── logs.ts       # 日志查询
│   └── channels.ts   # 渠道 webhook
├── core/
│   ├── agent/        # Agent 生命周期管理
│   ├── provider/     # Provider 抽象层（解析凭证、调用适配）
│   ├── workspace/      # 工作区管理
│   ├── scheduler/    # 定时任务（node-cron + p-queue）
│   └── runner/       # Runner 管理（统一 WS 通信）
├── skills/             # 系统预置 Skill（创建工作区时复制）
│   ├── find-skills/    # 技能发现（浏览和安装社区 Skill）
│   ├── skill-creator/  # 技能开发（创建、修改、测试自定义 Skill）
│   ├── superpowers/    # 开发工作流（brainstorming、writing-plans、TDD 等 12 个）
│   └── anthropic/      # 文档与工具（schedule、pdf/docx/xlsx/pptx）
├── auth/
│   ├── jwt.ts        # JWT 签发/验证
│   └── rbac.ts       # 角色权限校验
├── channel/          # 渠道适配器
│   ├── adapter.ts    # 统一接口
│   ├── webui.ts      # WebSocket
│   ├── telegram.ts   # （后续）
│   └── feishu.ts     # （后续）
├── db/
│   ├── schema.ts     # Drizzle schema
│   └── migrations/
└── logger/           # Pino 结构化日志
```

## 四、Agent 运行时架构

### 运行环境类型

每个工作区可独立选择运行环境，通过 `workspaces.settings.runtimeType` 配置：

所有运行环境统一采用 **Runner 架构**：Runner 是独立的 agent-runtime 进程，主动通过 WebSocket 连接 Server 注册。区别仅在 **Runner 的启动方式**：

| 启动方式 | 说明 | 由谁启动 | 适用场景 |
|---------|------|---------|---------|
| `docker` | Docker 容器内运行 Runner | Server 创建容器 | 生产环境，安全隔离 |
| `local` | 宿主机上 fork Runner 子进程 | Server 自动 fork | 开发调试，低配部署 |
| `remote` | 远端手动部署 Runner | 用户手动启动 | 内网环境、远程服务器 |

> **通信方式完全一致**：无论哪种启动方式，Runner 启动后都主动通过 WebSocket 连接 Server 的 `/ws/runner` 端点注册。Server 通过已建立的 WebSocket 下发任务、接收响应。不再使用 Unix Socket 通信。

### RunnerManager

只需一个 `RunnerManager` 统一管理所有 Runner，职责：
1. 维护 Runner 注册表（WebSocket 连接池）
2. 根据工作区配置的 `startMode` 决定如何启动 Runner
3. 通过 WebSocket 下发任务和接收响应
4. 心跳检测和自动清理

```typescript
interface RunnerManager {
  /** 注册 Runner（由 WebSocket 路由 /ws/runner 调用） */
  registerRunner(ws: WebSocket, runnerId: string): void;
  /** 确保工作区绑定的 Runner 就绪（按需启动 docker/local） */
  ensureRunner(workspaceSlug: string, config: RuntimeConfig): Promise<void>;
  /** 发送 Agent 请求并流式接收响应 */
  send(workspaceSlug: string, request: AgentRequest, onMessage: (msg: AgentResponse) => void): Promise<void>;
  /** 获取 Runner 状态 */
  getStatus(workspaceSlug: string): 'running' | 'stopped' | 'error';
  /** 停止工作区绑定的 Runner */
  stop(workspaceSlug: string): Promise<void>;
  /** 清理超时 Runner */
  cleanIdle(): Promise<void>;
}
```

### agent-runtime 进程

无论运行在哪种环境，agent-runtime 进程结构一致：

```
agent-runtime 进程（Runner）
  ┌───────────────────────┐
  │  Agent SDK (当前 Claude) │
  │  ├── 工具集            │
  │  │   ├── 文件读写      │
  │  │   ├── Bash 执行     │
  │  │   ├── Git 操作      │
  │  │   ├── Glob/Grep    │
  │  │   └── Web Fetch    │
  │  └── 通信层            │
  │      └── WebSocket     │ ← 主动连接 Server
  └───────────────────────┘
  /workspace/     ← 工作区文件（读写）
  /workspace.db   ← 会话 + 消息 + 记忆（SQLite 读写）
  /skills/        ← 工作区技能（只读）
```

### Runner 模块划分

```
packages/agent-runtime/
├── index.ts                  # 入口：WebSocket 主动连接 Server 注册
├── agent.ts                  # Agent SDK 封装（当前 Claude，架构支持多 Provider）
├── protocol.ts               # JSON-RPC 协议处理（Server ↔ Runner 通信）
├── workspace-db.ts           # workspace.db 读写（sessions / messages / memories）
├── context-assembler.ts      # 上下文组装（偏好 + 记忆 + skills + 历史 → system prompt）
├── skill-loader.ts           # 加载工作区 skills/ 目录下的 .md 文件
├── mcp-manager.ts            # MCP Server 子进程启动与工具注入
├── terminal-manager.ts       # node-pty 终端管理（≤2 个/工作区，10min 空闲超时）
├── heartbeat.ts              # WebSocket 心跳保活（30s ping，60s 断线重连）
├── tools/                    # 内置工具集
│   ├── index.ts              # 工具注册入口
│   ├── bash.ts               # Bash 执行
│   ├── file.ts               # 文件读写
│   ├── git.ts                # Git 操作
│   ├── glob.ts               # 文件搜索
│   ├── grep.ts               # 内容搜索
│   ├── web-fetch.ts          # 网页抓取
│   ├── memory.ts             # memory_write / memory_read / memory_search
│   └── todo.ts               # todo_read / todo_write
└── utils/
    ├── path-guard.ts         # 路径白名单校验 + 符号链接检查
    └── safe-env.ts           # 安全环境变量构建（过滤敏感变量）
```

### 工作区运行时配置

`workspaces.settings` 中新增字段：

```jsonc
{
  "startMode": "docker",  // "docker" | "local" | "remote"
  "runnerId": "ws-xxx-runner",  // Runner 标识（自动生成或手动配置）
  "runtimeConfig": {
    // docker 模式（可选覆盖默认值）
    "memory": "512m",
    "cpu": "50%",
    "timeout": 1800
  }
}
```

> `startMode` 决定 Runner 的启动方式：`docker` 由 Server 创建容器，`local` 由 Server fork 子进程，`remote` 等待用户手动部署的 Runner 连接。所有模式通信方式一致（WebSocket）。

### 工作区文件存储

宿主机存储路径：

```
/data/ccclaw/
├── users/
│   └── {user-id}/
│       └── skills/            # 用户级技能文件
├── workspaces/
│   └── {workspace-slug}/
│       ├── workspace/         # 工作区代码（docker/local 模式使用）
│       ├── workspace.db       # 工作区数据（sessions + messages + memories，SQLite + WAL + sqlite-vec）
│       └── skills/            # 工作区级技能文件
└── backups/                   # pg_dump 备份
```

工作区创建时的初始化流程：
1. 创建工作区目录结构（`workspace/`、`skills/`）
2. 初始化 `workspace.db`（创建 sessions、messages、memories 三张表，启用 WAL 模式）
3. 将系统预置 Skill 复制到 `skills/` 目录
3. 配置了 gitRepo → 使用用户级 gitToken 执行 `git clone` 到 `workspace/` 目录
4. 未配置 gitRepo → `workspace/` 保持空目录
- Git 操作（push/pull）由 Agent 在对话中按需执行，不自动同步

### 工作区文件管理

用户可在工作区内创建、查看、编辑、删除文件和文件夹。文件直接操作宿主机 `workspace/` 目录下的文件系统，无需数据库存储。

**安全约束：**
- 所有路径必须在 `workspace/` 目录范围内，防止路径遍历攻击（`../../etc/passwd`）
- 使用 `path.resolve()` 解析后验证前缀
- 文件名禁止特殊字符（`..`、`\0`）
- 单文件大小限制 10MB
- 仅工作区创建者可读写

**API 行为：**

| 操作 | 方法 | 说明 |
|------|------|------|
| 列目录 | GET ?path=/ | 返回 `{ name, type, size, modifiedAt }[]` |
| 读文件 | GET /*path | 返回文件内容（text 或 base64） |
| 创建 | POST `{ path, type: 'file'/'dir', content? }` | 创建文件或文件夹 |
| 更新 | PUT /*path `{ content }` | 更新文件内容 |
| 删除 | DELETE /*path | 删除文件或空文件夹（非空需 `?force=true`） |
| 移动 | POST /move `{ from, to }` | 移动或重命名 |

### 在线终端（Web Terminal）

每个工作区在 WebUI 提供一个基于浏览器的在线终端，用户可直接在浏览器中操作工作区的文件系统、运行命令。

**技术方案**：
- 前端：`xterm.js` + `xterm-addon-fit`（自适应容器大小）
- 后端：Runner 侧通过 `node-pty` fork PTY 进程
- 通信：WebSocket 新增 `terminal_*` 消息类型，Server 透传到 Runner

**WebSocket 协议扩展**：

```
客户端 → 服务端：
  { type: 'terminal_open', sessionId, workspaceId }     // 打开终端
  { type: 'terminal_input', sessionId, data }            // 用户输入（stdin）
  { type: 'terminal_resize', sessionId, cols, rows }     // 终端窗口大小变更
  { type: 'terminal_close', sessionId }                  // 关闭终端

服务端 → 客户端：
  { type: 'terminal_output', sessionId, data }           // 终端输出（stdout/stderr）
  { type: 'terminal_exit', sessionId, code }             // 终端进程退出
```

**Server ↔ Runner 协议扩展**：

```typescript
// Server → Runner
{ method: 'terminal_open', params: { terminalId, cols, rows } }
{ method: 'terminal_input', params: { terminalId, data } }
{ method: 'terminal_resize', params: { terminalId, cols, rows } }
{ method: 'terminal_close', params: { terminalId } }

// Runner → Server
{ type: 'terminal_output', terminalId, data }
{ type: 'terminal_exit', terminalId, code }
```

**安全约束**：
- 终端工作目录固定为工作区 `workspace/` 目录
- 复用 Runner 的目录权限和路径白名单
- Docker 模式下在容器内执行，天然隔离
- 本地/远端模式下通过 `ALLOWED_PATHS` 环境变量限制范围
- 每个工作区最多同时开启 2 个终端会话
- 空闲 10 分钟自动关闭终端进程

**依赖**：
- `node-pty`：PTY 进程管理（agent-runtime 包新增依赖）
- `xterm`、`xterm-addon-fit`：前端终端组件（web 包新增依赖）

### 运行时生命周期

| 状态 | 触发 | docker 启动 | local 启动 | remote 启动 |
|------|------|-----------|-----------|------------|
| 启动 | 工作区首次使用 | 创建容器，Runner WS 连接 | fork 子进程，Runner WS 连接 | 等待远端 Runner 连接 |
| 运行中 | 有活跃会话 | 通过 WS 下发任务 | 通过 WS 下发任务 | 通过 WS 下发任务 |
| 休眠 | 空闲 30 分钟 | 停止容器 | 终止子进程 | 保持 WS 连接 |
| 唤醒 | 新消息到达 | 启动容器 | 重新 fork | 检查 Runner 在线状态 |
| 销毁 | 工作区删除 | 删除容器 | 终止子进程 | 解除绑定 |

### Docker 模式安全配置

```typescript
{
  User: 'agent',                    // 非 root
  Memory: 512 * 1024 * 1024,        // 内存上限 512MB
  CpuQuota: 50000,                  // CPU 50%
  ReadonlyRootfs: true,             // 根文件系统只读
  Tmpfs: { '/tmp': 'size=100m' },
  Labels: { 'ccclaw.workspace': 'true' },
  NetworkMode: 'bridge',            // 网络开放（需要 git/npm 等）
}
```

> 所有 Runner 统一通过 WebSocket 连接 Server。Docker 模式额外提供容器级隔离；本地/远端模式通过目录权限、路径白名单、符号链接防护和环境变量隔离保障安全。详见"十、安全设计 > 运行环境安全"。

### 通信协议

无论哪种运行环境，Server 与 agent-runtime 之间使用相同的 JSON-RPC 协议（换行分隔）：

```typescript
// Server → Agent Runtime
{ method: 'run', params: { sessionId, message, apiKey, context: { memories, skills, history, systemPrompt } } }

// Agent Runtime → Server（流式）
{ type: 'thinking_delta', content: '...' }              // 模型思考过程
{ type: 'text_delta', content: '...' }                  // 模型回复文本
{ type: 'tool_use', tool: 'bash', input: '...' }
{ type: 'tool_result', output: '...' }
{ type: 'confirm_request', tool: 'bash', input: '...', reason: '...' }
{ type: 'done', sessionId, tokens }
```

通信传输层统一为 WebSocket（反向连接：Runner 主动连接 Server），所有启动模式一致。

### Remote Runner 注册机制

Remote 模式采用**反向连接**架构，适用于内网环境（Runner 无公网 IP）：

```
Runner（内网）──── WebSocket ────▶ Server（公网）
                  主动连接注册
                  ◀──── 任务下发 ────
                  ──── 结果回传 ────▶
```

**注册流程：**

1. Runner 启动后主动通过 WebSocket 连接 Server 的 `/ws/runner` 端点
2. 发送注册消息 `{ type: 'register', token: '...', runnerId: '...' }`
3. Server 验证 token 后将 Runner 加入可用 Runner 注册表
4. 工作区配置 `runtimeConfig.runnerId` 绑定到具体 Runner

**心跳保活：** Runner 每 30 秒发送 `{ type: 'ping' }`，Server 回复 `{ type: 'pong' }`。60 秒无心跳视为断线，标记 Runner 为 offline。

**工作区配置（remote 模式）：**

```jsonc
{
  "runtimeType": "remote",
  "runtimeConfig": {
    "runnerId": "runner-office-01",  // 绑定的 Runner ID
    "token": "runner-auth-token"     // Runner 注册用的 token（加密存储）
  }
}
```

**WebSocket 协议（Server ↔ Runner）：**

```typescript
// Runner → Server
{ type: 'register', token: 'auth-token', runnerId: 'runner-01' }
{ type: 'ping' }
{ type: 'response', requestId: '...', data: AgentResponse }

// Server → Runner
{ type: 'registered', runnerId: 'runner-01' }
{ type: 'pong' }
{ type: 'request', requestId: '...', data: AgentRequest }
```

## 五、数据模型

### 用户

```
users {
  id:         uuid PK
  name:       string
  email:      string unique
  password:   string (bcrypt)
  role:       'admin' | 'user'
  gitToken:   string? (AES-256-GCM 加密)
  createdAt:  timestamp
}
```

### 邀请码

用户注册采用管理员邀请码方式，不开放自由注册。管理员在控制面生成邀请码，分发给目标用户。

```
invite_codes {
  id:         uuid PK
  code:       string unique          // 邀请码（随机生成，如 8 位字母数字）
  createdBy:  uuid FK (users.id)     // 创建者（admin）
  usedBy:     uuid? FK (users.id)    // 使用者（注册成功后回填）
  usedAt:     timestamp?             // 使用时间
  expiresAt:  timestamp?             // 过期时间（null 表示永不过期）
  createdAt:  timestamp
}
```

**注册流程**：
1. 管理员在控制面「用户管理」中生成邀请码（可批量生成）
2. 用户在注册页输入邀请码 + 个人信息完成注册
3. 邀请码一次性使用，使用后标记 `usedBy` 和 `usedAt`
4. 过期或已使用的邀请码无法再次注册

**API**：
- `POST /api/admin/invite-codes` — 管理员创建邀请码（可指定过期时间）
- `GET /api/admin/invite-codes` — 管理员查看邀请码列表及使用状态
- `DELETE /api/admin/invite-codes/:id` — 删除未使用的邀请码
- `POST /api/auth/register` — 用户注册（需携带有效邀请码）

### 工作区

```
workspaces {
  id:         uuid PK
  name:       string
  slug:       string unique
  createdBy:  uuid FK (users.id)
  gitRepo:    string?
  settings:   jsonb {
    providerId?: uuid,          // 绑定的 Provider，覆盖系统默认
    containerConfig?: { memory, cpu, timeout }
  }
  createdAt:  timestamp
}
```

工作区通过 `createdBy` 归属用户，不存在多用户协作，无需成员表。

### Provider（模型服务商）

Provider 是对模型服务商的抽象。系统维护支持的 Provider 类型列表（如 Claude、OpenAI），用户自行配置自己的认证凭证（API Key 或 OAuth），并给不同工作区分配不同的 Provider。

**系统支持列表**（代码中硬编码，后续可改为配置）：

| type | 说明 | 认证方式 | 当前状态 |
|------|------|---------|---------|
| `claude` | Anthropic Claude | api_key | 已支持 |
| `openai` | OpenAI | api_key | 预留 |
| `deepseek` | DeepSeek | api_key | 预留 |

**用户 Provider 配置**（主数据库）：

```
providers {
  id:         uuid PK
  userId:     uuid FK (users.id)  // 归属用户
  name:       string              // 显示名称，如 "我的 Claude Key"
  type:       string              // 必须是系统支持列表中的类型
  authType:   'api_key' | 'oauth' // 认证方式
  config:     jsonb (加密)        // 认证配置，按 authType 不同：
                                  //   api_key: { key, apiBase? }
                                  //   oauth:   { clientId, clientSecret, tokenUrl, ... }
  isDefault:  boolean             // 该用户的默认 Provider（每用户最多一个为 true）
  createdAt:  timestamp
}
```

**优先级**：工作区绑定（`settings.providerId`）> 用户默认（`isDefault=true`）

> 用户必须至少配置一个 Provider 才能使用工作区。未配置时工作区无法发起 Agent 对话。

**当前阶段**：
- 仅实现 `type='claude'` + `authType='api_key'`，通过 Agent SDK 调用
- `config` 字段存 `{ key: "sk-...", apiBase?: "https://..." }`，整体 AES-256-GCM 加密
- 用户在「个人设置 → Provider」中管理，创建工作区时选择绑定哪个

**后续扩展**：
- 系统支持列表中新增 type 即可支持新的模型服务商
- `authType='oauth'` 支持 OAuth 登录获取 token（如某些企业级 API 网关）
- `core/provider/` 目录放各 type 的适配器，统一接口

### 会话与消息（工作区 SQLite）

会话和消息强绑定工作区，是数据量最大的表。存放在工作区的 `workspace.db` 中，Runner 本地直接读写，组装上下文无需走 API。

```
sessions {
  id:         text PK (uuid)
  workspaceId:  text             // 冗余存储，方便查询
  userId:     text
  channelType: text              // 'webui' | 'telegram' | 'feishu'
  title:      text
  status:     text               // 'active' | 'archived'
  summary:    text?              // 历史消息超过 20 条时的压缩摘要
  createdAt:  text (ISO 8601)
}

messages {
  id:         text PK (uuid)
  sessionId:  text FK
  role:       text               // 'user' | 'assistant' | 'system'
  content:    text
  toolCalls:  text? (JSON)
  tokens:     integer?
  createdAt:  text (ISO 8601)
}
```

> sessions 和 messages 原在主数据库，现移至工作区 `workspace.db`。好处：Runner 本地读取历史消息组装上下文、减轻主数据库压力、工作区备份/迁移时对话历史一体打包。Server 通过 RunnerManager 代理 Runner 查询，不直接操作 workspace.db。

### 用户偏好（主数据库）

用户级的偏好设置，量少、结构化，存主数据库。Server 在组装上下文时直接读取，注入到 system prompt。

```
user_preferences {
  id:         uuid PK
  userId:     uuid FK UNIQUE      // 一个用户一条记录
  language:   string?             // 回复语言偏好，如 'zh-CN'
  style:      string?             // 回复风格，如 '简洁' | '详细'
  customRules: text?              // 用户自定义规则（自由文本，如"不要加 emoji"、"代码注释用英文"）
  updatedAt:  timestamp
}
```

用户通过「个人设置」页面管理，也可在对话中通过 Agent 自动更新（如用户说"以后回复用中文"）。

### 工作区记忆（workspace.db + 向量检索）

工作区记忆与会话/消息共同存放在工作区的 `workspace.db` 中，跟随工作区一起存储在 Runner 侧。Agent 直接本地读写，不走 API。

**存储位置**：
```
/data/ccclaw/workspaces/{workspace-slug}/workspace.db   # SQLite + WAL
```

> `workspace.db` 包含三张表：`sessions`（会话）、`messages`（消息）、`memories`（记忆）。所有工作区内容数据集中在一个 SQLite 文件中，便于备份/迁移。

**memories 表结构**：
```
memories {
  id:         text PK (uuid)
  name:       text UNIQUE
  type:       text               // 'project' | 'reference' | 'decision' | 'feedback' | 'log'
  content:    text
  embedding:  blob?               // 向量嵌入（sqlite-vec）
  updatedAt:  text (ISO 8601)
}
```

**Memory type 含义**：
- `project`：项目知识（"这个工作区用 Next.js 14 + Drizzle ORM"）
- `reference`：资源指引（"Bug 追踪在 Linear 的 INGEST project"）
- `decision`：架构/技术决策（"选择 WebSocket 而非 SSE 做流式通信，因为需要双向"）
- `feedback`：工作区内对 Agent 行为的纠正（"这个项目不要 mock 数据库测试"）
- `log`：工作日志（"修复了 auth 模块 token 过期 bug，改了 middleware.ts 和 jwt.ts"、"完成用户注册功能，通过全部测试"）

`log` 类型特点：高频写入、异步不阻塞对话、不全量注入上下文，仅在向量搜索命中时带入。适合记录每次会话的关键操作、代码变更摘要、调试过程与结论等，确保跨 Session 切换时任务进展不丢失。

**向量检索**：
- 使用 `sqlite-vec` 扩展，embedding 列存储向量
- 写入记忆时调用 Embedding API 生成向量（可用开源模型如 `bge-small` 本地生成，或对接 Provider 的 embedding 接口，或暂不启用向量检索）
- 上下文组装时：全量注入 `decision` + `feedback`（量少且重要）+ 按向量相似度检索 `project` / `reference` / `log` 的 top-K 条
- **降级策略**：向量检索为可选能力，未配置 embedding 模型时退化为全量加载（记忆条数少时够用，`log` 按时间倒序取最近 N 条）

**WAL 模式**：首次打开时执行 `PRAGMA journal_mode=WAL`，支持同一工作区多个 Session 并发读写。

**数据存储分层**：
- 用户偏好 = 这个人是谁、喜欢什么风格 → 主数据库，所有工作区共享
- 工作区数据 = 对话历史 + 项目知识积累 → `workspace.db`，跟随工作区
- 全局统计 = token 用量、审计日志 → 主数据库，跨工作区聚合

### 技能（两级）

```
skills {
  id:         uuid PK
  userId:     uuid FK
  workspaceId:  uuid? FK           // null = 用户级
  name:       string
  description: string
  content:    text               // Markdown 格式，与 Claude Code SKILL.md 兼容
  updatedAt:  timestamp
  UNIQUE (userId, workspaceId, name)
}
```

两级同 memory。同名 skill 工作区级覆盖用户级。Skill content 采用 Markdown 格式，包含 frontmatter（name、description）和 prompt 正文。

**系统预置 Skill**：

系统内置若干通用 Skill，存放在 `packages/server/src/skills/` 目录下。用户创建工作区时，预置 Skill 自动复制到工作区的 `skills/` 目录，作为工作区级 Skill 加载。用户可在工作区中编辑、删除或新增 Skill。

预置 Skill 来源（按目录组织在 `packages/server/src/skills/` 下）：

**find-skills**（技能发现）：
- `find-skills`：浏览和安装社区 Skill，数据源对接 [skills.sh](https://skills.sh/) 技能市场

**skill-creator**（技能开发）：
- `skill-creator`：创建、修改和测试自定义 Skill

**superpowers 系列**（开发工作流增强）：
- `brainstorming`：需求脑暴 → 设计文档
- `writing-plans`：设计文档 → 实现计划
- `executing-plans`：按计划逐步执行
- `subagent-driven-development`：子 Agent 并行开发
- `test-driven-development`：TDD 工作流
- `systematic-debugging`：系统化排查 bug
- `requesting-code-review` / `receiving-code-review`：CR 发起与接收
- `verification-before-completion`：完成前验证检查
- `using-git-worktrees`：Git worktree 隔离开发
- `finishing-a-development-branch`：分支收尾合并
- `dispatching-parallel-agents`：并行任务分发

**anthropic-skills 系列**（文档与工具）：
- `schedule`：定时任务配置
- `pdf` / `docx` / `xlsx` / `pptx`：文档格式读写
- `frontend-design`：前端界面设计与实现

> 预置 Skill 仅在创建工作区时复制一次，后续系统更新预置 Skill 不会覆盖用户已有的工作区 Skill。

### MCP Server 配置（两级）

```
mcp_servers {
  id:         uuid PK
  userId:     uuid FK
  workspaceId:  uuid? FK           // null = 用户级
  name:       string               // 显示名称
  command:    string               // 启动命令（如 'npx'）
  args:       jsonb                // 命令参数（如 ['-y', '@modelcontextprotocol/server-filesystem']）
  env:        jsonb?               // 环境变量（敏感值 AES-256-GCM 加密）
  enabled:    boolean
  updatedAt:  timestamp
  UNIQUE (userId, workspaceId, name)
}
```

两级同 memory/skill：
- **用户级**（workspaceId=null）：用户配置的通用 MCP Server，跨所有工作区生效
- **工作区级**（workspaceId=X）：特定工作区的 MCP Server，仅该工作区生效

Agent 运行时启动时，合并用户级 + 工作区级 MCP Server 配置（同名工作区级覆盖用户级），通过 stdio 方式启动各 MCP Server 子进程，将获取到的工具注入 Agent 可用工具集。

### 定时任务

```
scheduled_tasks {
  id:         uuid PK
  workspaceId:  uuid FK
  name:       string
  cron:       string
  prompt:     text
  enabled:    boolean
  lastRunAt:  timestamp?
  nextRunAt:  timestamp?
}

task_runs {
  id:         uuid PK
  taskId:     uuid FK
  sessionId:  uuid FK
  status:     'running' | 'success' | 'failed'
  startedAt:  timestamp
  finishedAt: timestamp?
  error:      text?
}
```

### 审计日志

```
audit_logs {
  id:         uuid PK
  userId:     uuid FK
  action:     string             // 'workspace.create', 'session.message' 等
  target:     string
  detail:     jsonb?
  ip:         string
  createdAt:  timestamp
}
```

## 六、权限模型

### 系统角色

| 角色 | 说明 | 权限 |
|------|------|------|
| admin | 系统管理员 | 用户管理、系统设置、日志查看 |
| user | 普通用户 | 创建和管理自己的工作区、对话、Provider、memory/skill |

### 工作区权限

- 工作区通过 `createdBy` 归属用户，只有创建者可以访问和管理
- 用户之间不共享工作区，无协作功能
- 路由中间件只需验证 `workspace.createdBy === user.id`

### Provider 绑定优先级

```
工作区绑定（settings.providerId）> 用户默认（isDefault=true）
```

## 七、API 设计

### REST API

按控制面（系统管理）和用户面（用户工作台）划分：

```
══ 公共 ══

认证
  POST   /api/auth/login
  POST   /api/auth/register              通过邀请码注册
  POST   /api/auth/logout
  POST   /api/auth/refresh
  GET    /api/auth/me

══ 用户面 ══

个人设置
  GET    /api/settings/profile                个人信息
  PATCH  /api/settings/profile                更新个人信息
  GET    /api/settings/preferences            用户偏好
  PUT    /api/settings/preferences            更新偏好

Provider（用户自己的凭证）
  GET    /api/settings/providers              Provider 列表
  POST   /api/settings/providers              创建 Provider
  PATCH  /api/settings/providers/:id          更新 Provider
  DELETE /api/settings/providers/:id          删除 Provider

渠道绑定
  GET    /api/settings/channels               已绑定的 IM 渠道
  POST   /api/settings/channels               绑定新渠道
  DELETE /api/settings/channels/:id           解绑渠道

用户级 Skill
  GET    /api/settings/skills                 用户级技能列表
  POST   /api/settings/skills                 创建
  PATCH  /api/settings/skills/:sid            更新
  DELETE /api/settings/skills/:sid            删除

用户级 MCP Server
  GET    /api/settings/mcp-servers            用户级 MCP Server 列表
  POST   /api/settings/mcp-servers            创建
  PATCH  /api/settings/mcp-servers/:mid       更新
  DELETE /api/settings/mcp-servers/:mid       删除

工作区（workspace.createdBy === user.id）
  GET    /api/workspaces                      当前用户的所有工作区
  POST   /api/workspaces                      创建工作区
  GET    /api/workspaces/:id                  工作区详情
  PATCH  /api/workspaces/:id                  修改工作区设置
  DELETE /api/workspaces/:id                  删除工作区

会话
  GET    /api/workspaces/:id/sessions
  POST   /api/workspaces/:id/sessions
  GET    /api/workspaces/:id/sessions/:sid
  DELETE /api/workspaces/:id/sessions/:sid

工作区记忆（Server 代理 → Runner 侧 workspace.db）
  GET    /api/workspaces/:id/memories         记忆列表
  POST   /api/workspaces/:id/memories         创建
  PATCH  /api/workspaces/:id/memories/:mid    更新
  DELETE /api/workspaces/:id/memories/:mid    删除

工作区级 Skill
  GET    /api/workspaces/:id/skills           技能列表
  POST   /api/workspaces/:id/skills           创建
  PATCH  /api/workspaces/:id/skills/:sid      更新
  DELETE /api/workspaces/:id/skills/:sid      删除

工作区级 MCP Server
  GET    /api/workspaces/:id/mcp-servers      MCP Server 列表
  POST   /api/workspaces/:id/mcp-servers      创建
  PATCH  /api/workspaces/:id/mcp-servers/:mid 更新
  DELETE /api/workspaces/:id/mcp-servers/:mid 删除

定时任务
  GET    /api/workspaces/:id/tasks
  POST   /api/workspaces/:id/tasks
  PATCH  /api/workspaces/:id/tasks/:tid
  DELETE /api/workspaces/:id/tasks/:tid

文件管理
  GET    /api/workspaces/:id/files?path=/     列出目录内容
  GET    /api/workspaces/:id/files/*path      读取文件内容
  POST   /api/workspaces/:id/files            创建文件或文件夹
  PUT    /api/workspaces/:id/files/*path      更新文件内容
  DELETE /api/workspaces/:id/files/*path      删除文件或文件夹
  POST   /api/workspaces/:id/files/move       移动/重命名

审计日志（用户查看自己的操作记录）
  GET    /api/settings/logs                   当前用户的操作日志

══ 控制面（admin）══

用户管理
  GET    /api/admin/users
  POST   /api/admin/users
  PATCH  /api/admin/users/:id
  DELETE /api/admin/users/:id

邀请码管理
  GET    /api/admin/invite-codes         邀请码列表（含使用状态）
  POST   /api/admin/invite-codes         创建邀请码（可批量）
  DELETE /api/admin/invite-codes/:id     删除未使用的邀请码

系统设置
  GET    /api/admin/settings
  PUT    /api/admin/settings

全局日志（admin 查看所有用户的操作记录）
  GET    /api/admin/logs
```

### WebSocket 协议

```
WS /ws

客户端 → 服务端：
  { type: 'auth', token: 'jwt...' }
  { type: 'message', sessionId, content }
  { type: 'cancel', sessionId }
  { type: 'confirm_response', requestId, approved: boolean }
  { type: 'terminal_open', sessionId, workspaceId }     // 打开终端
  { type: 'terminal_input', sessionId, data }            // 终端输入
  { type: 'terminal_resize', sessionId, cols, rows }     // 终端窗口大小
  { type: 'terminal_close', sessionId }                  // 关闭终端

服务端 → 客户端：
  { type: 'thinking_delta', sessionId, content }       // 模型思考过程（extended thinking 流式输出）
  { type: 'text_delta', sessionId, content }            // 模型回复文本
  { type: 'tool_use', sessionId, tool, input }          // 工具调用
  { type: 'tool_result', sessionId, output }            // 工具执行结果
  { type: 'confirm_request', requestId, sessionId, tool, input, reason }  // 需用户确认的操作
  { type: 'done', sessionId, tokens }                   // 本轮完成
  { type: 'error', sessionId, message }                 // 错误
  { type: 'terminal_output', sessionId, data }           // 终端输出
  { type: 'terminal_exit', sessionId, code }             // 终端退出
```

## 八、WebUI 页面结构

按**控制面**（系统管理）和**用户面**（用户工作台）划分：

```
公开页面（未登录可访问）
/                                    # 首页：产品介绍
/pricing                             # 定价页
/docs                                # 文档中心
/blog                                # 产品动态
/login                               # 登录
/register                            # 邀请码注册

═══════════════════════════════════════
用户面 — 用户工作台（所有登录用户）
═══════════════════════════════════════

对话
/chat                                # 工作区列表 + 创建工作区
/chat/:workspaceId                   # 工作区对话
/chat/:workspaceId/:sessionId        # 具体会话
/chat/:workspaceId/terminal          # 工作区在线终端（xterm.js）
/chat/:workspaceId/settings          # 工作区设置（记忆、skill、MCP、定时任务）

个人设置
/settings/profile                    # 个人信息（含 git 凭证）
/settings/preferences                # 偏好设置（语言、风格、自定义规则）
/settings/providers                  # Provider 管理（绑定 API Key / OAuth）
/settings/channels                   # IM 渠道绑定（Telegram、飞书等）
/settings/skills                     # 用户级 Skill 管理
/settings/mcp-servers                # 用户级 MCP Server 管理

统计与日志
/settings/dashboard                  # 使用统计看板（token 用量、调用趋势、工作区分布）
/settings/logs                       # 个人操作日志（审计记录）

账户（后续）
/settings/subscription               # 订阅管理
/settings/billing                    # 支付记录

═══════════════════════════════════════
控制面 — 系统管理（admin）
═══════════════════════════════════════

/admin                               # 控制台首页（概览仪表盘）
/admin/users                         # 用户管理
/admin/invite-codes                  # 邀请码管理（生成、查看使用状态）
/admin/logs                          # 全局操作日志
/admin/settings                      # 系统设置（支持的 Provider 类型等）
```

WebUI 通过 Vite 构建为静态文件，由主服务 Hono 托管，不需要额外的前端服务。公开页面做 SSR 或静态生成以利于 SEO。

## 九、定时任务

### 调度机制

- node-cron 进程内调度，每分钟扫描 scheduled_tasks 表
- p-queue 全局共享队列，限制并发（默认 3，`SCHEDULER_CONCURRENCY` 可配置）
- 每用户最多 10 个定时任务（`MAX_TASKS_PER_USER`）
- 调度按 `nextRunAt` 排序，FIFO 执行
- 每次执行创建临时 session，完整记录可回溯

### 容错

- 进程重启：node-cron 重新加载所有 enabled 任务
- 执行超时：可配置 timeout，超时终止 Agent
- 执行失败：记录 error，不自动重试，用户手动重跑

### Agent API 调用容错

- Provider API 429/5xx：指数退避重试，最多 3 次（1s → 2s → 4s）
- 网络错误：同上
- 重试耗尽 / 4xx 错误：记录错误，通过 WebSocket 通知用户
- token 超限：通知用户，终止当前会话

### 数据库迁移

- `drizzle-kit generate` 生成迁移文件到 `packages/server/db/migrations/`
- 服务启动时自动执行 `drizzle-kit migrate`
- 也可手动执行 `npm run migrate`

### 三方言数据库差异处理

| 特性 | PostgreSQL | MySQL | SQLite |
|------|-----------|-------|--------|
| 主键 | `uuid` 类型 | `CHAR(36)` | `text` + `crypto.randomUUID()` |
| 枚举 | `pgEnum` | 原生 `ENUM` | `text` 列（应用层校验） |
| JSON | `jsonb` 列 | `JSON` 列 | `text` 列（JSON.stringify/parse） |
| 时间默认值 | `now()` | `NOW()` | `CURRENT_TIMESTAMP` |
| 数据库备份 | `pg_dump` | `mysqldump` | 直接复制 `.db` 文件 |
| 布尔类型 | `boolean` | `TINYINT(1)` | `integer`（0/1） |

Schema 分别定义在 `schema.pg.ts`、`schema.mysql.ts` 和 `schema.sqlite.ts`，共享类型定义在 `schema.types.ts`。`db/index.ts` 根据 `DB_DIALECT` 选择对应驱动和 schema。

## 十、安全设计

### 认证安全

| 措施 | 实现 |
|------|------|
| 注册方式 | 管理员邀请码注册，不开放自由注册 |
| 密码存储 | bcrypt, cost=12 |
| JWT | access token 15min + refresh token 7d |
| refresh token | 存 PG，单设备单 token，刷新即旧 token 失效 |
| 登录保护 | 同 IP 连续失败 5 次锁定 15 分钟 |

### API 安全

| 措施 | 实现 |
|------|------|
| 权限校验 | 路由中间件验证 workspace.createdBy === user.id |
| 请求限流 | 内存计数器，按用户限制 QPS |
| 输入校验 | Zod schema 校验所有入参 |
| CORS | 仅允许自身域名 |
| 安全响应头 | Hono secureHeaders 中间件 |
| CSRF 防护 | SameSite=Strict cookie |

### 数据安全

| 措施 | 实现 |
|------|------|
| Provider 凭证 / Git Token | AES-256-GCM 加密存储，密钥从环境变量 `ENCRYPTION_KEY` 读取 |
| 密钥轮换 | 提供 `npm run rotate-key` CLI 命令重新加密所有行 |
| JWT 客户端存储 | access token 仅存内存，refresh token 用 httpOnly + Secure + SameSite=Strict cookie |
| 审计日志 | 关键操作全记录 |
| 数据库备份 | PostgreSQL: 定时 `pg_dump`；SQLite: 复制 `.db` 文件 |

### Agent 行为安全（三层防护）

**第一层：System Prompt 约束**

Agent 初始化时注入不可覆盖的安全规则：禁止操作 /workspace 外路径、禁止泄露凭证。

**第二层：工具调用拦截**

```typescript
interface ToolGuard {
  check(tool: string, input: any): 'allow' | 'block' | 'confirm'
}
```

| 规则 | 行为 |
|------|------|
| `rm -rf /`、`mkfs`、`dd` 等破坏性命令 | block |
| `curl \| bash`、下载并执行脚本 | block |
| 读取 `/etc/shadow`、`.env`、`*credential*` | block |
| `git push --force`、`git reset --hard` | confirm（推送给用户审批） |
| 大批量文件删除（>10 文件） | confirm |
| 常规操作 | allow |

confirm 通过 WebSocket 推送给用户，超时 5 分钟自动拒绝。拦截规则可按工作区配置。

**第三层：审计 + 告警**

- 所有工具调用记录在 messages.toolCalls
- 异常检测：单次会话 bash 超 50 次 / token 超阈值 / 连续 block → 告警 admin

### 运行环境安全

#### Docker 启动模式

- 容器隔离，非 root 用户运行 Runner
- 资源限制（CPU/内存）
- Docker Socket 不暴露给容器
- RunnerManager 只操作 `ccclaw.workspace=true` 标签的容器
- 容器内 Runner 通过 WS 连接宿主 Server

#### Runner 模式 — 目录权限与连接安全

Runner 统一架构，无论本地还是远端，安全措施一致：

**目录与进程安全：**

| 措施 | 实现 |
|------|------|
| 目录权限 | 工作区根目录 `chmod 0o700`，仅进程 owner 可访问 |
| 路径白名单 | `ALLOWED_PATHS` 环境变量限定 agent 可访问路径（workspace + memory + skills） |
| 路径越界校验 | `validatePath()` 使用 `path.resolve()` 解析后校验前缀，阻止 `../../` 遍历 |
| 符号链接防护 | `lstat()` 检测符号链接，禁止指向白名单外的软链接 |
| 环境变量隔离 | 本地 fork 的子进程只继承最小必要的环境变量（`buildSafeEnv()`），不泄露主服务密钥 |
| agent-runtime 内部校验 | Runner 启动时校验 `ALLOWED_PATHS`，所有文件操作先过 `isAllowedPath()` |

**连接安全：**

| 措施 | 实现 |
|------|------|
| 注册认证 | Runner 连接时携带 `token` 认证，Server 验证后才接受注册 |
| 传输加密 | WebSocket over TLS（`wss://`），防止中间人窃听 |
| token 轮换 | Runner token 存储使用 AES-256-GCM 加密，支持定期轮换 |
| 心跳保活 | 30 秒心跳间隔，60 秒无响应标记 offline |
| 自动重连 | Runner 断线后指数退避重连（1s → 2s → 4s → ... → 60s max） |

**agent-runtime 内部路径校验逻辑：**

```typescript
function isAllowedPath(targetPath: string): boolean {
  const allowedPaths = (process.env.ALLOWED_PATHS || '').split(':').filter(Boolean);
  const resolved = path.resolve(targetPath);
  const real = fs.realpathSync.native(resolved);
  return allowedPaths.some(allowed => real === allowed || real.startsWith(allowed + path.sep));
}
```

**Runner 部署示例（远端）：**

```bash
ALLOWED_PATHS=/data/workspaces/ws-xxx/workspace:/data/workspaces/ws-xxx/memory:/data/workspaces/ws-xxx/skills \
RUNNER_ID=runner-office-01 \
SERVER_URL=wss://ccclaw.example.com/ws/runner \
AUTH_TOKEN=<runner-token> \
node agent-runtime --mode runner
```

**本地 Runner** 由 Server 自动 fork，无需手动部署，环境变量通过 `buildSafeEnv()` 自动配置。

## 十一、上下文组装

### Session 与渠道关系

同一工作区可通过不同渠道（WebUI、Telegram 等）发起独立的 Session。各 Session 共享工作区的记忆（memories）、技能（skills）、MCP Server 配置，但会话历史（messages）相互独立。

```
工作区 A
├── 用户偏好（主数据库）            ← 所有渠道 Session 共享
├── workspace.db（工作区目录）      ← Runner 本地读写
│   ├── memories                   ← 所有 Session 共享的知识积累
│   ├── Session 1（WebUI）         ← 独立的 messages 历史
│   ├── Session 2（Telegram）      ← 独立的 messages 历史
│   └── Session 3（WebUI）         ← 独立的 messages 历史
├── skills（共享）
└── MCP servers（共享）
```

### 上下文组装顺序

每次 Agent 调用时，按以下顺序组装上下文：

```
1. 用户偏好         ← 主数据库 user_preferences 表（Server 读取，传给 Runner）
2. 工作区记忆       ← workspace.db memories 表（Runner 本地读取）
   - 有向量检索时：按当前消息相似度取 top-K + 全量 decision/feedback
   - 无向量检索时：全量加载
3. 用户级 skills + 工作区级 skills（同名覆盖）
4. 用户级 MCP servers + 工作区级 MCP servers（同名覆盖）→ 启动 MCP 子进程，注入工具集
5. session 历史 messages ← workspace.db messages 表（Runner 本地读取，最近 20 条完整保留）
6. 超过 20 条的历史 → 调用 LLM 生成摘要，存入 sessions.summary 字段
→ 组装为 Agent 的 system prompt + conversation history
```

### 记忆沉淀机制

跨 Session 的上下文连续性通过工作区记忆（workspace.db memories 表）实现。Agent 在 Runner 侧直接读写 SQLite，拥有 `memory_write` / `memory_read` / `memory_search` 工具。写入策略由 system prompt 引导，交给 Agent 自主判断。用户可通过 UI 查看、编辑、删除记忆。

**system prompt 注入指令**：

```
"你拥有工作区记忆管理能力（memory_write / memory_read / memory_search 工具）。
写入时机由你自主判断，以下是参考：
 - 用户明确说"记住…"、"以后都…"
 - 用户纠正你在这个工作区中的行为 → feedback
 - 对话中产生的项目决策、架构约定 → decision
 - 完成关键操作后记录工作日志 → log（异步写入，记录做了什么、改了哪些文件、结果如何）
 - 不确定时宁可不写，用户可以手动管理记忆
记忆类型：project | reference | decision | feedback | log
log 类型可高频写入，用于跨 Session 保持任务进展连续性。
同名记忆自动更新（log 除外，log 每次新建）。"
```

**内置工具定义**（Runner 侧直接操作 workspace.db）：

```
memory_write：
  参数：{ name: string, type: 'project' | 'reference' | 'decision' | 'feedback' | 'log', content: string }
  行为：写入当前工作区 workspace.db，有 embedding 模型时同时生成向量
  权限：Agent 运行时自动可用，无需用户确认

memory_read：
  参数：{ name?: string }
  行为：按名称读取指定记忆，或不传 name 返回全部记忆列表（name + type 摘要）
  权限：Agent 运行时自动可用

memory_search：
  参数：{ query: string, limit?: number }
  行为：按语义相似度搜索记忆（需 embedding 支持），返回最相关的 top-K 条
  降级：未配置 embedding 模型时，退化为全文关键词匹配
  权限：Agent 运行时自动可用
```

**Session 归档总结**：Session 状态变为 `archived` 时：
1. 所有 messages 发送给 LLM 生成摘要，存入 `sessions.summary`（供历史查看）
2. 不再额外提取记忆 — 依赖 Agent 在对话过程中已主动沉淀

## 十二、使用统计

### Token 用量统计

每次 Agent 调用完成后记录 token 用量，用户可在统计看板中查看。

```
token_usage {
  id:         uuid PK
  userId:     uuid FK
  workspaceId:  uuid FK
  sessionId:  uuid FK
  providerId: uuid FK
  model:      string             // 'claude-sonnet-4-6'、'gpt-4o' 等
  inputTokens:  int
  outputTokens: int
  createdAt:  timestamp
}
```

### 统计看板

用户在 `/settings/dashboard` 查看个人使用统计，包含：

- **总览**：总 token 用量、总对话次数、活跃工作区数
- **按时间**：日/周/月 token 用量趋势图
- **按工作区**：各工作区的 token 消耗占比
- **按 Provider**：各 Provider 的调用次数和 token 用量
- **最近活动**：最近的对话和工具调用记录

### 定时任务触发记录

用户在工作区设置中查看定时任务的执行历史（`task_runs` 表），包含：

- 触发时间、执行状态（running / success / failed）
- 执行耗时
- 失败时的错误信息
- 关联的 Session（可点击跳转查看完整对话记录）

## 十三、商业化能力（后续扩展）

> 以下能力在架构中预留扩展点，本期不实现。

- **用户配额**：按日/月 token 限额，超出时拒绝调用
- **订阅套餐**：free / pro / team，不同配额和功能
- **支付**：支付宝 / 微信 / Stripe
- **账号池管理**：providers 表扩展负载均衡和健康检查字段

## 十四、分阶段交付

| 阶段 | 范围 |
|------|------|
| P0 | 核心骨架：工程结构 + DB schema + 邀请码注册/认证 + 基础 API |
| P1 | Agent 运行时：Runner + 工具集 + 流式通信（含 thinking_delta） |
| P2 | WebUI：对话界面 + 在线终端 + 管理控制台 |
| P3 | 记忆/技能/MCP 系统 + 上下文组装 + Provider 管理 |
| P4 | 定时任务 + Agent 行为安全 + 使用统计看板 |
| P5 | 渠道扩展：Telegram / 飞书 / 企微 |
| P6 | 商业化：配额管理 + 订阅套餐 + 支付 + 账号池 |
