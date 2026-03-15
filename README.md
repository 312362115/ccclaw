# CCCLaw

登录即用的 AI Agent 服务平台。用户通过 Web 界面与 AI Agent 对话，Agent 可调用工具（Bash、文件读写、Git、Web 搜索等）完成复杂任务。

## 快速开始

**环境要求：** Node.js >= 22，pnpm

```bash
# 1. 首次初始化（安装依赖、生成 .env、数据库迁移、创建 admin 用户）
make setup

# 2. 修改 .env 中的 ADMIN_EMAIL 和 ADMIN_PASSWORD

# 3. 启动开发环境（Server:3000 + Web:5173）
make dev
```

访问 http://localhost:5173 即可使用。

## 架构概览

pnpm monorepo，4 个包：

```
packages/
├── shared/          # 公共类型、校验、加密工具（Zod schema、AES-256-GCM）
├── server/          # 后端 API（Hono + Drizzle ORM + WebSocket）
├── web/             # 前端 SPA（React 19 + Vite + Zustand）
└── agent-runtime/   # Agent 运行时（沙箱中执行，通过 WebSocket 连接 Server）
```

**核心流程：**

```
用户 → Web UI → WebSocket → Server(AgentManager) → Runner(agent-runtime) → LLM API
```

- **Server** 负责用户认证、工作区管理、Provider 配置、任务调度
- **Runner** 在沙箱环境运行 Agent，管理 workspace.db（会话、消息、记忆）
- **AgentManager** 组装上下文（技能、MCP Server、用户偏好），解析 Provider，分发到 Runner

## 数据库

支持三种方言，通过 `DB_DIALECT` 环境变量切换：

| 方言 | 场景 | 配置 |
|------|------|------|
| `sqlite` | 开发/单机部署 | 默认，数据文件在 `DATA_DIR/ccclaw.db` |
| `postgresql` | 生产推荐 | 需设置 `DATABASE_URL` |
| `mysql` | 企业内网 | 需设置 `DATABASE_URL` |

**数据库迁移**：每种方言有独立的 schema 文件和迁移目录，生成迁移时需指定方言：

```bash
# SQLite（默认）
make db-generate

# PostgreSQL
DB_DIALECT=postgresql make db-generate

# MySQL
DB_DIALECT=mysql make db-generate

# 执行迁移（同样受 DB_DIALECT 控制）
make db-migrate
```

## Make 命令

```
make setup           # 首次初始化
make dev             # 启动 Server + Web
make server          # 仅启动 Server
make web             # 仅启动 Web
make runner          # 启动本地 Runner（需先启动 Server）
make db-generate     # 生成 DB 迁移文件
make db-migrate      # 执行 DB 迁移
make db-seed         # Seed admin 用户
make build           # 构建所有包
make typecheck       # 全量类型检查
make test            # 运行测试
make lint            # Lint 检查
make docker-dev      # Docker 开发环境（PG + Caddy）
make docker-prod     # Docker 生产部署
make docker-sqlite   # Docker SQLite 模式
make clean           # 清理构建产物
make help            # 显示帮助
```

## Docker 部署

```bash
# 生产部署（PostgreSQL）
make docker-prod

# 轻量部署（SQLite）
make docker-sqlite

# 开发环境（PG + Caddy 反代）
make docker-dev
```

## 环境变量

参见 `.env.example`，关键配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_DIALECT` | 数据库方言 | `sqlite` |
| `DATABASE_URL` | PG/MySQL 连接串 | — |
| `JWT_SECRET` | JWT 签名密钥 | setup 自动生成 |
| `ENCRYPTION_KEY` | AES-256 加密密钥（Provider API Key） | setup 自动生成 |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@example.com` |
| `ADMIN_PASSWORD` | 管理员密码 | 需手动修改 |
| `DATA_DIR` | 数据目录（SQLite DB、工作区文件） | `/data/ccclaw` |
| `PORT` | Server 端口 | `3000` |
| `RUNNER_SECRET` | Runner 认证密钥 | setup 自动生成 |
| `SCHEDULER_CONCURRENCY` | 定时任务并发数 | `3` |
| `MAX_TASKS_PER_USER` | 每用户最多定时任务 | `10` |

用户的 LLM API Key 在 Web 界面「个人设置 → Provider」中配置，AES-256-GCM 加密存储。

## 当前状态

**已完成（骨架）：**
- 用户认证（注册/登录/JWT）
- 工作区 CRUD、技能/MCP Server/Provider 管理
- 控制台页面（仪表盘、工作区、Provider、技能、日志、用户管理、设置）
- 对话界面（WebSocket 连接、消息流式展示）
- Runner 连接管理（心跳、重连）
- 工具定义（Bash、File、Git、Glob、Grep、WebFetch）
- ToolGuard 安全拦截规则
- 定时任务调度框架
- Docker 部署配置

**待实现（核心功能）：**
- Agent 真实调用 LLM API（当前为 echo 占位）
- 会话/消息持久化（workspace.db 读写）
- 工具集成到 Agent 执行流程
- ToolGuard 集成到 AgentManager
- 频道适配器（Telegram、飞书等）
