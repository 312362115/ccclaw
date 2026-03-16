# Agent 运行时架构

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## 运行环境类型

每个工作区可独立选择运行环境，通过 `workspaces.settings.startMode` 配置：

所有运行环境统一采用 **Runner 架构**：Runner 是独立的 agent-runtime 进程，主动通过 WebSocket 连接 Server 注册。区别仅在 **Runner 的启动方式**：

| 启动方式 | 说明 | 由谁启动 | 适用场景 |
|---------|------|---------|---------|
| `docker` | Docker 容器内运行 Runner | Server 创建容器 | 生产环境，安全隔离 |
| `local` | 宿主机上 fork Runner 子进程 | Server 自动 fork | 开发调试，低配部署 |
| `remote` | 远端手动部署 Runner | 用户手动启动 | 内网环境、远程服务器 |

> **通信方式完全一致**：无论哪种启动方式，Runner 启动后都主动通过 WebSocket 连接 Server 的 `/ws/runner` 端点注册。Server 通过已建立的 WebSocket 下发任务、接收响应。不再使用 Unix Socket 通信。

## RunnerManager

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

## agent-runtime 进程

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
  /home/agent/    ← 用户代码区（Agent cwd，读写）
  /internal/      ← 系统数据区
  │  workspace.db ← 会话 + 消息 + 记忆（SQLite 读写）
  │  skills/      ← 工作区技能（只读）
  │               （todos 存储在 workspace.db）
  └──────────────
```

## Runner 模块划分

```
packages/agent-runtime/
├── index.ts                  # 入口：WebSocket 主动连接 Server 注册
├── agent.ts                  # Agent SDK 封装（当前 Claude，架构支持多 Provider）
├── protocol.ts               # JSON-RPC 协议处理（Server ↔ Runner 通信）
├── workspace-db.ts           # workspace.db 读写（sessions / messages / memories）
├── context-assembler.ts      # 上下文组装（偏好 + 记忆 + skills + 历史 → system prompt）
├── consolidator.ts           # Token 驱动的上下文整合（消息压缩 → 记忆沉淀）
├── skill-loader.ts           # 加载工作区 skills/ 目录下的 .md 文件
├── mcp-manager.ts            # MCP Server 懒连接 + 工具注入（含超时保护）
├── terminal-manager.ts       # node-pty 终端管理（≤2 个/工作区，10min 空闲超时）
├── heartbeat.ts              # WebSocket 心跳保活（30s ping，60s 断线重连）
├── tool-registry.ts          # 工具注册表：统一注册、参数类型修正、schema 校验
├── subagent-manager.ts       # 子 Agent 管理：独立工具集、迭代限制、结果回传
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
    ├── safe-env.ts           # 安全环境变量构建（过滤敏感变量）
    └── token-estimator.ts    # Token 数量估算（用于整合触发判断）
```

## 工作区运行时配置

`workspaces.settings` JSON 字段存储工作区级配置，覆盖用户偏好和系统默认值：

```jsonc
{
  // ── 运行环境 ──
  "startMode": "docker",           // "docker" | "local" | "remote"
  "runnerId": "ws-xxx-runner",     // Runner 标识（自动生成或手动配置）
  "runtimeConfig": {
    "memory": "512m",              // 容器内存限制（docker 模式）
    "cpu": "50%",                  // 容器 CPU 限制（docker 模式）
    "timeout": 1800                // Agent 单次执行超时（秒），默认 1800
  },

  // ── Provider 绑定 ──
  "providerId": "uuid",           // 绑定的 Provider（覆盖用户默认 Provider）
  "model": "claude-opus-4-6",     // 绑定的模型（覆盖用户默认模型）

  // ── Agent 行为 ──
  "maxIterations": 40,            // Agent 迭代轮次上限（每轮 = 一次 LLM 调用 + 工具执行）
  "toolConfirmMode": "auto",      // 覆盖用户级工具确认模式

  // ── Heartbeat 自主唤醒 ──
  "heartbeat": {
    "enabled": false,              // 默认关闭
    "intervalMinutes": 15,         // 检查间隔
    "rulesFile": "HEARTBEAT.md"    // 规则文件路径（相对于 workspace/）
  },

  // ── Git 集成 ──
  "gitRepo": "https://github.com/user/repo.git",  // 关联 Git 仓库
  "gitBranch": "main",            // 默认分支（clone 时使用）
  "gitAutoCommit": false           // 是否允许 Agent 自动 commit（默认需确认）
}
```

### 工作区设置配置项详细说明

**运行环境**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `startMode` | string | `local` | Runner 启动方式。`docker`：Server 创建容器（生产推荐）；`local`：Server fork 子进程（开发调试）；`remote`：等待远端 Runner 连接（内网部署）。所有模式通信方式一致（WebSocket）。 |
| `runnerId` | string | 自动生成 | Runner 标识。`docker`/`local` 模式自动生成；`remote` 模式由用户手动配置，用于绑定远端 Runner。 |
| `runtimeConfig.memory` | string | `512m` | Docker 容器内存上限。格式同 Docker，如 `256m`、`1g`。 |
| `runtimeConfig.cpu` | string | `50%` | Docker 容器 CPU 配额。`50%` 表示最多使用 0.5 核。 |
| `runtimeConfig.timeout` | integer | `1800` | Agent 单次执行超时（秒）。超时后强制终止当前 Agent Loop。范围：`60 ~ 7200`。 |

**Provider 与模型**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `providerId` | uuid | `null` | 工作区绑定的 Provider。覆盖用户默认 Provider。适用场景：不同工作区使用不同 API Key（如个人项目用个人 Key，公司项目用团队 Key）。 |
| `model` | string | `null` | 工作区绑定的模型。覆盖用户默认模型。适用场景：代码生成用 Opus（最强），日常问答用 Sonnet（性价比）。 |

**Agent 行为**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxIterations` | integer | `40` | Agent 迭代轮次上限。每轮 = 一次 LLM 调用 + 可能的工具执行。防止 Agent 陷入无限循环。范围：`5 ~ 100`。 |
| `toolConfirmMode` | string | 继承用户偏好 | 工具确认模式。工作区级覆盖用户级。敏感工作区可设为 `confirm_all`。 |

**Git 集成**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `gitRepo` | string | `null` | 关联的 Git 仓库 URL。创建工作区时若配置，会使用用户级 `gitToken` 执行 `git clone`。 |
| `gitBranch` | string | `main` | clone 时使用的分支。 |
| `gitAutoCommit` | boolean | `false` | 是否允许 Agent 自动执行 `git commit`。`false` 时 Agent 执行 commit 操作需用户确认（由 ToolGuard 拦截）。 |

> `startMode` 决定 Runner 的启动方式：`docker` 由 Server 创建容器，`local` 由 Server fork 子进程，`remote` 等待用户手动部署的 Runner 连接。所有模式通信方式一致（WebSocket）。

## 工作区文件存储

### 设计原则：系统数据与用户代码分离

系统管理的数据（workspace.db、skills、config）和用户自己的代码仓库**必须在不同目录**，原因：
- 用户 `git clone` 不会覆盖系统文件
- 系统文件不会污染 `git status`
- Docker 挂载可以独立控制读写权限
- 备份/迁移时职责清晰

### 宿主机存储路径

```
/data/ccclaw/
├── users/
│   └── {user-id}/
│       └── skills/                 # 用户级技能文件（跨所有工作区生效）
├── workspaces/
│   └── {workspace-slug}/
│       ├── home/                   # ══ 用户代码区（Agent 工作目录）══
│       │   ├── .git/              # Git 仓库（如果配置了 gitRepo）
│       │   ├── AGENTS.md          # Bootstrap 文件（可选，用户维护，git 可追踪）
│       │   ├── SOUL.md            # Bootstrap 文件（可选）
│       │   ├── USER.md            # Bootstrap 文件（可选）
│       │   ├── TOOLS.md           # Bootstrap 文件（可选）
│       │   ├── src/...            # 用户项目代码
│       │   └── ...
│       └── internal/               # ══ 系统数据区（CCCLaw 管理，用户不直接操作）══
│           ├── workspace.db        # 会话 + 消息 + 记忆（SQLite + WAL）
│           ├── skills/             # 工作区级技能文件（系统预置 + 用户通过 UI/API 管理）
│           └── mcp-cache/          # MCP Server 运行时缓存（可清理）
└── backups/                        # pg_dump / workspace.db 备份
```

### 目录职责对比

| 目录 | 管理者 | Git 追踪 | Agent 可访问 | 用户可直接编辑 | Docker 挂载 |
|------|--------|---------|-------------|---------------|-----------|
| `home/` | 用户 + Agent | 是（如配置 gitRepo） | 读写 | 是（文件管理 API + 终端） | `/home/agent` 读写 |
| `internal/` | CCCLaw 系统 | 否 | 仅通过内置工具（memory_write 等） | 否（仅通过 UI/API） | `/internal` 读写 |

### 环境变量映射

Runner 启动时注入的环境变量更新：

```bash
# Agent 工作目录（Agent 的 cwd，所有文件操作的根）
WORKSPACE_DIR=/home/agent

# 系统数据目录（内置工具如 memory_write 使用，Agent 不直接操作）
INTERNAL_DIR=/internal

# 路径白名单（Agent 文件工具只能访问这些路径）
ALLOWED_PATHS=/home/agent:/internal/skills:/internal/workspace.db

# workspace.db 路径（WorkspaceDB 模块使用）
WORKSPACE_DB=/internal/workspace.db
```

> `home/` 是 Agent 的工作目录（cwd），Agent 的 bash/file/git 等工具默认在此目录操作。
> `internal/` 对 Agent 透明 — memory/todo 等内置工具通过 WorkspaceDB 读写 `workspace.db`，Skill 文件通过 SkillLoader 加载，Agent 不需要知道物理路径。

> workspace.db 的路径单独加入白名单，但仅限 WorkspaceDB 模块通过内置工具（memory_*/todo_*）访问，Agent 不能通过 file/bash 工具直接读写 workspace.db。路径守卫对 workspace.db 的访问限定为内置工具调用链内部。

### 工作区创建时的初始化流程

1. 创建目录结构：`home/`、`internal/`、`internal/skills/`
2. 初始化 `internal/workspace.db`（sessions + messages + memories + todos 四张表，启用 WAL 模式，sessions 含 `lastConsolidated` 字段）
3. 将系统预置 Skill 复制到 `internal/skills/`
4. 配置了 gitRepo → 使用用户级 gitToken 执行 `git clone` 到 `home/`
5. 未配置 gitRepo → `home/` 保持空目录
6. Git 操作（push/pull）由 Agent 在对话中按需执行，不自动同步

### Bootstrap 文件位置说明

Bootstrap 文件（`AGENTS.md`、`SOUL.md`、`USER.md`、`TOOLS.md`）放在 `home/` 根目录，原因：
- 属于用户维护的内容（定义 Agent 人格和规范）
- 可以跟随 Git 版本控制（团队共享同一份 Agent 规范）
- Agent 可以通过文件工具自我更新
- WebUI 编辑本质是文件操作（调用文件管理 API），不需要额外数据库支持

## 工作区文件管理

用户可在工作区内创建、查看、编辑、删除文件和文件夹。文件管理 API 操作 `home/` 目录。

**安全约束：**
- 文件管理 API 的所有路径限制在 `home/` 范围内，防止路径遍历攻击
- `internal/` 目录对文件管理 API 不可见（不通过文件 API 暴露系统数据）
- 使用 `path.resolve()` 解析后验证前缀
- 文件名禁止特殊字符（`..`、`\0`）
- 单文件大小限制 10MB
- 仅工作区创建者可读写

**API 行为：**

| 操作 | 方法 | 说明 |
|------|------|------|
| 列目录 | GET ?path=/ | 返回 `{ name, type, size, modifiedAt }[]`（`home/` 下） |
| 读文件 | GET /*path | 返回文件内容（text 或 base64） |
| 创建 | POST `{ path, type: 'file'/'dir', content? }` | 创建文件或文件夹 |
| 更新 | PUT /*path `{ content }` | 更新文件内容 |
| 删除 | DELETE /*path | 删除文件或空文件夹（非空需 `?force=true`） |
| 移动 | POST /move `{ from, to }` | 移动或重命名 |

## 在线终端（Web Terminal）

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
- 终端工作目录固定为工作区 `home/` 目录（用户代码区）
- 复用 Runner 的目录权限和路径白名单
- Docker 模式下在容器内执行，天然隔离
- 本地/远端模式下通过 `ALLOWED_PATHS` 环境变量限制范围
- 每个工作区最多同时开启 2 个终端会话
- 空闲 10 分钟自动关闭终端进程

**依赖**：
- `node-pty`：PTY 进程管理（agent-runtime 包新增依赖）
- `xterm`、`xterm-addon-fit`：前端终端组件（web 包新增依赖）

## 运行时生命周期

| 状态 | 触发 | docker 启动 | local 启动 | remote 启动 |
|------|------|-----------|-----------|------------|
| 启动 | 工作区首次使用 | 创建容器，Runner WS 连接 | fork 子进程，Runner WS 连接 | 等待远端 Runner 连接 |
| 运行中 | 有活跃会话 | 通过 WS 下发任务 | 通过 WS 下发任务 | 通过 WS 下发任务 |
| 休眠 | 空闲 30 分钟 | 停止容器 | 终止子进程 | 保持 WS 连接 |
| 唤醒 | 新消息到达 | 启动容器 | 重新 fork | 检查 Runner 在线状态 |
| 销毁 | 工作区删除 | 删除容器 | 终止子进程 | 解除绑定 |

### Runner 启动序列

```
1. 进程启动，读取环境变量（RUNNER_ID, SERVER_URL, AUTH_TOKEN, WORKSPACE_DIR, INTERNAL_DIR, WORKSPACE_DB, ALLOWED_PATHS）
2. 初始化 WorkspaceDB（打开 workspace.db，检查 PRAGMA user_version，按需执行迁移）
3. 初始化 ToolRegistry（注册内置工具：bash, file, git, glob, grep, web-fetch, memory_*, todo_*）
4. 初始化 SkillLoader（扫描 internal/skills/，加载 SKILL.md，注册可执行 Skill 到 ToolRegistry）
5. 初始化 TerminalManager（预置 node-pty，限制最多 2 个终端）
6. WebSocket 连接 Server（发送 register + token），等待 registered 确认
7. 启动心跳定时器（每 15s 发送 ping）
8. 进入就绪状态，等待 Server 下发 request
```

> MCP Server 不在启动时连接，首次收到用户消息时懒连接（见 MCP Manager 章节）。

### 优雅关闭

```
收到 SIGTERM / SIGINT:
1. 停止接受新请求（回复 { type: 'error', message: 'shutting down' }）
2. 等待进行中的 Agent Loop 完成（最多 30s 超时）
3. 关闭所有 MCP Server 子进程
4. 关闭所有终端 PTY 进程
5. 关闭 workspace.db 连接
6. 发送 { type: 'disconnect', reason: 'shutdown' } 给 Server
7. 关闭 WebSocket 连接
8. 进程退出
```

### 并发模型

单个 Runner 同一时间只处理一个 Agent Loop 请求。当 Runner 正在处理请求时，新到达的请求由 Server 排队等待（RunnerManager 维护 per-workspace 请求队列，FIFO）。

例外：
- 终端操作（terminal_*）与 Agent 请求并行处理，互不阻塞
- 心跳（ping/pong）不受请求处理状态影响
- 取消请求（cancel）可中断进行中的 Agent Loop

## Docker 模式安全配置

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

## 通信协议

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

**核心类型定义**：

```typescript
interface AgentRequest {
  sessionId: string;
  message: string;
  apiKey: string;                // Server 解密后注入，Runner 不持久化
  context: {
    systemPrompt: string;        // 组装好的 system prompt
    memories: MemorySummary[];   // 必注入层全文 + 索引层摘要
    skills: SkillSummary[];      // always=true 全文 + 其他 XML 摘要
    history: Message[];          // messages[lastConsolidated:] 未整合尾部
    preferences: UserPreferences;
    mcpServers: MCPServerConfig[];
  };
}

interface AgentResponse =
  | { type: 'thinking_delta'; content: string }
  | { type: 'text_delta'; content: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; output: string }
  | { type: 'confirm_request'; requestId: string; tool: string; input: Record<string, unknown>; reason: string }
  | { type: 'error'; message: string; code?: string }
  | { type: 'subagent_started'; taskId: string; label: string }
  | { type: 'subagent_result'; taskId: string; output: string }
  | { type: 'done'; sessionId: string; tokens: { inputTokens: number; outputTokens: number } };
```

## Remote Runner 注册机制

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
  "startMode": "remote",
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

## 工具注册与参数修正（借鉴 nanobot）

### ToolRegistry

统一工具管理层，所有工具（内置 + 可执行 Skill + MCP）通过 Registry 注册和调用，提供参数校验、类型修正和错误提示增强。

**工具来源三层**：

| 来源 | 注册方式 | 参数定义 | 示例 |
|------|---------|---------|------|
| 内置工具 | 硬编码，Runner 启动时注册 | JSON Schema | bash, file, git, glob, grep, web-fetch, memory_*, todo_* |
| 可执行 Skill | 扫描 `skills/` 目录，有 `command` 的 SKILL.md 自动注册 | markdown 自然语言（LLM 自行理解） | deploy.sh, kubectl, db-backup |
| MCP 工具 | MCP Server 连接后动态注册 | JSON Schema（MCP 协议提供） | github, jira, database |

```typescript
interface ToolRegistry {
  /** 注册工具 */
  register(name: string, tool: ToolDefinition): void;
  /** 批量注册 MCP 工具 */
  registerMCP(serverName: string, tools: MCPToolDefinition[]): void;
  /** 获取所有工具定义（供 LLM 调用） */
  getDefinitions(): ToolDefinition[];
  /** 执行工具调用（含参数修正 + schema 校验） */
  execute(name: string, params: Record<string, unknown>): Promise<string>;
  /** 移除工具（MCP Server 断开时） */
  unregister(name: string): void;
}
```

### 参数类型自动修正

LLM 返回的工具参数经常有类型错误（如 `timeout: "60"` 应为 `timeout: 60`）。ToolRegistry 根据工具的 JSON Schema 定义自动修正：

```typescript
function castParams(params: Record<string, unknown>, schema: JSONSchema): Record<string, unknown> {
  for (const [key, value] of Object.entries(params)) {
    const propSchema = schema.properties?.[key];
    if (!propSchema) continue;
    if (propSchema.type === 'integer' || propSchema.type === 'number') {
      if (typeof value === 'string' && !isNaN(Number(value))) {
        params[key] = Number(value);
      }
    }
    if (propSchema.type === 'boolean') {
      if (value === 'true') params[key] = true;
      if (value === 'false') params[key] = false;
    }
    // 递归处理 object/array
  }
  return params;
}
```

### 错误提示增强

工具执行失败时，自动在错误信息后追加提示，引导 LLM 换一种方式重试：

```typescript
async execute(name: string, params: Record<string, unknown>): Promise<string> {
  try {
    const casted = castParams(params, tool.schema);
    validate(casted, tool.schema);
    return await tool.execute(casted);
  } catch (err) {
    return `Error: ${err.message}\n\nAnalyze the error above and try a different approach.`;
  }
}
```

### 工具结果截断

单次工具调用结果超过 16,000 字符时自动截断，防止上下文膨胀：

```typescript
const MAX_TOOL_RESULT_CHARS = 16_000;
if (result.length > MAX_TOOL_RESULT_CHARS) {
  result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated)';
}
```

## MCP Server 懒连接与超时保护（借鉴 nanobot）

### 懒连接

MCP Server 不在 Runner 启动时立即连接，而是首次收到消息时按需连接。避免启动慢、避免未使用的 MCP Server 占用资源。

```typescript
class MCPManager {
  private connected = false;
  private connecting = false;

  /** 首次使用时连接所有配置的 MCP Server */
  async ensureConnected(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    try {
      for (const [name, config] of Object.entries(this.servers)) {
        const session = await this.connect(config);   // stdio / SSE / streamable-http
        const tools = await session.listTools();
        const filtered = this.filterByEnabledList(tools, config.enabledTools);
        for (const tool of filtered) {
          this.toolRegistry.register(`mcp_${name}_${tool.name}`, wrapMCPTool(session, tool));
        }
      }
      this.connected = true;
    } finally {
      this.connecting = false;
    }
  }
}
```

### 工具级超时

每个 MCP 工具调用独立超时（默认 30s，可配置），防止单个 MCP Server 挂死拖垮整个 Agent：

```typescript
async function executeMCPTool(session: MCPSession, toolName: string, params: any, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await session.callTool(toolName, params, { signal: controller.signal });
    return result;
  } catch (err) {
    if (err.name === 'AbortError') return `(MCP tool "${toolName}" timed out after ${timeoutMs / 1000}s)`;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

### enabledTools 过滤

支持白名单过滤，减少工具定义噪音，避免 LLM 被过多无关工具分散注意力：

```jsonc
// 工作区 MCP Server 配置
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"],
  "enabledTools": ["*"],           // 全部启用（默认）
  // 或指定白名单：
  // "enabledTools": ["read_file", "write_file"]
}
```

## 子 Agent 隔离执行（借鉴 nanobot）

支持在对话中 spawn 独立子 Agent 并行处理任务。子 Agent 拥有独立的工具注册表和迭代限制，完成后将结果回传给主 Agent。

```typescript
interface SubagentManager {
  /** 启动子 Agent 执行后台任务 */
  spawn(task: string, label: string): Promise<{ taskId: string }>;
  /** 获取子 Agent 状态 */
  getStatus(taskId: string): 'running' | 'completed' | 'failed';
  /** 取消子 Agent */
  cancel(taskId: string): Promise<void>;
}
```

**隔离策略**：
- 子 Agent 拥有独立的 ToolRegistry（禁用 `spawn` 工具，防递归）
- 迭代限制：子 Agent 最多 15 轮（主 Agent 最多 40 轮）
- 子 Agent 完成后，通过 WebSocket 将结果推送回对话流
- 同一 Session 最多 3 个并发子 Agent

**对应工具定义**：

```
spawn：
  参数：{ task: string, label: string }
  行为：创建独立子 Agent 执行指定任务，返回 taskId
  权限：Agent 运行时自动可用
```

**子 Agent 工具集**：
- 继承主 Agent 的所有内置工具（bash, file, git, glob, grep, web-fetch）
- 继承主 Agent 的 memory_read / memory_search（只读，不继承 memory_write）
- 不继承 `spawn` 工具（防递归）
- 不继承 MCP 工具（减少复杂度，子 Agent 专注单一任务）

**资源限制**：
- 迭代次数：最多 15 轮（主 Agent 40 轮）
- Token 预算：主 Agent 当前 session 剩余 token 的 25%
- 超时：300s（5 分钟），超时自动终止并返回已有结果

**结果回传**：
子 Agent 完成后，结果作为 `spawn` 工具的 tool_result 返回给主 Agent，格式：
```text
[subagent:label] 执行完成

{子 Agent 最终输出}
```
同时通过 WebSocket 推送 `subagent_result` 事件给客户端（供 UI 展示进度）。

## 消息总线解耦（借鉴 nanobot）

### 设计动机

当前 WebUI WebSocket → AgentManager → RunnerManager 耦合较紧，新增渠道（Telegram/飞书）需要改动核心逻辑。引入消息总线，将渠道适配与 Agent 处理解耦，为多渠道接入打基础。

### MessageBus

```typescript
interface MessageBus {
  /** 渠道适配器发布入站消息（用户 → Agent） */
  publishInbound(msg: InboundMessage): void;
  /** Agent 发布出站消息（Agent → 用户） */
  publishOutbound(msg: OutboundMessage): void;
  /** Agent Loop 消费入站消息 */
  consumeInbound(): AsyncIterable<InboundMessage>;
  /** 渠道适配器消费出站消息 */
  consumeOutbound(channel: string): AsyncIterable<OutboundMessage>;
}

interface InboundMessage {
  channel: string;             // 'webui' | 'telegram' | 'feishu'
  senderId: string;            // 用户标识
  chatId: string;              // 会话/群组标识
  workspaceSlug: string;
  sessionId: string;
  content: string;
  media?: Buffer[];            // 图片/文件附件
  metadata?: Record<string, unknown>;
}

interface OutboundMessage {
  channel: string;
  chatId: string;
  sessionId: string;
  content: string;
  metadata?: {
    _progress?: boolean;       // 是否为进度更新（非最终响应）
    _toolHint?: string;        // 当前工具调用提示（如 "bash('npm test')"）
  };
}
```

### 数据流（重构后）

```
渠道适配器（WebUI/Telegram/飞书）
  → InboundMessage → MessageBus.inbound 队列
  → AgentManager 消费 → 路由到工作区 → RunnerManager 下发
  → Runner 流式响应
  → OutboundMessage → MessageBus.outbound 队列
  → 渠道适配器消费 → 推送给用户
```

**好处**：
- 新增渠道只需实现 Channel 接口（publish inbound + consume outbound），不改 Agent 核心
- 支持进度更新（`_progress: true`），渠道可选择增量显示或忽略
- 解耦后可独立扩缩容（多个渠道适配器 → 单个 AgentManager）

## Heartbeat 自主唤醒（借鉴 nanobot）

### 设计动机

当前定时任务（node-cron）需要用户显式配置 cron 表达式和 prompt。Heartbeat 是一种更灵活的唤醒机制 — Agent 定期自检，自主决定是否执行任务，适合持续监控类场景。

### 机制

```
1. 工作区可配置 HEARTBEAT.md 文件，描述唤醒规则
2. Heartbeat 服务定期触发（默认 15 分钟）
3. 触发时执行两阶段流程：

Phase 1 — 决策：
  - 读取 HEARTBEAT.md + 当前上下文
  - 发送给 LLM："根据以下规则，你是否有需要执行的任务？"
  - LLM 调用虚拟工具 heartbeat({ action: 'skip' | 'run', reason: '...' })

Phase 2 — 执行（仅 action=run 时）：
  - 创建临时 Session
  - 执行完整 Agent Loop
  - 结果通过 WebSocket 推送给用户（或静默记录到 task_runs）
```

### 配置

```jsonc
// workspaces.settings 扩展
{
  "heartbeat": {
    "enabled": false,           // 默认关闭
    "intervalMinutes": 15,      // 检查间隔
    "rulesFile": "HEARTBEAT.md" // 规则文件路径（相对于 workspace/）
  }
}
```

### 示例 HEARTBEAT.md

```markdown
# 自主唤醒规则

- 每小时检查一次 CI 流水线状态，如果有失败的构建，通知我并分析失败原因
- 如果 Git 仓库有新的 PR 或 issue，生成简要摘要
- 工作日早上 9 点生成昨日工作总结
```

### 与定时任务的区别

| 特性 | 定时任务（cron） | Heartbeat 自主唤醒 |
|------|-----------------|-------------------|
| 触发方式 | 精确 cron 表达式 | 固定间隔 + LLM 自主判断 |
| 执行确定性 | 每次必执行 | LLM 判断后可跳过 |
| 适用场景 | 固定报表、数据同步 | 条件监控、智能巡检 |
| 配置方式 | 数据库 scheduled_tasks | workspace/ 目录下 HEARTBEAT.md |
| token 消耗 | 每次执行均消耗 | 跳过时仅消耗少量决策 token |

## LLM 调用容错增强（借鉴 nanobot）

### API 重试策略

```typescript
const RETRY_DELAYS = [1000, 2000, 4000]; // 指数退避（1s → 2s → 4s）

async function callLLMWithRetry(params: LLMCallParams): Promise<LLMResponse> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await provider.chat(params);
    } catch (err) {
      if (!isTransientError(err) || attempt === RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
}
```

**瞬态错误检测**（基于错误消息关键词匹配）：

| 错误类型 | 检测关键词 | 行为 |
|---------|-----------|------|
| 限流 | `429`, `rate limit`, `overloaded` | 退避重试 |
| 服务端错误 | `500`, `502`, `503`, `504` | 退避重试 |
| 超时 | `timeout`, `timed out` | 退避重试 |
| 连接问题 | `connection`, `temporarily unavailable` | 退避重试 |
| 客户端错误 | `400`, `401`, `403`, `404` | 直接抛出，不重试 |
| Token 超限 | `token limit`, `context length` | 通知用户，终止会话 |

### 空内容消毒

LLM 偶尔返回空内容（尤其是纯工具调用轮次），某些 Provider API 会拒绝后续请求中包含空 content 的消息。

```typescript
function sanitizeEmptyContent(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls?.length && !msg.content) {
      return { ...msg, content: null };  // 有 tool_calls 时 content 可为 null
    }
    if (msg.role === 'assistant' && !msg.content && !msg.toolCalls?.length) {
      return { ...msg, content: '(empty)' };  // 无 tool_calls 的空回复用占位符
    }
    return msg;
  });
}
```

### 图片降级

模型不支持多模态时自动降级（通过错误消息检测 `image_url is not supported`）：

```typescript
if (isImageUnsupportedError(err)) {
  // 移除消息中的图片，替换为 [image omitted] 文本
  const stripped = stripImageContent(messages);
  return await provider.chat({ ...params, messages: stripped });
}
```

### 消息历史清洁

保存到 session 前过滤无效消息，防止上下文污染：
- 跳过空 content 且无 tool_calls 的 assistant 消息
- 将 base64 图片替换为 `[image]` 文本标记（节省存储）
- 移除注入的运行时上下文标记（防止重复注入）

## Skill 需求检查与渐进加载（借鉴 nanobot）

### 需求检查

Skill 可声明运行依赖，加载时自动检查可用性：

```yaml
---
name: github
description: GitHub PR 和 Issue 管理
always: false
requires:
  bins: ["gh"]           # 需要 gh CLI 工具
  env: ["GITHUB_TOKEN"]  # 需要环境变量
---
```

加载时通过 `which(bin)` 检查命令是否可用，检查环境变量是否存在。不满足的 Skill 标记为 `unavailable`，不注入 Agent 工具集，但在 Skill 摘要中显示缺失原因。

### 渐进加载

根据 Skill 类型和配置，采用不同的加载策略：

```
扫描 skills/ 目录下所有 SKILL.md
├── 有 command 字段 → 可执行 Skill
│   ├── requires 检查通过 → 注册到 ToolRegistry（LLM 可作为 tool 调用）
│   ├── requires 检查失败 → 标记 unavailable，不注册
│   ├── trust=sandbox → 执行时在受限子沙箱中运行
│   ├── trust=prompt → 执行前弹确认（默认）
│   └── trust=trusted → 直接执行
└── 无 command 字段 → 知识 Skill
    ├── always: true → 全文内联 system prompt
    └── 其他 → XML 摘要，Agent 按需 read_file
```

**sandbox 模式实现**：

`trust=sandbox` 的可执行 Skill 在受限子沙箱中运行：
- Docker 模式：在当前容器内通过 `unshare --net --pid` 创建网络和 PID 隔离的子命名空间，`home/` 目录只读挂载
- Local 模式：通过 `child_process.spawn` 配合 `--network=none`（如可用）或 iptables 规则限制网络，设置 `cwd` 为临时目录
- 文件系统：Skill 只能读取自身目录 + `home/`（只读），写入限定在 `/tmp`
- 超时：继承 Skill 的 `timeout` 字段，默认 30s（比 prompt/trusted 的 120s 更短）

**XML 摘要示例**（知识 Skill + 可执行 Skill 统一展示）：

```xml
<skills>
  <skill name="tdd" type="knowledge" status="available" path="/skills/tdd/SKILL.md">
    TDD 开发流程指导
  </skill>
  <skill name="kubectl" type="executable" status="available" trust="prompt">
    Kubernetes 集群管理（需确认）
  </skill>
  <skill name="deploy" type="executable" status="unavailable" missing="bins: aws">
    部署项目到指定环境
  </skill>
</skills>
```

> 可执行 Skill 注册为 Tool 后，LLM 通过 tool_use 机制调用；知识 Skill 仅出现在 system prompt 的摘要列表中。两者在 XML 摘要中统一展示，Agent 可通过 `read_file` 读取任意 Skill 的完整文档。

好处：减少 system prompt 体积，避免不常用 Skill 浪费上下文 token。

## Bootstrap 文件体系（借鉴 nanobot）

工作区支持放置 Bootstrap 文件，Runner 启动时自动加载到 system prompt 头部，定义 Agent 的人格、行为规范和工具使用指南。

| 文件 | 用途 | 加载优先级 |
|------|------|-----------|
| `AGENTS.md` | Agent 行为规范（角色定义、交互准则、输出格式要求） | 最高 |
| `SOUL.md` | Agent 人格设定（语气、价值观、禁忌话题） | 高 |
| `USER.md` | 用户画像（技术栈、偏好、上下文背景） | 中 |
| `TOOLS.md` | 工具使用指南（特定工具的使用约束和最佳实践） | 低 |

**加载规则**：
- 文件放在工作区 `workspace/` 根目录
- 存在即加载，不存在则跳过
- 每个文件包裹为 `## {filename}` 章节，用 `---` 分隔
- 用户可在 WebUI 的工作区设置中编辑（本质是文件操作）

**与 Skill 的区别**：Bootstrap 文件定义 Agent "是什么"（人格和规范），Skill 定义 Agent "会做什么"（能力和流程）。
