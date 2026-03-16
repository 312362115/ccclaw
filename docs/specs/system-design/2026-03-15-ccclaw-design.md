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

> 详见 **[agent-runtime.md](./agent-runtime.md)**

Runner 架构、运行环境类型（Docker/Local/Remote）、工作区文件存储（home/internal 分离）、在线终端、通信协议、运行时生命周期。

扩展模块：ToolRegistry 工具注册与参数修正、MCP Server 懒连接与超时保护、子 Agent 隔离执行、消息总线解耦、Heartbeat 自主唤醒、LLM 调用容错增强、Skill 需求检查与渐进加载、Bootstrap 文件体系。

## 五、数据模型

> 详见 **[data-model.md](./data-model.md)**

主数据库 Schema（用户、邀请码、工作区、Provider、用户偏好、技能、MCP Server、定时任务、审计日志）。工作区 SQLite（sessions、messages、memories、todos）。向量检索、WAL 模式、数据分层策略。

## 六、权限模型

> 详见 **[data-model.md](./data-model.md)** — 权限模型章节

系统角色（admin/user）、工作区权限（createdBy 归属）、Provider 绑定优先级。

## 七、API 设计

> 详见 **[api-webui.md](./api-webui.md)**

REST API（控制面 + 用户面）、WebSocket 协议（客户端 ↔ 服务端消息类型）。

## 八、WebUI 页面结构

> 详见 **[api-webui.md](./api-webui.md)** — WebUI 章节

公开页面、用户面（对话/个人设置/统计）、控制面（admin 管理）。

## 九、定时任务

> 详见 **[deployment.md](./deployment.md)**

node-cron 调度、p-queue 并发控制、容错策略、数据库迁移、三方言差异处理。

## 十、安全设计

> 详见 **[security.md](./security.md)**

认证安全（JWT + bcrypt + 登录限流）、API 安全（RBAC + Zod + CORS）、数据安全（AES-256-GCM 加密）、Agent 行为安全（三层防护：System Prompt + ToolGuard + 审计告警）、运行环境安全（Docker 隔离 + 路径白名单 + 连接安全）。

## 十一、上下文组装

> 详见 **[context-memory.md](./context-memory.md)**

Session 与渠道关系、7 步上下文组装顺序（Bootstrap → 偏好 → 记忆分级 → Skills → 内置工具 → MCP 工具 → 历史）、Token 驱动整合（三级降级）、记忆沉淀机制（memory_write/read/search）。

## 十二、使用统计

> 详见 **[deployment.md](./deployment.md)** — 使用统计章节

Token 用量记录、统计看板（按时间/工作区/Provider）、定时任务执行历史。

## 十三、分阶段交付

> 详见 **[deployment.md](./deployment.md)** — 分阶段交付章节

| 阶段 | 范围 |
|------|------|
| P0 | 核心骨架：工程结构 + DB schema + 邀请码注册/认证 + 基础 API |
| P1 | Agent 运行时：Runner + 工具集 + 流式通信（含 thinking_delta） |
| P2 | WebUI：对话界面 + 在线终端 + 管理控制台 |
| P3 | 记忆/技能/MCP 系统 + 上下文组装 + Provider 管理 |
| P4 | 定时任务 + Agent 行为安全 + 使用统计看板 |
| P5 | Agent Runtime 增强：Token 驱动整合 + ToolRegistry + MCP 懒连接 + 消息总线 + 子 Agent + Heartbeat |
| P6 | 渠道扩展：Telegram / 飞书 / 企微（基于消息总线） |
