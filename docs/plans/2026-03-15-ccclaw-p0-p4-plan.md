# CCCLaw 一期实现计划 (P0-P4)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个基于 Agent SDK（当前 Claude，架构支持多 Provider）的永远在线 AI Agent 服务平台，支持工作区管理、沙箱隔离执行、WebUI 对话、记忆/技能系统和定时任务。

**Architecture:** 单体 TypeScript 服务（Hono + Drizzle + PostgreSQL/MySQL/SQLite 三方言），通过 Docker API 管理沙箱容器。WebUI 用 React + Vite 构建为静态文件由主服务托管。monorepo 结构（pnpm workspace）分为 server、web、agent-runtime、shared 四个包。

**Tech Stack:** TypeScript, Hono, Drizzle, PostgreSQL/MySQL/SQLite, Docker (dockerode), ws, React, Vite, pino, jose, zod, bcryptjs, node-cron, p-queue, mysql2

**Spec:** `docs/specs/system-design/2026-03-15-ccclaw-design.md`

---

## File Structure Overview

```
ccclaw/
├── package.json                          # root workspace config
├── pnpm-workspace.yaml
├── tsconfig.base.json                    # 共享 TS 配置
├── docker/
│   ├── compose.yml                       # PostgreSQL + Server + Caddy
│   ├── compose.dev.yml                   # 开发环境（仅 PostgreSQL）
│   ├── sandbox/
│   │   └── Dockerfile                    # Agent 沙箱容器镜像 + 运行时适配器
│   └── Caddyfile                         # 反向代理配置
├── packages/
│   ├── shared/                           # 共享类型和工具
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts                  # 所有共享 TypeScript 类型
│   │       ├── schemas.ts                # Zod 校验 schema（API 入参）
│   │       ├── constants.ts              # 共享常量
│   │       └── crypto.ts                 # AES-256-GCM 加解密工具
│   ├── server/                           # 主服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts                  # 入口：启动 Hono + ws + cron
│   │       ├── config.ts                 # 环境变量配置（zod 校验）
│   │       ├── db/
│   │       │   ├── schema.types.ts       # 共享 TypeScript 类型（dialect 无关）
│   │       │   ├── schema.pg.ts          # PostgreSQL schema（pgEnum + uuid + jsonb）
│   │       │   ├── schema.sqlite.ts      # SQLite schema（text 替代 enum/uuid/jsonb）
│   │       │   ├── index.ts              # DB 连接实例（根据 DB_DIALECT 选择驱动）
│   │       │   └── seed.ts               # 初始 admin 用户 seed
│   │       ├── auth/
│   │       │   ├── jwt.ts                # JWT 签发/验证/refresh
│   │       │   ├── password.ts           # bcrypt hash/verify
│   │       │   ├── rbac.ts               # 权限检查中间件
│   │       │   └── rate-limit.ts         # 登录限流
│   │       ├── api/
│   │       │   ├── index.ts              # 路由汇总
│   │       │   ├── auth.ts               # /api/auth/*
│   │       │   ├── users.ts              # /api/users/*
│   │       │   ├── workspaces.ts           # /api/workspaces/*
│   │       │   ├── sessions.ts           # /api/workspaces/:id/sessions/*
│   │       │   ├── preferences.ts        # /api/preferences（用户偏好）
│   │       │   ├── memories.ts           # /api/workspaces/:id/memories（代理 Runner workspace.db）
│   │       │   ├── skills.ts             # /api/settings/skills + /api/workspaces/:id/skills
│   │       │   ├── mcp-servers.ts        # /api/settings/mcp-servers + /api/workspaces/:id/mcp-servers
│   │       │   ├── providers.ts          # /api/settings/providers（用户 Provider 管理）
│   │       │   ├── channels.ts           # /api/settings/channels（IM 渠道绑定）
│   │       │   ├── tasks.ts              # /api/workspaces/:id/tasks/*
│   │       │   ├── files.ts              # /api/workspaces/:id/files/* 文件管理
│   │       │   ├── dashboard.ts          # /api/settings/dashboard（使用统计）
│   │       │   └── logs.ts               # /api/settings/logs + /api/admin/logs
│   │       ├── core/
│   │       │   ├── runner-manager.ts      # RunnerManager（统一 Runner 管理）
│   │       │   ├── agent-manager.ts      # Agent 会话管理 + 上下文组装
│   │       │   ├── workspace-proxy.ts    # 代理 Runner 查询 workspace.db（sessions/memories API 用）
│   │       │   ├── provider/             # Provider 抽象层（解析凭证、调用适配）
│   │       │   │   └── index.ts
│   │       │   ├── tool-guard.ts         # 工具调用拦截规则
│   │       │   ├── scheduler.ts          # node-cron + p-queue 定时任务
│   │       │   └── workspace-storage.ts  # 工作区文件目录管理
│   │       ├── channel/
│   │       │   ├── adapter.ts            # 渠道适配器统一接口
│   │       │   └── webui.ts              # WebSocket 处理
│   │       ├── middleware/
│   │       │   ├── auth.ts               # JWT 认证中间件
│   │       │   ├── security.ts           # secureHeaders + CORS
│   │       │   └── audit.ts              # 审计日志中间件
│   │       ├── skills/                   # 系统预置 Skill（创建工作区时复制）
│   │       │   ├── find-skills/         # 技能发现（浏览和安装社区 Skill）
│   │       │   ├── skill-creator/       # 技能开发（创建、修改、测试自定义 Skill）
│   │       │   ├── superpowers/         # 开发工作流（brainstorming、writing-plans、TDD 等 12 个）
│   │       │   └── anthropic/           # 文档与工具（schedule、pdf/docx/xlsx/pptx、frontend-design）
│   │       └── logger.ts                 # Pino 配置
│   ├── agent-runtime/                    # Runner 进程（沙箱内运行）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # 入口：WebSocket 主动连接 Server 注册
│   │       ├── agent.ts                  # Agent SDK 封装（当前 Claude，支持多 Provider）
│   │       ├── protocol.ts              # JSON-RPC 协议处理（Server ↔ Runner）
│   │       ├── workspace-db.ts          # workspace.db 读写（sessions + messages + memories）
│   │       ├── context-assembler.ts     # 上下文组装（偏好 + 记忆 + skills + 历史 → system prompt）
│   │       ├── skill-loader.ts          # 加载工作区 skills/ 目录下的 .md 文件
│   │       ├── mcp-manager.ts           # MCP Server 子进程启动与管理
│   │       ├── terminal-manager.ts      # node-pty 终端管理（最多 2 个/工作区，10min 空闲超时）
│   │       ├── heartbeat.ts             # WebSocket 心跳保活（30s ping，60s 超时断线重连）
│   │       ├── tools/                    # 内置工具集
│   │       │   ├── index.ts
│   │       │   ├── bash.ts
│   │       │   ├── file.ts
│   │       │   ├── git.ts
│   │       │   ├── glob.ts
│   │       │   ├── grep.ts
│   │       │   ├── web-fetch.ts
│   │       │   ├── memory.ts            # memory_write / memory_read / memory_search
│   │       │   └── todo.ts              # todo_read / todo_write
│   │       └── utils/
│   │           ├── path-guard.ts        # 路径白名单校验（isAllowedPath + 符号链接检查）
│   │           └── safe-env.ts          # 安全环境变量构建（过滤敏感变量）
│   └── web/                             # React WebUI
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx                  # 入口
│           ├── App.tsx                   # 路由配置
│           ├── api/                      # API 客户端
│           │   ├── client.ts             # fetch wrapper + auth
│           │   └── ws.ts                 # WebSocket 客户端
│           ├── stores/                   # 状态管理
│           │   ├── auth.ts
│           │   └── chat.ts
│           ├── pages/
│           │   ├── public/                  # ═══ 公开页面（未登录可访问）═══
│           │   │   ├── Landing.tsx           # / 首页：产品介绍
│           │   │   ├── Login.tsx             # /login
│           │   │   └── Register.tsx          # /register（邀请码注册）
│           │   ├── workbench/                # ═══ 用户面 — 工作台（所有登录用户操作）═══
│           │   │   ├── WorkbenchLayout.tsx   # 工作台整体布局（顶栏 + 侧栏导航）
│           │   │   ├── WorkspaceList.tsx     # /workbench 工作区列表 + 创建工作区（工作台首页）
│           │   │   ├── workspace/            # 单个工作区（/workspace/:workspaceId/*）
│           │   │   │   ├── WorkspaceLayout.tsx  # 工作区布局（左栏会话列表 + 右栏内容区）
│           │   │   │   ├── SessionList.tsx      # 会话列表侧栏
│           │   │   │   ├── ChatView.tsx         # /workspace/:id/:sessionId 对话流
│           │   │   │   ├── MessageBubble.tsx    # 单条消息（含工具调用 + thinking）
│           │   │   │   ├── Terminal.tsx          # /workspace/:id/terminal（xterm.js）
│           │   │   │   └── WorkspaceSettings.tsx # /workspace/:id/settings（记忆、skill、MCP、定时任务）
│           │   │   ├── settings/             # 个人设置
│           │   │   │   ├── Profile.tsx       # /settings/profile（个人信息 + git 凭证）
│           │   │   │   ├── Preferences.tsx   # /settings/preferences（语言、风格）
│           │   │   │   ├── Providers.tsx     # /settings/providers（API Key / OAuth）
│           │   │   │   ├── Skills.tsx        # /settings/skills（用户级 Skill）
│           │   │   │   └── McpServers.tsx    # /settings/mcp-servers（用户级 MCP）
│           │   │   ├── Dashboard.tsx         # /settings/dashboard（token 用量统计看板）
│           │   │   └── Logs.tsx              # /settings/logs（个人操作日志）
│           │   └── admin/                    # ═══ 控制面 — 系统管理（admin）═══
│           │       ├── AdminLayout.tsx       # /admin 布局（侧栏导航 + 概览仪表盘）
│           │       ├── Users.tsx             # /admin/users（用户管理）
│           │       ├── InviteCodes.tsx       # /admin/invite-codes（邀请码管理）
│           │       ├── AdminLogs.tsx         # /admin/logs（全局操作日志）
│           │       └── AdminSettings.tsx     # /admin/settings（系统设置）
│           └── components/              # 通用组件
│               ├── Layout.tsx
│               ├── ProtectedRoute.tsx
│               └── ConfirmDialog.tsx     # 高危操作审批弹窗
└── docs/
    ├── specs/
    │   └── 2026-03-15-ccclaw-design.md
    └── plans/
        └── 2026-03-15-ccclaw-p0-p4-plan.md
```

---

## Chunk 1: P0 — 工程骨架 + 数据库 + 认证

### Task 1: Monorepo 初始化

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/tsconfig.json`

- [ ] **Step 1: 初始化 git 仓库**

```bash
cd /Users/renlongyu/Desktop/ccclaw
git init
```

- [ ] **Step 2: 创建根 package.json**

```json
{
  "name": "ccclaw",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @ccclaw/server dev",
    "build": "pnpm -r build",
    "migrate": "pnpm --filter @ccclaw/server migrate",
    "seed": "pnpm --filter @ccclaw/server seed",
    "lint": "eslint packages/*/src",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 3: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 4: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 6: 创建 .env.example**

```env
# 数据库方言：sqlite（低配快速验证） 或 postgresql（生产推荐）
DB_DIALECT=sqlite
# PostgreSQL 模式必填，SQLite 模式忽略
DATABASE_URL=postgresql://ccclaw:ccclaw@localhost:5432/ccclaw
JWT_SECRET=change-me-to-a-random-string
ENCRYPTION_KEY=change-me-to-a-32-byte-hex-string
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
DATA_DIR=/data/ccclaw
PORT=3000
# 用户需在 Web 界面「个人设置 → Provider」中配置自己的 API Key
```

- [ ] **Step 7: 创建各包的 package.json 和 tsconfig.json**

`packages/shared/package.json`:
```json
{
  "name": "@ccclaw/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/server/package.json`:
```json
{
  "name": "@ccclaw/server",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "migrate": "drizzle-kit migrate",
    "generate": "drizzle-kit generate",
    "seed": "tsx src/db/seed.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ccclaw/shared": "workspace:*",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.0",
    "mysql2": "^3.11.0",
    "better-sqlite3": "^11.7.0",
    "ws": "^8.18.0",
    "jose": "^5.9.0",
    "bcryptjs": "^2.4.3",
    "zod": "^3.23.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "dockerode": "^4.0.0",
    "node-cron": "^3.0.0",
    "p-queue": "^8.0.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "@types/bcryptjs": "^2.4.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/dockerode": "^3.3.0",
    "@types/node-cron": "^3.0.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/agent-runtime/package.json`:
```json
{
  "name": "@ccclaw/agent-runtime",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ccclaw/shared": "workspace:*",
    "@anthropic-ai/claude-code": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

`packages/agent-runtime/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/web/package.json`:
```json
{
  "name": "@ccclaw/web",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ccclaw/shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 8: 安装依赖**

```bash
pnpm install
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: 初始化 monorepo 工程结构"
```

---

### Task 2: Docker 开发环境

**Files:**
- Create: `docker/compose.dev.yml`
- Create: `docker/compose.yml`
- Create: `docker/Caddyfile`

- [ ] **Step 1: 创建开发环境 compose 文件**

`docker/compose.dev.yml`（PostgreSQL 模式，开发使用）:
```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ccclaw
      POSTGRES_PASSWORD: ccclaw
      POSTGRES_DB: ccclaw
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  pg_data:
```

> SQLite 模式开发时无需 compose 文件，直接 `pnpm dev` 即可，数据文件在 `DATA_DIR/ccclaw.db`。

- [ ] **Step 2a: 创建生产环境 compose 文件（PostgreSQL 模式）**

`docker/compose.yml`:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - server
    restart: unless-stopped

  server:
    build:
      context: ..
      dockerfile: docker/server.Dockerfile
    expose:
      - "3000"
    environment:
      DB_DIALECT: postgresql
      DATABASE_URL: postgresql://ccclaw:${DB_PASSWORD}@postgres:5432/ccclaw
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      DATA_DIR: /data/ccclaw
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - app_data:/data/ccclaw
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ccclaw
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ccclaw
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  pg_data:
  caddy_data:
  caddy_config:
  app_data:
```

- [ ] **Step 2b: 创建低配生产 compose 文件（SQLite 模式）**

`docker/compose.sqlite.yml`:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - server
    restart: unless-stopped

  server:
    build:
      context: ..
      dockerfile: docker/server.Dockerfile
    expose:
      - "3000"
    environment:
      DB_DIALECT: sqlite
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      DATA_DIR: /data/ccclaw
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - app_data:/data/ccclaw
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
  app_data:
```

- [ ] **Step 3: 创建 Caddyfile**

`docker/Caddyfile`:
```
{$DOMAIN:localhost} {
    reverse_proxy server:3000
}
```

- [ ] **Step 4: 启动开发数据库**

```bash
cd /Users/renlongyu/Desktop/ccclaw
docker compose -f docker/compose.dev.yml up -d
```

- [ ] **Step 5: Commit**

```bash
git add docker/
git commit -m "chore: 添加 Docker Compose 开发和生产配置"
```

---

### Task 3: 共享类型和工具

**Files:**
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/crypto.ts`

- [ ] **Step 1: 写 crypto 工具的测试**

Create `packages/shared/src/crypto.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('crypto', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('should encrypt and decrypt a string', () => {
    const plaintext = 'sk-ant-api03-secret-key';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('should produce different ciphertexts for same input', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a).not.toBe(b);
  });

  it('should throw on wrong key', () => {
    const encrypted = encrypt('secret', key);
    const wrongKey = 'ff'.repeat(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/renlongyu/Desktop/ccclaw
pnpm --filter @ccclaw/shared exec vitest run src/crypto.test.ts
```
Expected: FAIL — `crypto.js` 不存在

- [ ] **Step 3: 实现 crypto.ts**

`packages/shared/src/crypto.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @ccclaw/shared exec vitest run src/crypto.test.ts
```
Expected: PASS

- [ ] **Step 5: 创建共享类型**

`packages/shared/src/types.ts`:
```typescript
// 系统角色
export type SystemRole = 'admin' | 'user';

// 记忆类型（工作区 workspace.db 中使用）
export type MemoryType = 'project' | 'reference' | 'decision' | 'feedback' | 'log';

// 会话状态
export type SessionStatus = 'active' | 'archived';

// 定时任务运行状态
export type TaskRunStatus = 'running' | 'success' | 'failed';

// Provider 类型（系统支持的模型服务商）
export type ProviderType = 'claude' | 'openai' | 'deepseek';

// Provider 认证方式
export type ProviderAuthType = 'api_key' | 'oauth';

// WebSocket 消息类型
export interface WsClientMessage {
  type: 'auth' | 'message' | 'cancel' | 'confirm_response';
  token?: string;
  sessionId?: string;
  content?: string;
  requestId?: string;
  approved?: boolean;
}

export interface WsServerMessage {
  type: 'thinking_delta' | 'text_delta' | 'tool_use' | 'tool_result' | 'confirm_request' | 'done' | 'error';
  sessionId?: string;
  content?: string;
  tool?: string;
  input?: string;
  output?: string;
  requestId?: string;
  reason?: string;
  tokens?: number;
  message?: string;
}

// 工具拦截结果
export type ToolGuardResult = 'allow' | 'block' | 'confirm';
```

- [ ] **Step 6: 创建 Zod schemas**

`packages/shared/src/schemas.ts`:
```typescript
import { z } from 'zod';

// Auth
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// User
export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']).default('user'),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
});

// Workspace
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  gitRepo: z.string().url().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  gitRepo: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
});

// Session
export const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional().default('新会话'),
});

// Memory
export const createMemorySchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100),
  type: z.enum(['user', 'feedback', 'project', 'reference']),
  content: z.string().min(1),
});

export const updateMemorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
  content: z.string().min(1).optional(),
});

// Skill
export const createSkillSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  content: z.string().min(1),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  content: z.string().min(1).optional(),
});

// Provider
export const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['claude', 'openai', 'deepseek']).default('claude'),
  authType: z.enum(['api_key', 'oauth']).default('api_key'),
  config: z.record(z.unknown()), // api_key: { key, apiBase? } / oauth: { clientId, clientSecret, tokenUrl }
  isDefault: z.boolean().optional().default(false),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

// Register（邀请码注册）
export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().min(1).max(20),
});

// Invite Code（管理员创建）
export const createInviteCodeSchema = z.object({
  count: z.number().int().min(1).max(50).default(1), // 批量生成数量
  expiresAt: z.string().datetime().optional(), // 过期时间
});

// Scheduled Task
export const createTaskSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cron: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

// Chat message
export const chatMessageSchema = z.object({
  content: z.string().min(1),
});
```

- [ ] **Step 7: 创建 constants.ts 和 index.ts**

`packages/shared/src/constants.ts`:
```typescript
export const MAX_CONCURRENT_SANDBOXES = 5;
export const SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SANDBOX_MEMORY_LIMIT = 512 * 1024 * 1024; // 512MB
export const SANDBOX_CPU_QUOTA = 50000; // 50%
export const SESSION_HISTORY_LIMIT = 20;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;
export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = 7;
export const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const AGENT_MAX_RETRIES = 3;
export const SCHEDULER_MAX_CONCURRENCY = 3;
export const WORKSPACE_LABEL = 'ccclaw.workspace';
```

`packages/shared/src/index.ts`:
```typescript
export * from './types.js';
export * from './schemas.js';
export * from './constants.js';
export * from './crypto.js';
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/
git commit -m "feat: 添加共享类型、Zod schemas、加密工具"
```

---

### Task 4: 数据库 Schema + 迁移 + 密码工具

**Files:**
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/logger.ts`
- Create: `packages/server/src/auth/password.ts`
- Create: `packages/server/src/db/schema.types.ts`
- Create: `packages/server/src/db/schema.pg.ts`
- Create: `packages/server/src/db/schema.mysql.ts`
- Create: `packages/server/src/db/schema.sqlite.ts`
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/drizzle.config.ts`

- [ ] **Step 1: 创建配置模块**

`packages/server/src/config.ts`:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  DB_DIALECT: z.enum(['sqlite', 'postgresql', 'mysql']).default('sqlite'),
  DATABASE_URL: z.string().optional(), // PostgreSQL / MySQL 模式必填
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  RUNNER_SECRET: z.string().min(16).default(() => randomBytes(32).toString('hex')), // Runner 认证密钥
  DATA_DIR: z.string().default('/data/ccclaw'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SCHEDULER_CONCURRENCY: z.coerce.number().default(3), // 定时任务全局并发数
  MAX_TASKS_PER_USER: z.coerce.number().default(10),   // 每用户最多定时任务数
}).refine(
  (env) => env.DB_DIALECT === 'sqlite' || !!env.DATABASE_URL,
  { message: 'DATABASE_URL is required when DB_DIALECT is postgresql or mysql', path: ['DATABASE_URL'] },
);

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
```

- [ ] **Step 2: 创建 logger**

`packages/server/src/logger.ts`:
```typescript
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: config.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});
```

- [ ] **Step 3: 创建共享类型定义**

`packages/server/src/db/schema.types.ts`:
```typescript
// 两种 dialect 共享的枚举值和类型常量
export const SYSTEM_ROLES = ['admin', 'user'] as const;
export const SESSION_STATUSES = ['active', 'archived'] as const;
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export const TASK_RUN_STATUSES = ['running', 'success', 'failed'] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
```

- [ ] **Step 3b: 创建 PostgreSQL schema**

`packages/server/src/db/schema.pg.ts`:
```typescript
import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer, uniqueIndex, primaryKey, pgEnum } from 'drizzle-orm/pg-core';
import { SYSTEM_ROLES, SESSION_STATUSES, MEMORY_TYPES, TASK_RUN_STATUSES } from './schema.types.js';

export const systemRoleEnum = pgEnum('system_role', SYSTEM_ROLES);
export const sessionStatusEnum = pgEnum('session_status', SESSION_STATUSES);
export const memoryTypeEnum = pgEnum('memory_type', MEMORY_TYPES);
export const taskRunStatusEnum = pgEnum('task_run_status', TASK_RUN_STATUSES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  role: systemRoleEnum('role').notNull().default('user'),
  gitToken: text('git_token'), // AES-256-GCM encrypted，用户级 git 凭证
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: varchar('language', { length: 20 }), // 回复语言偏好，如 'zh-CN'
  style: varchar('style', { length: 50 }), // 回复风格，如 '简洁' | '详细'
  customRules: text('custom_rules'), // 用户自定义规则（自由文本）
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  gitRepo: varchar('git_repo', { length: 500 }),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('claude'), // 'claude' | 'openai' | 'deepseek'
  authType: varchar('auth_type', { length: 20 }).notNull().default('api_key'), // 'api_key' | 'oauth'
  config: jsonb('config').notNull(), // AES-256-GCM 加密，api_key: { key, apiBase? } / oauth: { clientId, ... }
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// sessions、messages、memories 不在主数据库
// 存放在工作区 workspace.db（SQLite + WAL）中，Runner 本地读写
// Server 通过 RunnerManager 代理 Runner 查询，schema 定义在 agent-runtime/workspace-db.ts

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = 用户级
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('skills_unique').on(t.userId, t.workspaceId, t.name)]);

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = 用户级
  name: varchar('name', { length: 100 }).notNull(),
  command: varchar('command', { length: 500 }).notNull(),
  args: jsonb('args').notNull().default([]),
  env: jsonb('env'),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('mcp_servers_unique').on(t.userId, t.workspaceId, t.name)]);

export const scheduledTasks = pgTable('scheduled_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  cron: varchar('cron', { length: 100 }).notNull(),
  prompt: text('prompt').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
});

export const taskRuns = pgTable('task_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  status: taskRunStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  error: text('error'),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  detail: jsonb('detail'),
  ip: varchar('ip', { length: 45 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const inviteCodes = pgTable('invite_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  usedBy: uuid('used_by').references(() => users.id),
  usedAt: timestamp('used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tokenUsage = pgTable('token_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id),
  model: varchar('model', { length: 100 }).notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 500 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

- [ ] **Step 3c: 创建 SQLite schema**

`packages/server/src/db/schema.sqlite.ts`:
```typescript
import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// SQLite 没有 enum / uuid / jsonb，全部用 text 替代
// id 默认值通过应用层 crypto.randomUUID() 生成

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => text('created_at').notNull().$defaultFn(() => new Date().toISOString());

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull().default('user'), // 'admin' | 'user'
  gitToken: text('git_token'), // AES-256-GCM encrypted，用户级 git 凭证
  createdAt: createdAt(),
});

export const userPreferences = sqliteTable('user_preferences', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  language: text('language'), // 回复语言偏好，如 'zh-CN'
  style: text('style'), // 回复风格，如 '简洁' | '详细'
  customRules: text('custom_rules'), // 用户自定义规则（自由文本）
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdBy: text('created_by').notNull().references(() => users.id),
  gitRepo: text('git_repo'),
  settings: text('settings', { mode: 'json' }).notNull().default('{}'),
  createdAt: createdAt(),
});

export const providers = sqliteTable('providers', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('claude'), // 'claude' | 'openai' | 'deepseek'
  authType: text('auth_type').notNull().default('api_key'), // 'api_key' | 'oauth'
  config: text('config', { mode: 'json' }).notNull(), // AES-256-GCM 加密
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

// sessions、messages、memories 不在主数据库
// 存放在工作区 workspace.db 中，schema 见 packages/server/src/core/workspace-db.ts

export const skills = sqliteTable('skills', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = 用户级
  name: text('name').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull(),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [uniqueIndex('skills_unique').on(t.userId, t.workspaceId, t.name)]);

export const mcpServers = sqliteTable('mcp_servers', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = 用户级
  name: text('name').notNull(),
  command: text('command').notNull(),
  args: text('args', { mode: 'json' }).notNull().$type<string[]>().default([]),
  env: text('env', { mode: 'json' }).$type<Record<string, string>>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [uniqueIndex('mcp_servers_unique').on(t.userId, t.workspaceId, t.name)]);

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  prompt: text('prompt').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
});

export const taskRuns = sqliteTable('task_runs', {
  id: id(),
  taskId: text('task_id').notNull().references(() => scheduledTasks.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  status: text('status').notNull().default('running'), // 'running' | 'success' | 'failed'
  startedAt: text('started_at').notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text('finished_at'),
  error: text('error'),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  detail: text('detail', { mode: 'json' }),
  ip: text('ip').notNull(),
  createdAt: createdAt(),
});

export const inviteCodes = sqliteTable('invite_codes', {
  id: id(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').notNull().references(() => users.id),
  usedBy: text('used_by').references(() => users.id),
  usedAt: text('used_at'),
  expiresAt: text('expires_at'),
  createdAt: createdAt(),
});

export const tokenUsage = sqliteTable('token_usage', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  providerId: text('provider_id').notNull().references(() => providers.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: createdAt(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: createdAt(),
});
```

- [ ] **Step 4: 创建 DB 连接**

`packages/server/src/db/index.ts`:
```typescript
import { config } from '../config.js';
import { logger } from '../logger.js';

// 根据 DB_DIALECT 动态选择驱动和 schema
async function createDb() {
  if (config.DB_DIALECT === 'sqlite') {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const Database = (await import('better-sqlite3')).default;
    const schema = await import('./schema.sqlite.js');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const dbPath = path.join(config.DATA_DIR, 'ccclaw.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL'); // 提升并发读性能
    sqlite.pragma('foreign_keys = ON');
    logger.info({ dialect: 'sqlite', path: dbPath }, '数据库已连接');
    return { db: drizzle(sqlite, { schema }), schema, dialect: 'sqlite' as const };
  } else if (config.DB_DIALECT === 'mysql') {
    const { drizzle } = await import('drizzle-orm/mysql2');
    const mysql = await import('mysql2/promise');
    const schema = await import('./schema.mysql.js');

    const pool = mysql.createPool(config.DATABASE_URL!);
    logger.info({ dialect: 'mysql' }, '数据库已连接');
    return { db: drizzle(pool, { schema, mode: 'default' }), schema, dialect: 'mysql' as const };
  } else {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('./schema.pg.js');

    const client = postgres(config.DATABASE_URL!);
    logger.info({ dialect: 'postgresql' }, '数据库已连接');
    return { db: drizzle(client, { schema }), schema, dialect: 'postgresql' as const };
  }
}

export const { db, schema, dialect } = await createDb();
```

- [ ] **Step 5: 创建 drizzle.config.ts**

`packages/server/drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit';
import path from 'node:path';

const dialect = (process.env.DB_DIALECT || 'sqlite') as 'postgresql' | 'mysql' | 'sqlite';

const configs = {
  sqlite: {
    schema: './src/db/schema.sqlite.ts',
    out: './src/db/migrations-sqlite',
    dialect: 'sqlite' as const,
    dbCredentials: {
      url: path.join(process.env.DATA_DIR || '/data/ccclaw', 'ccclaw.db'),
    },
  },
  mysql: {
    schema: './src/db/schema.mysql.ts',
    out: './src/db/migrations-mysql',
    dialect: 'mysql' as const,
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  },
  postgresql: {
    schema: './src/db/schema.pg.ts',
    out: './src/db/migrations-pg',
    dialect: 'postgresql' as const,
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
  },
};

export default defineConfig(configs[dialect]);
```

- [ ] **Step 6: 生成并执行迁移**

```bash
cd /Users/renlongyu/Desktop/ccclaw
pnpm --filter @ccclaw/server generate
pnpm --filter @ccclaw/server migrate
```

- [ ] **Step 6.5: 创建 password 工具（seed 脚本依赖）**

`packages/server/src/auth/password.ts`:
```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 7: 创建 seed 脚本**

`packages/server/src/db/seed.ts`:
```typescript
import { db, schema } from './index.js';
import { hashPassword } from '../auth/password.js';
import { encrypt } from '@ccclaw/shared/crypto.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { eq } from 'drizzle-orm';

async function seed() {
  // 1. Seed admin 用户
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const existing = await db.select().from(schema.users)
      .where(eq(schema.users.email, config.ADMIN_EMAIL)).limit(1);

    if (existing.length === 0) {
      await db.insert(schema.users).values({
        name: 'Admin',
        email: config.ADMIN_EMAIL,
        password: await hashPassword(config.ADMIN_PASSWORD),
        role: 'admin',
      });
      logger.info('Admin 用户创建成功');
    } else {
      logger.info('Admin 用户已存在，跳过');
    }
  } else {
    logger.warn('ADMIN_EMAIL 和 ADMIN_PASSWORD 未设置，跳过 admin seed');
  }

  // Provider 由用户在 Web 界面自行配置，seed 不预置

  process.exit(0);
}

seed().catch((err) => {
  logger.error(err, 'Seed 失败');
  process.exit(1);
});
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/logger.ts packages/server/src/db/ packages/server/drizzle.config.ts
git commit -m "feat: 添加数据库 schema、迁移和 seed 脚本"
```

---

### Task 5: 认证系统

**Files:**
- Create: `packages/server/src/auth/password.ts`
- Create: `packages/server/src/auth/jwt.ts`
- Create: `packages/server/src/auth/rate-limit.ts`
- Create: `packages/server/src/auth/rbac.ts`
- Create: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/src/middleware/security.ts`
- Create: `packages/server/src/middleware/audit.ts`

- [ ] **Step 1: 写 password 工具测试**

Create `packages/server/src/auth/password.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('should hash and verify password', async () => {
    const hash = await hashPassword('test-password');
    expect(hash).not.toBe('test-password');
    expect(await verifyPassword('test-password', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @ccclaw/server exec vitest run src/auth/password.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 password.ts**

`packages/server/src/auth/password.ts`:
```typescript
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @ccclaw/server exec vitest run src/auth/password.test.ts
```
Expected: PASS

- [ ] **Step 5: 实现 jwt.ts**

`packages/server/src/auth/jwt.ts`:
```typescript
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY_DAYS } from '@ccclaw/shared';
import { db, schema } from '../db/index.js';
import { eq, and, gt } from 'drizzle-orm';

const secret = new TextEncoder().encode(config.JWT_SECRET);

// 使用 schema.refreshTokens 访问表

export interface JwtPayload {
  sub: string; // userId
  role: string;
}

export async function signAccessToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JwtPayload;
}

export async function createRefreshToken(userId: string): Promise<string> {
  // 删除该用户旧的 refresh token（单设备单 token）
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({ userId, token, expiresAt });
  return token;
}

export async function validateRefreshToken(token: string): Promise<string | null> {
  const row = await db.query.refreshTokens.findFirst({
    where: (t, { eq, gt, and }) => and(eq(t.token, token), gt(t.expiresAt, new Date())),
  });
  return row?.userId ?? null;
}

export async function revokeRefreshToken(userId: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}
```

- [ ] **Step 6: 实现 rate-limit.ts（登录限流 + 通用 API 限流）**

`packages/server/src/auth/rate-limit.ts`:
```typescript
import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES } from '@ccclaw/shared';
import type { Context, Next } from 'hono';

// ========== 登录限流（基于 IP） ==========

interface Attempt {
  count: number;
  lockedUntil?: number;
}

const loginAttempts = new Map<string, Attempt>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil) {
    if (Date.now() < record.lockedUntil) {
      return { allowed: false, retryAfterSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000) };
    }
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordLoginFailure(ip: string): void {
  const record = loginAttempts.get(ip) ?? { count: 0 };
  record.count++;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
  }
  loginAttempts.set(ip, record);
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// ========== 通用 API 限流（基于用户 ID，滑动窗口） ==========

interface RateWindow {
  timestamps: number[];
}

const apiWindows = new Map<string, RateWindow>();
const API_RATE_LIMIT = 100; // 每分钟请求数
const API_RATE_WINDOW_MS = 60_000;

export function apiRateLimitMiddleware(maxRequests = API_RATE_LIMIT) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) return next(); // 未认证请求由 auth 中间件拦截

    const key = user.sub;
    const now = Date.now();
    const window = apiWindows.get(key) ?? { timestamps: [] };

    // 清理窗口外的记录
    window.timestamps = window.timestamps.filter((t) => now - t < API_RATE_WINDOW_MS);

    if (window.timestamps.length >= maxRequests) {
      return c.json({ error: '请求频率超限，请稍后再试' }, 429);
    }

    window.timestamps.push(now);
    apiWindows.set(key, window);
    return next();
  };
}

// 定时清理过期窗口（防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of apiWindows.entries()) {
    window.timestamps = window.timestamps.filter((t) => now - t < API_RATE_WINDOW_MS);
    if (window.timestamps.length === 0) apiWindows.delete(key);
  }
}, API_RATE_WINDOW_MS);
```

- [ ] **Step 7: 实现 rbac.ts**

`packages/server/src/auth/rbac.ts`:
```typescript
import type { Context, Next } from 'hono';
import type { SystemRole } from '@ccclaw/shared';
import { db, schema } from '../db/index.js';
import { and, eq } from 'drizzle-orm';

// 检查系统角色（admin 才能访问系统管理功能）
export function requireRole(...roles: SystemRole[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: '权限不足' }, 403);
    }
    return next();
  };
}

// 检查工作区归属（workspace.createdBy === user.id）
export function requireWorkspaceAccess() {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: '未认证' }, 401);

    const workspaceId = c.req.param('id');
    if (!workspaceId) return c.json({ error: '缺少工作区 ID' }, 400);

    const [workspace] = await db.select({ createdBy: schema.workspaces.createdBy })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);

    if (!workspace || workspace.createdBy !== user.sub) {
      return c.json({ error: '无工作区访问权限' }, 403);
    }

    return next();
  };
}
```

- [ ] **Step 8: 实现认证中间件**

`packages/server/src/middleware/auth.ts`:
```typescript
import type { Context, Next } from 'hono';
import { verifyAccessToken } from '../auth/jwt.js';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '未认证' }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token);
    c.set('user', payload);
    return next();
  } catch {
    return c.json({ error: 'Token 无效或已过期' }, 401);
  }
}
```

`packages/server/src/middleware/security.ts`:
```typescript
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { config } from '../config.js';

export const securityHeaders = secureHeaders();

export const corsMiddleware = cors({
  origin: config.NODE_ENV === 'development' ? '*' : (origin) => origin, // 生产环境限制
  credentials: true,
});
```

`packages/server/src/middleware/audit.ts`:
```typescript
import type { Context } from 'hono';
import { db } from '../db/index.js';
import { db, schema } from '../db/index.js';

export async function audit(c: Context, action: string, target: string, detail?: unknown) {
  const user = c.get('user');
  if (!user) return;

  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';

  await db.insert(auditLogs).values({
    userId: user.sub,
    action,
    target,
    detail: detail ?? null,
    ip,
  });
}
```

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/auth/ packages/server/src/middleware/
git commit -m "feat: 实现认证系统（JWT + bcrypt + RBAC + 限流）"
```

---

### Task 6: API 路由 — Auth + Users + Workspaces + Members

**Files:**
- Create: `packages/server/src/api/index.ts`
- Create: `packages/server/src/api/auth.ts`
- Create: `packages/server/src/api/users.ts`
- Create: `packages/server/src/api/workspaces.ts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: 实现 Auth 路由**

`packages/server/src/api/auth.ts`:
```typescript
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { loginSchema } from '@ccclaw/shared';
import { verifyPassword } from '../auth/password.js';
import { signAccessToken, createRefreshToken, validateRefreshToken, revokeRefreshToken } from '../auth/jwt.js';
import { checkLoginRateLimit, recordLoginFailure, clearLoginAttempts } from '../auth/rate-limit.js';
import { authMiddleware } from '../middleware/auth.js';
import { setCookie, getCookie } from 'hono/cookie';
import { REFRESH_TOKEN_EXPIRY_DAYS } from '@ccclaw/shared';

export const authRouter = new Hono();

authRouter.post('/login', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'unknown';
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return c.json({ error: `登录过于频繁，请 ${limit.retryAfterSeconds}s 后重试` }, 429);
  }

  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const user = await db.query.users.findFirst({
    where: eq(users.email, body.data.email),
  });

  if (!user || !(await verifyPassword(body.data.password, user.password))) {
    recordLoginFailure(ip);
    return c.json({ error: '邮箱或密码错误' }, 401);
  }

  clearLoginAttempts(ip);

  const accessToken = await signAccessToken(user.id, user.role);
  const refreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    path: '/api/auth',
  });

  return c.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

authRouter.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user');
  await revokeRefreshToken(user.sub);
  setCookie(c, 'refresh_token', '', { maxAge: 0, path: '/api/auth' });
  return c.json({ ok: true });
});

authRouter.post('/refresh', async (c) => {
  const token = getCookie(c, 'refresh_token');
  if (!token) return c.json({ error: 'Refresh token 缺失' }, 401);

  const userId = await validateRefreshToken(token);
  if (!userId) return c.json({ error: 'Refresh token 无效或已过期' }, 401);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: '用户不存在' }, 401);

  const accessToken = await signAccessToken(user.id, user.role);
  const newRefreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    path: '/api/auth',
  });

  return c.json({ accessToken });
});

authRouter.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user');
  const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
  if (!user) return c.json({ error: '用户不存在' }, 404);
  return c.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// 邀请码注册
authRouter.post('/register', async (c) => {
  const body = registerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  // 验证邀请码
  const invite = await db.query.inviteCodes.findFirst({
    where: and(eq(schema.inviteCodes.code, body.data.inviteCode), isNull(schema.inviteCodes.usedBy)),
  });
  if (!invite) return c.json({ error: '邀请码无效或已使用' }, 400);
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return c.json({ error: '邀请码已过期' }, 400);
  }

  // 检查邮箱是否已存在
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, body.data.email) });
  if (existing) return c.json({ error: '邮箱已注册' }, 400);

  // 创建用户
  const [user] = await db.insert(schema.users).values({
    name: body.data.name,
    email: body.data.email,
    password: await hashPassword(body.data.password),
    role: 'user',
  }).returning();

  // 标记邀请码已使用
  await db.update(schema.inviteCodes)
    .set({ usedBy: user.id, usedAt: new Date() })
    .where(eq(schema.inviteCodes.id, invite.id));

  const accessToken = await signAccessToken(user.id, user.role);
  const refreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true, secure: true, sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60, path: '/api/auth',
  });

  return c.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 201);
});
```

- [ ] **Step 2: 实现 Users 路由**

`packages/server/src/api/users.ts`:
```typescript
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createUserSchema, updateUserSchema } from '@ccclaw/shared';
import { hashPassword } from '../auth/password.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';

export const usersRouter = new Hono();

usersRouter.use('*', authMiddleware, requireRole('admin'));

usersRouter.get('/', async (c) => {
  const all = await db.select({
    id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt,
  }).from(users);
  return c.json(all);
});

usersRouter.post('/', async (c) => {
  const body = createUserSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const existing = await db.query.users.findFirst({ where: eq(users.email, body.data.email) });
  if (existing) return c.json({ error: '邮箱已存在' }, 409);

  const [user] = await db.insert(users).values({
    name: body.data.name,
    email: body.data.email,
    password: await hashPassword(body.data.password),
    role: body.data.role,
  }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });

  await audit(c, 'user.create', user.id);
  return c.json(user, 201);
});

usersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = updateUserSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [updated] = await db.update(users).set(body.data).where(eq(users.id, id))
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });

  if (!updated) return c.json({ error: '用户不存在' }, 404);
  await audit(c, 'user.update', id, body.data);
  return c.json(updated);
});

usersRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  if (id === user.sub) return c.json({ error: '不能删除自己' }, 400);

  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (!deleted) return c.json({ error: '用户不存在' }, 404);
  await audit(c, 'user.delete', id);
  return c.json({ ok: true });
});
```

- [ ] **Step 3: 实现 Workspaces 路由**

`packages/server/src/api/workspaces.ts`:
```typescript
import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@ccclaw/shared';
import { encrypt } from '@ccclaw/shared';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';
import { initWorkspaceStorage } from '../core/workspace-storage.js';

export const workspacesRouter = new Hono();

workspacesRouter.use('*', authMiddleware);

// 列表：返回当前用户创建的所有工作区
workspacesRouter.get('/', async (c) => {
  const user = c.get('user');
  const workspaces = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.createdBy, user.sub));
  return c.json(workspaces);
});

// 所有用户都可以创建工作区，创建者自动成为 owner
workspacesRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createWorkspaceSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const existing = await db.select().from(schema.workspaces).where(eq(schema.workspaces.slug, body.data.slug)).limit(1);
  if (existing.length > 0) return c.json({ error: 'slug 已存在' }, 409);

  const [workspace] = await db.insert(schema.workspaces).values({
    name: body.data.name,
    slug: body.data.slug,
    createdBy: user.sub,
    gitRepo: body.data.gitRepo ?? null,
  } as any).returning();

  // 初始化工作区文件目录（workspace/memory/skills + git clone）
  // git token 从用户表获取
  const [creator] = await db.select({ gitToken: schema.users.gitToken })
    .from(schema.users).where(eq(schema.users.id, user.sub)).limit(1);
  const gitToken = creator?.gitToken ? decrypt(creator.gitToken, config.ENCRYPTION_KEY) : undefined;
  await initWorkspaceStorage(workspace.slug, body.data.gitRepo, gitToken);

  await audit(c, 'workspace.create', workspace.id);
  return c.json(workspace, 201);
});

workspacesRouter.get('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1);
  if (!workspace) return c.json({ error: '工作区不存在' }, 404);
  return c.json(workspace);
});

workspacesRouter.patch('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const body = updateWorkspaceSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [updated] = await db.update(schema.workspaces).set(body.data as any).where(eq(schema.workspaces.id, id)).returning();
  if (!updated) return c.json({ error: '工作区不存在' }, 404);
  await audit(c, 'workspace.update', id);
  return c.json(updated);
});

workspacesRouter.delete('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const [deleted] = await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id)).returning({ id: schema.workspaces.id });
  if (!deleted) return c.json({ error: '工作区不存在' }, 404);
  await audit(c, 'workspace.delete', id);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: 汇总路由并创建服务入口**

`packages/server/src/api/index.ts`:
```typescript
import { Hono } from 'hono';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { workspacesRouter } from './workspaces.js';

export const api = new Hono();

api.route('/auth', authRouter);
api.route('/users', usersRouter);
api.route('/workspaces', workspacesRouter);
```

`packages/server/src/index.ts`:
```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { logger } from './logger.js';
import { api } from './api/index.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';

const app = new Hono();

// 全局中间件
app.use('*', securityHeaders);
app.use('*', corsMiddleware);

// API 路由
app.route('/api', api);

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok' }));

// 启动服务
serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(`CCCLaw server running on port ${info.port}`);
});

export default app;
```

- [ ] **Step 6: 启动服务验证**

```bash
cd /Users/renlongyu/Desktop/ccclaw
cp .env.example .env
# 编辑 .env 设置真实的 JWT_SECRET 和 ENCRYPTION_KEY
pnpm --filter @ccclaw/server dev
# 另一个终端：
curl http://localhost:3000/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/
git commit -m "feat: 实现 Auth + Users + Workspaces + Members API"
```

---

### Task 7: API 路由 — Sessions + Memories + Skills + Providers + Tasks + Files + Logs + Dashboard

**Files:**
- Create: `packages/server/src/api/sessions.ts`
- Create: `packages/server/src/api/memories.ts`
- Create: `packages/server/src/api/skills.ts`
- Create: `packages/server/src/api/providers.ts`
- Create: `packages/server/src/api/tasks.ts`
- Create: `packages/server/src/api/logs.ts`
- Create: `packages/server/src/api/files.ts`
- Create: `packages/server/src/api/dashboard.ts`
- Modify: `packages/server/src/api/index.ts`

- [ ] **Step 1: 实现 Sessions 路由**

`packages/server/src/api/sessions.ts`:
```typescript
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { db, schema } from '../db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { createSessionSchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';

export const sessionsRouter = new Hono();

sessionsRouter.use('*', authMiddleware);

sessionsRouter.get('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const user = c.get('user');
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.userId, user.sub)))
    .orderBy(desc(sessions.createdAt));
  return c.json(rows);
});

sessionsRouter.post('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const user = c.get('user');
  const body = createSessionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [session] = await db.insert(sessions).values({
    workspaceId,
    userId: user.sub,
    title: body.data.title,
  }).returning();

  return c.json(session, 201);
});

sessionsRouter.get('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  const sid = c.req.param('sid');
  const user = c.get('user');

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sid), eq(sessions.userId, user.sub)),
  });
  if (!session) return c.json({ error: '会话不存在' }, 404);

  const msgs = await db.select().from(messages)
    .where(eq(messages.sessionId, sid))
    .orderBy(messages.createdAt);

  return c.json({ ...session, messages: msgs });
});

sessionsRouter.delete('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  const sid = c.req.param('sid');
  const user = c.get('user');
  await db.update(sessions)
    .set({ status: 'archived' })
    .where(and(eq(sessions.id, sid), eq(sessions.userId, user.sub)));
  return c.json({ ok: true });
});
```

- [ ] **Step 2: 实现 Memories 路由**

`packages/server/src/api/memories.ts`:
```typescript
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { db, schema } from '../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { createMemorySchema, updateMemorySchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, requireWorkspaceAccess } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';

export const memoriesRouter = new Hono();

memoriesRouter.use('*', authMiddleware);

// 用户级记忆列表
memoriesRouter.get('/memories', async (c) => {
  const user = c.get('user');
  const rows = await db.select().from(schema.memories).where(
    and(eq(schema.memories.userId, user.sub), isNull(schema.memories.workspaceId)),
  );
  return c.json(rows);
});

// 工作区级记忆列表
memoriesRouter.get('/workspaces/:id/memories', requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const user = c.get('user');
  const rows = await db.select().from(schema.memories).where(
    and(eq(schema.memories.userId, user.sub), eq(schema.memories.workspaceId, workspaceId)),
  );
  return c.json(rows);
});

// 创建记忆（通过 workspaceId 区分用户级/工作区级）
memoriesRouter.post('/memories', async (c) => {
  const user = c.get('user');
  const body = createMemorySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [memory] = await db.insert(schema.memories).values({
    userId: user.sub,
    workspaceId: body.data.workspaceId ?? null,
    name: body.data.name,
    type: body.data.type,
    content: body.data.content,
  }).returning();

  await audit(c, 'memory.create', memory.id);
  return c.json(memory, 201);
});

memoriesRouter.patch('/memories/:mid', async (c) => {
  const user = c.get('user');
  const mid = c.req.param('mid');
  const body = updateMemorySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [updated] = await db.update(schema.memories)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(schema.memories.id, mid), eq(schema.memories.userId, user.sub)))
    .returning();

  if (!updated) return c.json({ error: '记忆不存在' }, 404);
  return c.json(updated);
});

memoriesRouter.delete('/memories/:mid', async (c) => {
  const user = c.get('user');
  const mid = c.req.param('mid');
  await db.delete(schema.memories).where(and(eq(schema.memories.id, mid), eq(schema.memories.userId, user.sub)));
  await audit(c, 'memory.delete', mid);
  return c.json({ ok: true });
});
```

- [ ] **Step 3a: 实现 Skills 路由**

`packages/server/src/api/skills.ts`:
```typescript
import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { z } from 'zod';

const skillBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  content: z.string().min(1),
  workspaceId: z.string().uuid().optional(), // 无 workspaceId = 用户级技能
});

export const skillsRouter = new Hono();

// GET /api/skills — 用户级技能列表
skillsRouter.get('/skills', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.userId, user.sub), isNull(schema.skills.workspaceId)));
  return c.json(rows);
});

// GET /api/workspaces/:id/skills — 工作区级技能
skillsRouter.get('/workspaces/:id/skills', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const user = c.get('user');
  const rows = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.userId, user.sub), eq(schema.skills.workspaceId, workspaceId)));
  return c.json(rows);
});

// POST /api/skills — 创建技能（通过 workspaceId 区分用户级/工作区级）
skillsRouter.post('/skills', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = skillBody.parse(await c.req.json());
  const [row] = await db.insert(schema.skills).values({
    ...body,
    userId: user.sub,
    workspaceId: body.workspaceId ?? null,
  }).returning();
  return c.json(row, 201);
});

// PATCH /api/skills/:sid — 更新技能
skillsRouter.patch('/skills/:sid', authMiddleware, async (c) => {
  const user = c.get('user');
  const sid = c.req.param('sid');
  const body = skillBody.partial().parse(await c.req.json());
  const [row] = await db.update(schema.skills)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.skills.id, sid), eq(schema.skills.userId, user.sub)))
    .returning();
  if (!row) return c.json({ error: '技能不存在' }, 404);
  return c.json(row);
});

// DELETE /api/skills/:sid
skillsRouter.delete('/skills/:sid', authMiddleware, async (c) => {
  const user = c.get('user');
  const sid = c.req.param('sid');
  await db.delete(schema.skills).where(and(eq(schema.skills.id, sid), eq(schema.skills.userId, user.sub)));
  return c.body(null, 204);
});
```

- [ ] **Step 3b: 实现 Providers 路由**

`packages/server/src/api/providers.ts`:
```typescript
import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt, decrypt } from '@ccclaw/shared/crypto.js';
import { config } from '../config.js';
import { createProviderSchema, updateProviderSchema } from '@ccclaw/shared';

export const providersRouter = new Hono();

// GET /api/settings/providers — 当前用户的 Provider 列表
providersRouter.get('/', authMiddleware, async (c) => {
  const userId = c.get('user').id;
  const rows = await db.select({
    id: schema.providers.id,
    name: schema.providers.name,
    type: schema.providers.type,
    authType: schema.providers.authType,
    isDefault: schema.providers.isDefault,
    createdAt: schema.providers.createdAt,
  }).from(schema.providers)
    .where(eq(schema.providers.userId, userId));

  return c.json(rows);
});

// POST /api/settings/providers — 创建 Provider
providersRouter.post('/', authMiddleware, async (c) => {
  const body = createProviderSchema.parse(await c.req.json());
  const userId = c.get('user').id;

  // 如果设为默认，先取消该用户已有默认
  if (body.isDefault) {
    await db.update(schema.providers)
      .set({ isDefault: false })
      .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true)));
  }

  const [row] = await db.insert(schema.providers).values({
    userId,
    name: body.name,
    type: body.type,
    authType: body.authType,
    config: encrypt(JSON.stringify(body.config), config.ENCRYPTION_KEY),
    isDefault: body.isDefault,
  }).returning();

  return c.json({ id: row.id, name: row.name, type: row.type, authType: row.authType, isDefault: row.isDefault }, 201);
});

// PATCH /api/settings/providers/:id — 更新 Provider
providersRouter.patch('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('user').id;
  const body = updateProviderSchema.parse(await c.req.json());

  if (body.isDefault) {
    await db.update(schema.providers)
      .set({ isDefault: false })
      .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true)));
  }

  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.config) updates.config = encrypt(JSON.stringify(body.config), config.ENCRYPTION_KEY);
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault;

  await db.update(schema.providers).set(updates)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)));

  return c.json({ ok: true });
});

// DELETE /api/settings/providers/:id — 删除 Provider
providersRouter.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const userId = c.get('user').id;
  await db.delete(schema.providers)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)));
  return c.body(null, 204);
});
```

- [ ] **Step 3c: 实现 Tasks（定时任务）路由**

`packages/server/src/api/tasks.ts`:
```typescript
import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { z } from 'zod';

const taskBody = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1).max(100),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const tasksRouter = new Hono();

// GET /api/workspaces/:id/tasks — 工作区定时任务列表
tasksRouter.get('/:id/tasks', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const rows = await db.select().from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.workspaceId, workspaceId));
  return c.json(rows);
});

// POST /api/workspaces/:id/tasks — 创建定时任务（成员）
tasksRouter.post('/:id/tasks', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const body = taskBody.parse(await c.req.json());
  const [row] = await db.insert(schema.scheduledTasks).values({
    ...body,
    workspaceId,
  }).returning();
  return c.json(row, 201);
});

// PATCH /api/workspaces/:id/tasks/:tid — 更新
tasksRouter.patch('/:id/tasks/:tid', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const tid = c.req.param('tid');
  const body = taskBody.partial().parse(await c.req.json());
  const [row] = await db.update(schema.scheduledTasks)
    .set(body)
    .where(eq(schema.scheduledTasks.id, tid))
    .returning();
  if (!row) return c.json({ error: '任务不存在' }, 404);
  return c.json(row);
});

// DELETE /api/workspaces/:id/tasks/:tid
tasksRouter.delete('/:id/tasks/:tid', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const tid = c.req.param('tid');
  await db.delete(schema.scheduledTasks).where(eq(schema.scheduledTasks.id, tid));
  return c.body(null, 204);
});
```

- [ ] **Step 3d: 实现 Logs（审计日志）路由**

`packages/server/src/api/logs.ts`:
```typescript
import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { z } from 'zod';

export const logsRouter = new Hono();

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// GET /api/logs — 审计日志列表（admin）
logsRouter.get('/', authMiddleware, requireRole('admin'), async (c) => {
  const { page, limit } = querySchema.parse(c.req.query());
  const offset = (page - 1) * limit;

  const rows = await db.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, page, limit });
});
```

- [ ] **Step 3e: 实现 Files（文件管理）路由**

`packages/server/src/api/files.ts`:
```typescript
import { Hono } from 'hono';
import { join, resolve, relative } from 'node:path';
import { readdir, stat, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 安全路径解析：确保在 workspace 目录范围内
function safePath(workspaceSlug: string, userPath: string): string {
  // 防止 null 字节注入
  if (userPath.includes('\0')) {
    throw new Error('路径包含非法字符');
  }
  // 禁止 .. 路径段
  if (userPath.split('/').includes('..')) {
    throw new Error('路径包含非法字符');
  }
  const base = join(config.DATA_DIR, 'workspaces', workspaceSlug, 'workspace');
  const resolved = resolve(base, userPath.replace(/^\//, ''));
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error('路径越界');
  }
  return resolved;
}

async function getWorkspaceSlug(workspaceId: string): Promise<string> {
  const [ws] = await db.select({ slug: schema.workspaces.slug })
    .from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!ws) throw new Error('工作区不存在');
  return ws.slug;
}

export const filesRouter = new Hono();

// GET /:id/files?path=/ — 列出目录内容
filesRouter.get('/:id/files', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const dirPath = safePath(slug, c.req.query('path') || '/');

  const entries = await readdir(dirPath, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dirPath, entry.name);
    const stats = await stat(fullPath);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  }));

  return c.json(items);
});

// GET /:id/files/*path — 读取文件内容
filesRouter.get('/:id/files/*', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const filePath = safePath(slug, c.req.path.split('/files/')[1] || '');

  const stats = await stat(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    return c.json({ error: '文件过大' }, 413);
  }

  const content = await readFile(filePath, 'utf-8');
  return c.json({ content, size: stats.size });
});

// POST /:id/files — 创建文件或文件夹
filesRouter.post('/:id/files', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const body = z.object({
    path: z.string().min(1),
    type: z.enum(['file', 'dir']),
    content: z.string().optional(),
  }).parse(await c.req.json());

  const targetPath = safePath(slug, body.path);

  if (body.type === 'dir') {
    await mkdir(targetPath, { recursive: true });
  } else {
    await mkdir(join(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, body.content ?? '', 'utf-8');
  }

  return c.json({ path: body.path, type: body.type }, 201);
});

// PUT /:id/files/*path — 更新文件内容
filesRouter.put('/:id/files/*', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const filePath = safePath(slug, c.req.path.split('/files/')[1] || '');
  const { content } = z.object({ content: z.string() }).parse(await c.req.json());

  if (Buffer.byteLength(content) > MAX_FILE_SIZE) {
    return c.json({ error: '文件过大' }, 413);
  }

  await writeFile(filePath, content, 'utf-8');
  return c.json({ ok: true });
});

// DELETE /:id/files/*path — 删除文件或文件夹
filesRouter.delete('/:id/files/*', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const targetPath = safePath(slug, c.req.path.split('/files/')[1] || '');
  const force = c.req.query('force') === 'true';

  await rm(targetPath, { recursive: force });
  return c.body(null, 204);
});

// POST /:id/files/move — 移动/重命名
filesRouter.post('/:id/files/move', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const slug = await getWorkspaceSlug(c.req.param('id'));
  const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(await c.req.json());

  const fromPath = safePath(slug, from);
  const toPath = safePath(slug, to);

  await rename(fromPath, toPath);
  return c.json({ from, to });
});
```

- [ ] **Step 4: 更新路由汇总**

修改 `packages/server/src/api/index.ts`，按控制面/用户面组织路由：
```typescript
import { sessionsRouter } from './sessions.js';
import { memoriesRouter } from './memories.js';
import { skillsRouter } from './skills.js';
import { providersRouter } from './providers.js';
import { tasksRouter } from './tasks.js';
import { logsRouter } from './logs.js';
import { filesRouter } from './files.js';
import { preferencesRouter } from './preferences.js';
import { dashboardRouter } from './dashboard.js';

// ═══ 用户面 ═══
// 个人设置
api.route('/settings/preferences', preferencesRouter);
api.route('/settings/providers', providersRouter);
api.route('/settings/skills', skillsRouter);        // 用户级 skill
api.route('/settings/mcp-servers', mcpServersRouter); // 用户级 MCP
api.route('/settings/dashboard', dashboardRouter);  // 使用统计
api.route('/settings/logs', logsRouter);            // 个人操作日志

// 工作区
api.route('/workspaces', sessionsRouter);   // /:id/sessions/*
api.route('/workspaces', memoriesRouter);   // /:id/memories/*
api.route('/workspaces', skillsRouter);     // /:id/skills（工作区级）
api.route('/workspaces', tasksRouter);      // /:id/tasks/*
api.route('/workspaces', filesRouter);      // /:id/files/*

// ═══ 控制面（admin）═══
api.route('/admin/users', usersRouter);
api.route('/admin/logs', logsRouter);       // 全局日志（admin）
```

- [ ] **Step 5: 用 curl 验证完整 API 流程**

```bash
# 1. Seed admin
pnpm --filter @ccclaw/server seed

# 2. 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me"}'

# 3. 用返回的 accessToken 创建工作区
curl -X POST http://localhost:3000/api/workspaces \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"测试工作区","slug":"test-workspace"}'
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/
git commit -m "feat: 实现 Sessions + Memories + Skills + API Keys + Tasks + Logs API"
```

---

## Chunk 2: P1 — Agent 运行时 + 沙箱

### Task 8: 沙箱容器镜像 + 运行时适配器

**Files:**
- Create: `docker/sandbox/Dockerfile`

- [ ] **Step 1: 创建沙箱 Dockerfile**

`docker/sandbox/Dockerfile`:
```dockerfile
FROM node:22-alpine

RUN apk add --no-cache git bash curl

RUN adduser -D -h /home/agent agent

COPY packages/agent-runtime/dist /app
COPY packages/agent-runtime/package.json /app/package.json
WORKDIR /app
RUN npm install --production

USER agent

ENTRYPOINT ["node", "/app/index.js"]
```

- [ ] **Step 2: Commit**

```bash
git add docker/sandbox/
git commit -m "feat: 添加 Agent 沙箱容器 Dockerfile"
```

---

### Task 9: RunnerManager — 统一 Runner 管理

**Files:**
- Create: `packages/server/src/core/workspace-storage.ts`
- Create: `packages/server/src/core/runner-manager.ts`

- [ ] **Step 1: 实现 workspace-storage.ts**

```typescript
import { mkdir, access, chmod, lstat, realpath, cp, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initWorkspaceStorage(slug: string, gitRepo?: string | null, gitToken?: string | null) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  const workDir = join(base, 'workspace');
  const skillsDir = join(base, 'skills');
  await mkdir(workDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  // 目录权限：owner 读写执行，其他人无权限
  await chmod(base, 0o700);

  // 初始化 workspace.db（SQLite + WAL，包含 sessions + messages + memories）
  const wsDbPath = join(base, 'workspace.db');
  const wsDb = new Database(wsDbPath);
  wsDb.pragma('journal_mode = WAL');
  wsDb.pragma('foreign_keys = ON');
  wsDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_type TEXT NOT NULL DEFAULT 'webui',
      title TEXT NOT NULL DEFAULT '新会话',
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('project','reference','decision','feedback','log')),
      content TEXT NOT NULL,
      embedding BLOB,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  wsDb.close();

  // 复制系统预置 Skill 到工作区
  const presetDir = join(__dirname, '..', 'skills');
  try {
    const files = await readdir(presetDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        await cp(join(presetDir, file), join(skillsDir, file));
      }
    }
  } catch {
    // 预置 Skill 目录不存在时跳过
  }

  if (gitRepo) {
    let cloneUrl = gitRepo;
    if (gitToken) {
      const url = new URL(gitRepo);
      url.username = 'oauth2';
      url.password = gitToken;
      cloneUrl = url.toString();
    }
    // 使用 execFile 避免 shell 注入（参数不经过 shell 解析）
    await execFileAsync('git', ['clone', cloneUrl, '.'], { cwd: workDir });
  }
}

export async function initGlobalStorage() {
  await mkdir(join(config.DATA_DIR, 'backups'), { recursive: true });
}

export function getWorkspacePaths(slug: string) {
  const base = join(config.DATA_DIR, 'workspaces', slug);
  return {
    base,
    workspace: join(base, 'workspace'),
    memory: join(base, 'memory'),
    skills: join(base, 'skills'),
  };
}

// 安全校验：确保路径在工作区范围内，防止路径遍历和符号链接绕过
export function validatePath(basePath: string, userPath: string): string {
  const resolved = resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }
  return resolved;
}

// 安全校验（含符号链接检查）：用于 agent-runtime 内部
export async function validatePathStrict(basePath: string, userPath: string): Promise<string> {
  const resolved = resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('路径越界：禁止访问工作区外的文件');
  }

  // 检查符号链接：realpath 解析后仍须在白名单内
  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink()) {
      const real = await realpath(resolved);
      if (!real.startsWith(basePath)) {
        throw new Error('符号链接指向工作区外：拒绝访问');
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // 文件不存在时跳过（创建场景）
  }
  return resolved;
}

// 构建子进程最小环境变量（防止泄露主服务密钥）
export function buildSafeEnv(workspaceSlug: string): Record<string, string> {
  const paths = getWorkspacePaths(workspaceSlug);
  return {
    NODE_ENV: process.env.NODE_ENV || 'production',
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SOCKET_PATH: join(paths.base, 'agent.sock'),
    WORKSPACE_DIR: paths.workspace,
    ALLOWED_PATHS: [paths.workspace, paths.memory, paths.skills].join(':'),
    // 显式不传递: ENCRYPTION_KEY, DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY 等
  };
}
```

- [ ] **Step 2: 实现 RunnerManager（统一 Runner 管理）**

所有 Runner（Docker/本地/远端）通过 WebSocket 连接 Server，RunnerManager 统一管理注册、启动、通信。

`packages/server/src/core/runner-manager.ts`:
```typescript
import Docker from 'dockerode';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getWorkspacePaths, buildSafeEnv } from './workspace-storage.js';
import { WORKSPACE_LABEL, SANDBOX_MEMORY_LIMIT, SANDBOX_CPU_QUOTA, SANDBOX_IDLE_TIMEOUT_MS } from '@ccclaw/shared';
import type { AgentRequest, AgentResponse } from '@ccclaw/agent-runtime/protocol.js';

export type StartMode = 'docker' | 'local' | 'remote';

export interface RuntimeConfig {
  startMode: StartMode;
  runnerId: string;
  memory?: string;
  cpu?: string;
  timeout?: number;
}

interface RunnerInfo {
  ws: WebSocket;
  runnerId: string;
  startMode: StartMode;
  lastPing: number;
  workspaces: Set<string>;
  /** Docker 模式：容器 ID */
  containerId?: string;
  /** Local 模式：子进程引用 */
  childProcess?: ChildProcess;
}

interface PendingRequest {
  onMessage: (msg: AgentResponse) => void;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const docker = new Docker();

export class RunnerManager {
  /** runnerId → RunnerInfo */
  private runners = new Map<string, RunnerInfo>();
  /** workspaceSlug → runnerId 绑定 */
  private bindings = new Map<string, string>();
  /** requestId → 回调 */
  private pendingRequests = new Map<string, PendingRequest>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // ====== Runner 注册（所有模式统一入口） ======

  /** Runner 通过 /ws/runner 连接后调用此方法注册 */
  registerRunner(ws: WebSocket, runnerId: string, startMode: StartMode = 'remote') {
    // 清理旧连接
    const old = this.runners.get(runnerId);
    if (old?.ws.readyState === WebSocket.OPEN) {
      old.ws.close(1000, '被新连接替代');
    }

    const info: RunnerInfo = { ws, runnerId, startMode, lastPing: Date.now(), workspaces: new Set() };
    this.runners.set(runnerId, info);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          info.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'response' && msg.requestId) {
          const pending = this.pendingRequests.get(msg.requestId);
          if (pending) {
            pending.onMessage(msg.data as AgentResponse);
            if (msg.data.type === 'done' || msg.data.type === 'error') {
              clearTimeout(pending.timer);
              pending.resolve();
              this.pendingRequests.delete(msg.requestId);
            }
          }
        }
      } catch (err) {
        logger.error({ runnerId, error: String(err) }, 'Runner message parse error');
      }
    });

    ws.on('close', () => {
      logger.info({ runnerId }, 'Runner disconnected');
      this.runners.delete(runnerId);
    });

    ws.send(JSON.stringify({ type: 'registered', runnerId }));
    logger.info({ runnerId, startMode }, 'Runner registered');
  }

  // ====== Runner 启动（按 startMode 分发） ======

  /** 确保工作区绑定的 Runner 就绪 */
  async ensureRunner(workspaceId: string) {
    const wsConfig = await this.getWorkspaceConfig(workspaceId);
    const { slug, runnerId, startMode } = wsConfig;

    // 绑定工作区到 Runner
    this.bindings.set(slug, runnerId);

    // 检查 Runner 是否已在线
    const runner = this.runners.get(runnerId);
    if (runner?.ws.readyState === WebSocket.OPEN) {
      runner.workspaces.add(slug);
      return { slug, runnerId };
    }

    // Runner 不在线，按 startMode 启动
    if (startMode === 'docker') {
      await this.startDockerRunner(slug, runnerId, wsConfig);
    } else if (startMode === 'local') {
      await this.startLocalRunner(slug, runnerId);
    } else {
      // remote 模式：Runner 需要手动部署并连接
      throw new Error(`Runner ${runnerId} 不在线，remote 模式需要手动部署 Runner`);
    }

    // 等待 Runner WS 连接注册（最多 15 秒）
    await this.waitForRunner(runnerId, 15_000);
    const connected = this.runners.get(runnerId);
    if (connected) connected.workspaces.add(slug);
    return { slug, runnerId };
  }

  private async startDockerRunner(slug: string, runnerId: string, cfg: RuntimeConfig) {
    const paths = getWorkspacePaths(slug);
    const serverUrl = `ws://host.docker.internal:${config.PORT}/ws/runner`;

    const container = await docker.createContainer({
      Image: 'ccclaw-runner:latest',
      Labels: { [WORKSPACE_LABEL]: 'true', [`${WORKSPACE_LABEL}.slug`]: slug },
      HostConfig: {
        Memory: SANDBOX_MEMORY_LIMIT,
        CpuQuota: SANDBOX_CPU_QUOTA,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=100m' },
        Binds: [
          `${paths.workspace}:/workspace`,
          `${paths.memory}:/memory`,
          `${paths.skills}:/skills:ro`,
        ],
        NetworkMode: 'bridge',
        ExtraHosts: ['host.docker.internal:host-gateway'],
      },
      Env: [
        `RUNNER_ID=${runnerId}`,
        `SERVER_URL=${serverUrl}`,
        `AUTH_TOKEN=${config.RUNNER_SECRET}`,
        `WORKSPACE_DIR=/workspace`,
        `ALLOWED_PATHS=/workspace:/memory:/skills`,
      ],
    });

    await container.start();
    // 将 containerId 暂存，Runner 注册后关联
    const info = this.runners.get(runnerId);
    if (info) info.containerId = container.id;
    logger.info({ slug, runnerId, containerId: container.id }, 'Docker Runner started');
  }

  private async startLocalRunner(slug: string, runnerId: string) {
    const paths = getWorkspacePaths(slug);
    const safeEnv = buildSafeEnv(slug);
    const serverUrl = `ws://127.0.0.1:${config.PORT}/ws/runner`;

    const child = fork(
      join(process.cwd(), 'node_modules/@ccclaw/agent-runtime/dist/index.js'),
      ['--mode', 'runner'],
      {
        cwd: paths.workspace,
        env: {
          ...safeEnv,
          RUNNER_ID: runnerId,
          SERVER_URL: serverUrl,
          AUTH_TOKEN: config.RUNNER_SECRET,
        },
        stdio: 'pipe',
      },
    );

    child.on('exit', (code) => {
      logger.warn({ slug, runnerId, code }, 'Local Runner exited');
      this.runners.delete(runnerId);
    });

    logger.info({ slug, runnerId, pid: child.pid }, 'Local Runner started');
  }

  private waitForRunner(runnerId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        const runner = this.runners.get(runnerId);
        if (runner?.ws.readyState === WebSocket.OPEN) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 200);
      const timer = setTimeout(() => {
        clearInterval(check);
        reject(new Error(`Runner ${runnerId} 启动超时`));
      }, timeoutMs);
    });
  }

  // ====== 任务下发 ======

  async send(workspaceSlug: string, request: AgentRequest, onMessage: (msg: AgentResponse) => void) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) throw new Error('工作区未绑定 Runner');

    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Runner ${runnerId} 不在线`);
    }

    const requestId = randomUUID();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Runner 响应超时'));
      }, 300_000); // 5 分钟

      this.pendingRequests.set(requestId, { onMessage, resolve, reject, timer });

      runner.ws.send(JSON.stringify({ type: 'request', requestId, data: request }));
    });
  }

  // ====== 状态查询 ======

  getStatus(workspaceSlug: string): 'running' | 'stopped' | 'error' {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) return 'stopped';
    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) return 'error';
    return 'running';
  }

  getOnlineRunners() {
    return Array.from(this.runners.entries()).map(([id, info]) => ({
      runnerId: id,
      startMode: info.startMode,
      online: info.ws.readyState === WebSocket.OPEN,
      lastPing: info.lastPing,
      workspaces: Array.from(info.workspaces),
    }));
  }

  // ====== 停止与清理 ======

  async stop(workspaceSlug: string) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) return;
    const runner = this.runners.get(runnerId);
    if (runner) {
      runner.workspaces.delete(workspaceSlug);
      // 如果该 Runner 不再服务任何工作区，可选择停止
      if (runner.workspaces.size === 0 && runner.startMode !== 'remote') {
        if (runner.containerId) {
          const container = docker.getContainer(runner.containerId);
          try { await container.stop({ t: 5 }); } catch {}
          try { await container.remove(); } catch {}
        }
        if (runner.childProcess) {
          runner.childProcess.kill('SIGTERM');
        }
        runner.ws.close(1000, '不再需要');
        this.runners.delete(runnerId);
      }
    }
    this.bindings.delete(workspaceSlug);
  }

  startCleanupLoop() {
    this.cleanupInterval = setInterval(() => this.cleanIdle().catch(
      (err) => logger.error(err, '清理空闲 Runner 失败')
    ), 60_000);
    logger.info('RunnerManager cleanup loop started');
  }

  stopCleanupLoop() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  private async cleanIdle() {
    const now = Date.now();
    for (const [runnerId, info] of this.runners) {
      // 心跳超时
      if (now - info.lastPing > 60_000) {
        logger.warn({ runnerId }, 'Runner heartbeat timeout');
        info.ws.close(1001, '心跳超时');
        this.runners.delete(runnerId);
      }
    }
  }

  // ====== 配置读取 ======

  private async getWorkspaceConfig(workspaceId: string): Promise<RuntimeConfig & { slug: string }> {
    const [ws] = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new Error('工作区不存在');

    const settings = (ws.settings as any) || {};
    const startMode: StartMode = settings.startMode || 'local';
    const runnerId: string = settings.runnerId || `runner-${ws.slug}`;

    return {
      slug: ws.slug,
      startMode,
      runnerId,
      ...(settings.runtimeConfig || {}),
    };
  }
}

export const runnerManager = new RunnerManager();
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/core/
git commit -m "feat: 实现 RunnerManager 统一 Runner 管理（docker/local/remote 启动模式）"
```

---

### Task 10: Agent Runtime（沙箱内进程）

**Files:**
- Create: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/src/protocol.ts`
- Create: `packages/agent-runtime/src/agent.ts`

- [ ] **Step 1: 实现 protocol.ts**

```typescript
import { createServer, type Socket } from 'node:net';

export interface AgentRequest {
  method: 'run';
  params: {
    sessionId: string;
    message: string;
    apiKey: string;
    context: {
      memories: string[];
      skills: string[];
      history: Array<{ role: string; content: string }>;
      systemPrompt: string;
    };
  };
}

export interface AgentResponse {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'confirm_request' | 'done' | 'error';
  [key: string]: unknown;
}

export function startSocketServer(
  socketPath: string,
  handler: (req: AgentRequest, send: (msg: AgentResponse) => void) => Promise<void>,
) {
  const server = createServer((socket: Socket) => {
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const req = JSON.parse(line) as AgentRequest;

        const send = (msg: AgentResponse) => {
          socket.write(JSON.stringify(msg) + '\n');
        };

        handler(req, send).catch((err) => {
          send({ type: 'error', message: String(err) });
        });
      }
    });
  });

  server.listen(socketPath);
  return server;
}
```

- [ ] **Step 2: 实现 agent.ts**

```typescript
import { AgentRequest, AgentResponse } from './protocol.js';

// Agent SDK 封装（当前 Claude，架构支持多 Provider）
// 具体实现依赖 @anthropic-ai/claude-code，后续可替换为其他 Provider SDK
export async function runAgent(
  req: AgentRequest,
  send: (msg: AgentResponse) => void,
): Promise<void> {
  const { params } = req;

  // TODO: 集成 @anthropic-ai/claude-code SDK
  // 1. 构建 system prompt（注入安全规则 + memories + skills）
  // 2. 加载历史消息
  // 3. 调用 Provider API（流式）
  // 4. 处理工具调用
  // 5. 流式发送响应

  // 临时占位：echo 模式
  send({ type: 'text_delta', content: `收到消息: ${params.message}` });
  send({ type: 'done', sessionId: params.sessionId, tokens: 0 });
}
```

- [ ] **Step 3: 实现入口 index.ts**

```typescript
import { WebSocket } from 'ws';
import { runAgent } from './agent.js';
import { resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { AgentRequest, AgentResponse } from './protocol.js';

// ====== 安全：路径白名单 ======

const allowedPaths = (process.env.ALLOWED_PATHS || '')
  .split(':')
  .filter(Boolean)
  .map(p => resolve(p));

if (allowedPaths.length === 0) {
  console.warn('WARNING: ALLOWED_PATHS not set — agent has unrestricted file access');
}

/** 校验路径是否在白名单内（含符号链接解析） */
export function isAllowedPath(targetPath: string): boolean {
  if (allowedPaths.length === 0) return true;
  const resolved = resolve(targetPath);
  let real: string;
  try {
    real = realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  return allowedPaths.some(allowed => real === allowed || real.startsWith(allowed + sep));
}

// ====== Runner 模式：WebSocket 连接 Server ======

const runnerId = process.env.RUNNER_ID;
const serverUrl = process.env.SERVER_URL;
const authToken = process.env.AUTH_TOKEN;

if (!runnerId || !serverUrl) {
  console.error('RUNNER_ID and SERVER_URL are required');
  process.exit(1);
}

function connect() {
  const ws = new WebSocket(serverUrl!);
  let retryDelay = 1000;

  ws.on('open', () => {
    console.log(`Runner ${runnerId} connecting to ${serverUrl}`);
    ws.send(JSON.stringify({ type: 'register', token: authToken, runnerId }));
    retryDelay = 1000; // 重连成功后重置
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'registered') {
        console.log(`Runner ${runnerId} registered successfully`);
      } else if (msg.type === 'pong') {
        // 心跳回复
      } else if (msg.type === 'request' && msg.requestId) {
        // 执行 Agent 任务
        const send = (response: AgentResponse) => {
          ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, data: response }));
        };
        await runAgent(msg.data as AgentRequest, send);
      }
    } catch (err) {
      console.error('Message handling error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`Runner ${runnerId} disconnected, reconnecting in ${retryDelay}ms...`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000); // 指数退避，最大 60 秒
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  // 心跳：每 30 秒
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30_000);

  ws.on('close', () => clearInterval(heartbeat));
}

connect();
console.log(`Runner ${runnerId} starting, will connect to ${serverUrl}`);
```

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/
git commit -m "feat: 实现 Agent Runtime Runner 模式（WebSocket 反向连接）"
```

---

### Task 11: AgentManager + WebSocket 通信

**Files:**
- Create: `packages/server/src/core/agent-manager.ts`
- Create: `packages/server/src/channel/adapter.ts`
- Create: `packages/server/src/channel/webui.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 实现 agent-manager.ts**

`packages/server/src/core/agent-manager.ts`:
```typescript
import { db, schema } from '../db/index.js';
import { eq, and, isNull, or, desc } from 'drizzle-orm';
import { decrypt } from '@ccclaw/shared/crypto.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { runnerManager } from './runner-manager.js';
import type { AgentRequest, AgentResponse } from '@ccclaw/agent-runtime/protocol.js';

interface StreamCallback {
  onDelta: (msg: AgentResponse) => void;
  onDone: (msg: AgentResponse) => void;
  onError: (msg: AgentResponse) => void;
}

export class AgentManager {
  // 组装上下文：user preferences + skills + mcp + history + system prompt
  // 注意：工作区记忆（workspace.db）由 Runner 侧本地加载，不在此组装
  async assembleContext(workspaceId: string, userId: string, sessionId: string) {
    // 1. 加载用户偏好（主数据库）
    const [prefs] = await db.select().from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId)).limit(1);

    // 2. 加载技能（用户级 + 工作区级，工作区级同名覆盖用户级）
    const skills = await db.select().from(schema.skills).where(
      and(
        eq(schema.skills.userId, userId),
        or(
          isNull(schema.skills.workspaceId),
          eq(schema.skills.workspaceId, workspaceId),
        ),
      ),
    );

    // 3. 加载 MCP Server 配置（用户级 + 工作区级，工作区级同名覆盖用户级）
    const mcpServers = await db.select().from(schema.mcpServers).where(
      and(
        eq(schema.mcpServers.userId, userId),
        eq(schema.mcpServers.enabled, true),
        or(
          isNull(schema.mcpServers.workspaceId),
          eq(schema.mcpServers.workspaceId, workspaceId),
        ),
      ),
    );

    // 4. 加载历史消息（最近 N 条 + session summary）
    const session = await db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId)).limit(1);
    const history = await db.select().from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20);

    // 合并 MCP Server（工作区级同名覆盖用户级）
    const mcpMap = new Map<string, typeof mcpServers[0]>();
    for (const mcp of mcpServers) {
      if (!mcp.workspaceId) mcpMap.set(mcp.name, mcp); // 用户级先放入
    }
    for (const mcp of mcpServers) {
      if (mcp.workspaceId) mcpMap.set(mcp.name, mcp); // 工作区级覆盖
    }

    return {
      userPreferences: prefs ? {
        language: prefs.language,
        style: prefs.style,
        customRules: prefs.customRules,
      } : undefined,
      // 工作区记忆由 Runner 侧本地加载（workspace.db），不在此传递
      skills: skills.map((s) => `## ${s.name}\n${s.content}`),
      mcpServers: Array.from(mcpMap.values()).map((m) => ({
        name: m.name,
        command: m.command,
        args: m.args as string[],
        env: m.env as Record<string, string> | undefined,
      })),
      history: history.reverse().map((m) => ({ role: m.role, content: m.content })),
      systemPrompt: this.buildSystemPrompt(session[0]?.summary, prefs),
    };
  }

  private buildSystemPrompt(summary?: string | null): string {
    const parts = [
      '你是 CCCLaw 的 AI 助手，运行在工作区沙箱中。',
      '遵循三层安全规则：不执行破坏性操作、不泄露敏感信息、不超出工作区范围。',
    ];
    if (summary) parts.push(`\n历史摘要：${summary}`);
    return parts.join('\n');
  }

  // 解析 Provider：工作区绑定 > 用户默认
  async resolveProvider(workspaceId: string, userId: string): Promise<{ apiKey: string; apiBase?: string }> {
    const rows = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).limit(1);
    const settings = (rows[0]?.settings as any) || {};

    let provider;

    // 1. 工作区绑定的 Provider
    if (settings.providerId) {
      const p = await db.select().from(schema.providers)
        .where(and(eq(schema.providers.id, settings.providerId), eq(schema.providers.userId, userId))).limit(1);
      if (p.length) provider = p[0];
    }

    // 2. 用户默认 Provider
    if (!provider) {
      const p = await db.select().from(schema.providers)
        .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true))).limit(1);
      if (p.length) provider = p[0];
    }

    if (!provider) throw new Error('没有可用的 Provider，请在个人设置中配置');

    const cfg = JSON.parse(decrypt(provider.config as string, config.ENCRYPTION_KEY));
    return { apiKey: cfg.key, apiBase: cfg.apiBase };
  }

  // 完整对话流程 — 通过 RunnerManager 路由到正确的运行环境
  async chat(
    workspaceId: string,
    userId: string,
    sessionId: string,
    message: string,
    callbacks: StreamCallback,
  ) {
    // 1. 存储用户消息
    await db.insert(schema.messages).values({
      sessionId,
      role: 'user',
      content: message,
    });

    // 2. 组装上下文
    const context = await this.assembleContext(workspaceId, userId, sessionId);

    // 3. 解析 Provider
    const { apiKey, apiBase } = await this.resolveProvider(workspaceId, userId);

    // 4. 确保 Runner 就绪，然后下发任务
    const { slug } = await runnerManager.ensureRunner(workspaceId);
    const request: AgentRequest = {
      method: 'run',
      params: { sessionId, message, apiKey, context },
    };

    await runnerManager.send(slug, request, (msg) => {
      if (msg.type === 'done') callbacks.onDone(msg);
      else if (msg.type === 'error') callbacks.onError(msg);
      else callbacks.onDelta(msg);
    });
  }
}

export const agentManager = new AgentManager();
```

- [ ] **Step 2: 实现 channel adapter 和 webui.ts**

`packages/server/src/channel/adapter.ts`:
```typescript
// Channel 抽象 — 统一不同渠道（WebUI/Telegram/Feishu）的消息接口
export interface ChannelAdapter {
  // 发送模型思考过程（extended thinking 流式输出）
  sendThinkingDelta(sessionId: string, content: string): void;
  // 发送流式文本
  sendDelta(sessionId: string, content: string): void;
  // 发送工具调用通知
  sendToolUse(sessionId: string, tool: string, input: unknown): void;
  // 发送确认请求
  sendConfirmRequest(requestId: string, sessionId: string, tool: string, input: unknown, reason: string): void;
  // 发送完成通知
  sendDone(sessionId: string, tokens: number): void;
  // 发送错误
  sendError(sessionId: string, message: string): void;
}
```

`packages/server/src/channel/webui.ts`:
```typescript
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { agentManager } from '../core/agent-manager.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.js';
import type { ChannelAdapter } from './adapter.js';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
}

interface WsMessage {
  type: 'auth' | 'message' | 'cancel' | 'confirm_response';
  token?: string;
  sessionId?: string;
  content?: string;
  requestId?: string;
  approved?: boolean;
}

export function createWebSocketHandler(server: import('node:http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  // HTTP Upgrade 处理
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: AuthenticatedSocket) => {
    let authenticated = false;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;

        // 认证消息
        if (msg.type === 'auth') {
          try {
            const payload = await verifyAccessToken(msg.token!);
            ws.userId = payload.sub;
            authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: '认证失败' }));
            ws.close();
          }
          return;
        }

        if (!authenticated || !ws.userId) {
          ws.send(JSON.stringify({ type: 'error', message: '未认证' }));
          return;
        }

        // 对话消息
        if (msg.type === 'message' && msg.sessionId && msg.content) {
          // 查询 session 的 workspaceId
          const session = await db.select().from(schema.sessions)
            .where(eq(schema.sessions.id, msg.sessionId)).limit(1);
          if (!session.length) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session 不存在' }));
            return;
          }

          const adapter: ChannelAdapter = {
            sendThinkingDelta: (sid, content) => ws.send(JSON.stringify({ type: 'thinking_delta', sessionId: sid, content })),
            sendDelta: (sid, content) => ws.send(JSON.stringify({ type: 'text_delta', sessionId: sid, content })),
            sendToolUse: (sid, tool, input) => ws.send(JSON.stringify({ type: 'tool_use', sessionId: sid, tool, input })),
            sendConfirmRequest: (rid, sid, tool, input, reason) => ws.send(JSON.stringify({ type: 'confirm_request', requestId: rid, sessionId: sid, tool, input, reason })),
            sendDone: (sid, tokens) => ws.send(JSON.stringify({ type: 'done', sessionId: sid, tokens })),
            sendError: (sid, message) => ws.send(JSON.stringify({ type: 'error', sessionId: sid, message })),
          };

          try {
            await agentManager.chat(
              session[0].workspaceId,
              ws.userId,
              msg.sessionId,
              msg.content,
              {
                onDelta: (m) => adapter.sendDelta(msg.sessionId!, String(m.content ?? '')),
                onDone: (m) => adapter.sendDone(msg.sessionId!, (m.tokens as number) ?? 0),
                onError: (m) => adapter.sendError(msg.sessionId!, String(m.message ?? '未知错误')),
              },
            );
          } catch (err) {
            adapter.sendError(msg.sessionId, String(err));
          }
        }
      } catch (err) {
        logger.error(err, 'WebSocket 消息处理失败');
        ws.send(JSON.stringify({ type: 'error', message: '消息处理失败' }));
      }
    });
  });

  return wss;
}
```

- [ ] **Step 3: 集成到 server 入口**

修改 `packages/server/src/index.ts`，在已有 Hono 服务基础上添加：
```typescript
import { createServer } from 'node:http';
import { serve } from '@hono/node-server';
import { createWebSocketHandler } from './channel/webui.js';
import { runnerManager } from './core/runner-manager.js';

// 创建 HTTP server（给 Hono 和 WebSocket 共用）
const server = createServer(app.fetch);

// 挂载 WebSocket
createWebSocketHandler(server);

// 启动 RunnerManager（定期清理超时容器）
runnerManager.startCleanupLoop();

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'CCCLaw server started');
});
```

- [ ] **Step 4: 端到端测试**

使用 wscat 连接 WebSocket，验证 echo 响应：
```bash
# 终端 1：启动服务
pnpm --filter @ccclaw/server dev

# 终端 2：连接 WebSocket
npx wscat -c ws://localhost:3000/ws
> {"type":"auth","token":"<JWT_TOKEN>"}
< {"type":"auth_ok"}
> {"type":"message","sessionId":"<SESSION_ID>","content":"你好"}
< {"type":"text_delta","sessionId":"...","content":"收到消息: 你好"}
< {"type":"done","sessionId":"...","tokens":0}
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/core/agent-manager.ts packages/server/src/channel/
git commit -m "feat: 实现 AgentManager + WebSocket 通信层"
```

---

## Chunk 3: P2 — WebUI

### Task 12: WebUI 脚手架 + 路由 + Auth

**Files:**
- Create: `packages/web/index.html`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/stores/auth.ts`
- Create: `packages/web/src/pages/Login.tsx`
- Create: `packages/web/src/components/Layout.tsx`
- Create: `packages/web/src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Vite 配置 + HTML 入口**

`packages/web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../../dist/web',
  },
});
```

- [ ] **Step 2: 实现 API 客户端（fetch wrapper + token 刷新）**
- [ ] **Step 3: 实现 auth store（zustand）**
- [ ] **Step 4: 实现 Login 页面**
- [ ] **Step 5: 实现 Layout + ProtectedRoute**
- [ ] **Step 6: 实现 App.tsx 路由配置**
- [ ] **Step 7: 验证登录流程**
- [ ] **Step 8: Commit**

---

### Task 13: 对话界面

**Files:**
- Create: `packages/web/src/api/ws.ts`
- Create: `packages/web/src/stores/chat.ts`
- Create: `packages/web/src/pages/chat/ChatLayout.tsx`
- Create: `packages/web/src/pages/chat/SessionList.tsx`
- Create: `packages/web/src/pages/chat/ChatView.tsx`
- Create: `packages/web/src/pages/chat/MessageBubble.tsx`
- Create: `packages/web/src/components/ConfirmDialog.tsx`

- [ ] **Step 1: 实现 WebSocket 客户端**
- [ ] **Step 2: 实现 chat store（zustand）**
- [ ] **Step 3: 实现 ChatLayout（左栏工作区/会话列表 + 右栏对话流）**
- [ ] **Step 4: 实现 SessionList**
- [ ] **Step 5: 实现 ChatView（消息流 + 流式输出 + 输入框）**
- [ ] **Step 6: 实现 MessageBubble（文本 + 工具调用折叠展示）**
- [ ] **Step 7: 实现 ConfirmDialog（高危操作审批）**
- [ ] **Step 8: 端到端验证对话流程**
- [ ] **Step 9: Commit**

---

### Task 14: 管理控制台

**Files:**
- Create: `packages/web/src/pages/console/ConsoleLayout.tsx`
- Create: `packages/web/src/pages/console/Workspaces.tsx`
- Create: `packages/web/src/pages/console/WorkspaceDetail.tsx`
- Create: `packages/web/src/pages/console/Members.tsx`
- Create: `packages/web/src/pages/console/GlobalMemories.tsx`
- Create: `packages/web/src/pages/console/GlobalSkills.tsx`
- Create: `packages/web/src/pages/console/Scheduler.tsx`
- Create: `packages/web/src/pages/console/Logs.tsx`
- Create: `packages/web/src/pages/console/Settings.tsx`

- [ ] **Step 1: 实现 ConsoleLayout（侧边导航：用户管理、API Key、日志、设置）**
- [ ] **Step 2: 实现 Users 管理（admin）**
- [ ] **Step 3: 实现 WorkspaceSettings（Tab: 配置/记忆/技能/定时任务）**
- [ ] **Step 4: 实现用户中心（用户级记忆/技能管理）**
- [ ] **Step 5: 实现 Logs（审计日志表格 + 筛选）**
- [ ] **Step 6: 实现 Settings（API Key 管理）**
- [ ] **Step 7: Commit**

---

### Task 15: WebUI 构建集成

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/web/vite.config.ts`

- [ ] **Step 1: 配置 Hono 托管静态文件**

修改 server 入口，添加：
```typescript
import { serveStatic } from '@hono/node-server/serve-static';

// API 路由之后，添加静态文件托管
app.use('/*', serveStatic({ root: '../web/dist' }));
// SPA fallback
app.get('*', serveStatic({ path: '../web/dist/index.html' }));
```

- [ ] **Step 2: 构建并验证**

```bash
pnpm --filter @ccclaw/web build
pnpm --filter @ccclaw/server dev
# 访问 http://localhost:3000 应该看到 WebUI
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts packages/web/
git commit -m "feat: WebUI 构建集成到主服务"
```

---

## Chunk 4: P3 — 记忆/技能 + 上下文组装 + P4 — 定时任务 + 安全

### Task 16: 上下文组装

**Files:**
- Modify: `packages/server/src/core/agent-manager.ts`

- [ ] **Step 1: 实现上下文组装逻辑**

从 PG 查询两级 memory（用户级 + 工作区级，同名覆盖）+ 合并 skills + 加载 session history（最近 20 条 + summary），组装为 Agent 的 system prompt 和 conversation history。

- [ ] **Step 2: 实现 session summary 压缩**

当 session messages 超过 20 条时，调用 Provider API 生成摘要，存入 `sessions.summary`。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 实现上下文组装和会话历史压缩"
```

---

### Task 17: 完整 Agent SDK 集成

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Create: `packages/agent-runtime/src/tools/index.ts`
- Create: `packages/agent-runtime/src/tools/bash.ts`
- Create: `packages/agent-runtime/src/tools/file.ts`
- Create: `packages/agent-runtime/src/tools/git.ts`
- Create: `packages/agent-runtime/src/tools/glob.ts`
- Create: `packages/agent-runtime/src/tools/grep.ts`
- Create: `packages/agent-runtime/src/tools/web-fetch.ts`

- [ ] **Step 1: 实现带重试的 Provider API 调用封装**

`packages/agent-runtime/src/api-client.ts`:
```typescript
import { logger } from './logger.js';

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = { maxRetries: 3, baseDelayMs: 1000 };

// 指数退避重试（1s → 2s → 4s），仅对 5xx 和网络错误重试，4xx 立即失败
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = DEFAULT_RETRY,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;

      // 4xx 错误不重试（参数错误、认证失败等）
      if (status && status >= 400 && status < 500) {
        throw err;
      }

      if (attempt < opts.maxRetries) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt);
        logger.warn({ attempt: attempt + 1, delay, error: String(err) }, 'API 调用失败，重试中');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
```

- [ ] **Step 2: 集成 @anthropic-ai/claude-code SDK**

替换 `packages/agent-runtime/src/agent.ts` 中的 echo 占位：
```typescript
import { AgentRequest, AgentResponse } from './protocol.js';
import { withRetry } from './api-client.js';
// import { claude } from '@anthropic-ai/claude-code'; // 待 SDK 可用时启用

export async function runAgent(
  req: AgentRequest,
  send: (msg: AgentResponse) => void,
): Promise<void> {
  const { params } = req;

  // 构建完整 prompt
  const systemPrompt = [
    params.context.systemPrompt,
    '',
    '## 记忆',
    ...params.context.memories,
    '',
    '## 技能',
    ...params.context.skills,
  ].join('\n');

  // TODO: 真正的 Agent SDK 调用（P3 阶段完善，当前对接 Claude）
  // 使用 withRetry 包装 API 调用，自动处理 5xx/网络错误
  // await withRetry(async () => {
  //   const stream = claude.stream({ systemPrompt, messages: params.context.history, apiKey: params.apiKey });
  //   for await (const event of stream) {
  //     send(mapEventToResponse(event));
  //   }
  // });

  // 当前阶段：echo 模式
  send({ type: 'text_delta', content: `收到消息: ${params.message}` });
  send({ type: 'done', sessionId: params.sessionId, tokens: 0 });
}
```

- [ ] **Step 3: 实现工具集**

每个工具封装为独立模块，暴露统一接口：
```typescript
// packages/agent-runtime/src/tools/index.ts
export interface Tool {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<string>;
}

export { bashTool } from './bash.js';
export { fileTool } from './file.js';
export { gitTool } from './git.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { webFetchTool } from './web-fetch.js';
```

每个工具文件结构一致（以 bash.ts 为例）：
```typescript
// packages/agent-runtime/src/tools/bash.ts
import { execSync } from 'node:child_process';
import type { Tool } from './index.js';

export const bashTool: Tool = {
  name: 'bash',
  description: '在沙箱中执行 shell 命令',
  async execute(input) {
    const { command, timeout = 120000 } = input as { command: string; timeout?: number };
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      cwd: process.env.WORKSPACE_DIR ?? '/workspace',
    });
    return result;
  },
};
```

- [ ] **Step 4: 端到端验证**

通过 WebUI 发送消息，Agent 应能执行 bash 命令、读写文件等。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 完整集成 Agent SDK + 工具集 + Provider API 重试"
```

---

### Task 18: ToolGuard — Agent 行为安全

**Files:**
- Create: `packages/server/src/core/tool-guard.ts`
- Modify: `packages/server/src/core/agent-manager.ts`

- [ ] **Step 1: 写 ToolGuard 测试**

```typescript
describe('ToolGuard', () => {
  it('should block rm -rf /', () => { ... });
  it('should block curl | bash', () => { ... });
  it('should confirm git push --force', () => { ... });
  it('should allow normal commands', () => { ... });
});
```

- [ ] **Step 2: 实现 ToolGuard**

基于规则匹配的工具调用拦截器，返回 allow/block/confirm。

- [ ] **Step 3: 集成到 AgentManager**

Agent 工具调用时经过 ToolGuard 检查，block 直接拒绝，confirm 通过 WebSocket 推送给用户。

- [ ] **Step 4: 运行测试**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 实现 ToolGuard Agent 行为安全拦截"
```

---

### Task 19: 定时任务调度

**Files:**
- Create: `packages/server/src/core/scheduler.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 实现 Scheduler**

```typescript
// 使用 node-cron + p-queue
// 启动时从 PG 加载所有 enabled 的 scheduled_tasks
// 每分钟扫描 nextRunAt 到期的任务
// 执行时创建临时 session → 调用 AgentManager → 记录 task_run
```

- [ ] **Step 2: 集成到 server 启动流程**
- [ ] **Step 3: 通过控制台创建定时任务并验证执行**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 实现定时任务调度系统"
```

---

### Task 19.5: Chunk 4 中间验证 + 单元测试

**Files:**
- Create: `packages/server/src/auth/rbac.test.ts`
- Create: `packages/server/src/auth/rate-limit.test.ts`
- Create: `packages/server/src/core/agent-manager.test.ts`

- [ ] **Step 1: RBAC 单元测试**

```typescript
// packages/server/src/auth/rbac.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('requireRole', () => {
  it('should allow admin for admin-only routes', async () => {
    // mock Hono Context with user.role = 'admin'
    // verify next() is called
  });

  it('should reject user for admin-only routes', async () => {
    // mock Hono Context with user.role = 'user'
    // verify 403 response
  });
});

describe('requireWorkspaceAccess', () => {
  it('should allow workspace creator', async () => {
    // workspace.createdBy === user.sub
  });

  it('should reject non-creator', async () => {
    // workspace.createdBy !== user.sub，返回 403
  });
});
```

- [ ] **Step 2: Rate Limit 单元测试**

```typescript
// packages/server/src/auth/rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import { checkLoginRateLimit, recordLoginFailure, clearLoginAttempts } from './rate-limit.js';

describe('loginRateLimit', () => {
  it('should allow first attempt', () => {
    expect(checkLoginRateLimit('127.0.0.1').allowed).toBe(true);
  });

  it('should lock after max attempts', () => {
    const ip = '192.168.1.1';
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    expect(checkLoginRateLimit(ip).allowed).toBe(false);
    clearLoginAttempts(ip);
  });
});

describe('apiRateLimit', () => {
  it('should return 429 after exceeding rate limit', () => {
    // 模拟超过 100 次请求，验证返回 429
  });
});
```

- [ ] **Step 3: AgentManager 上下文组装测试**

```typescript
// packages/server/src/core/agent-manager.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('AgentManager.assembleContext', () => {
  it('should load user-level + workspace-level memories with override', async () => {
    // mock db 查询，验证两级记忆加载，同名工作区级覆盖用户级
  });

  it('should build system prompt with safety rules', async () => {
    // 验证 system prompt 包含安全规则
  });
});

describe('AgentManager.resolveProvider', () => {
  it('should follow priority: workspace binding > user default', async () => {
    // mock 不同级别的 Provider 配置，验证优先级
  });

  it('should throw when no Provider configured', async () => {
    // 用户未配置任何 Provider，验证抛出错误
  });
});
```

- [ ] **Step 4: 运行全部测试**

```bash
pnpm --filter @ccclaw/server exec vitest run
```
Expected: 所有测试通过

- [ ] **Step 5: 端到端流程验证**

启动服务，通过 curl + wscat 验证完整流程：
1. 登录获取 token
2. 创建工作区 + session
3. WebSocket 连接并发送消息
4. 创建定时任务
5. 验证审计日志记录

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/**/*.test.ts
git commit -m "test: 添加 RBAC、限流和上下文组装单元测试"
```

---

### Task 20: Docker 生产部署

**Files:**
- Create: `docker/server.Dockerfile`
- Modify: `docker/compose.yml`

- [ ] **Step 1: 创建 Server Dockerfile**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /build
COPY . .
RUN npm install -g pnpm && pnpm install && pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /build/packages/server/dist ./server
COPY --from=builder /build/packages/web/dist ./web
COPY --from=builder /build/packages/server/package.json ./
RUN npm install --production
CMD ["node", "server/index.js"]
```

- [ ] **Step 2: 构建沙箱镜像**

```bash
docker build -t ccclaw-sandbox:latest -f docker/sandbox/Dockerfile .
```

- [ ] **Step 3: 测试完整 compose 部署**

```bash
docker compose -f docker/compose.yml up -d
```

- [ ] **Step 4: Commit**

```bash
git add docker/
git commit -m "feat: 生产环境 Docker 部署配置"
```

---

## Chunk 总结

| Chunk | 阶段 | Tasks | 核心交付物 |
|-------|------|-------|-----------|
| 1 | P0 | 1-7 | Monorepo + DB + Auth + 全部 REST API |
| 2 | P1 | 8-11 | 沙箱容器 + Agent Runtime + WebSocket 通信 |
| 3 | P2 | 12-15 | WebUI 对话界面 + 管理控制台 |
| 4 | P3+P4 | 16-20 | 上下文组装 + Agent SDK + ToolGuard + 定时任务 + 测试 + 部署 |

每个 Chunk 完成后都应该是可运行、可测试的状态。
