## 技术方案：平台加固 — 可观测性 + 安全审计 + 数据备份

### 1. 背景与目标

CCCLaw 平台核心功能链路已跑通，进入加固阶段。本次聚焦三个方向：

1. **可观测性**：让系统运行状态可见、可量化
2. **安全审计**：补齐已有安全机制的遗漏
3. **数据备份**：实现自动备份和恢复能力

**验收标准**：
- 所有 API 请求有延迟日志，health 端点反映真实依赖状态
- agent-runtime 日志结构化（Pino），不再用 console.log
- apiRateLimitMiddleware 全局生效，runner-info 需鉴权，CSP 头已配置
- 主库 + workspace.db 日备自动运行，可手动触发备份/恢复
- token_usage 超 90 天自动清理

**不做**：
- Prometheus/Grafana 集成（后续 P7 阶段）
- 前端测试（单独任务，本次不涉及）
- E2E 集成测试
- 异地备份（S3/OSS 对接）

---

### 2. 现状分析

| 模块 | 现状 | 问题 |
|------|------|------|
| 日志 | Server 用 Pino，agent-runtime 用 console.log | runtime 日志无结构化，无法被日志系统采集 |
| 请求监控 | 无 | 无法追踪 API 延迟和错误率 |
| 健康检查 | `GET /health` 返回 `{status:'ok'}` | 不检查 DB/Runner，无法反映真实健康状态 |
| API 限流 | `apiRateLimitMiddleware` 已实现但未挂载 | 除登录外所有 API 无限流保护 |
| runner-info | `/api/workspaces/:id/runner-info` 无鉴权 | 任何人可探测 Runner 状态 |
| CSP | 未配置 | 缺少 XSS 深度防御 |
| 备份 | backup 目录已创建，文档有设计，代码未实现 | 数据丢失无恢复手段 |
| 数据清理 | 无 | token_usage 表无限增长 |

**涉及文件清单**：

```
packages/server/src/
├── index.ts                      # 挂载中间件、health 路由
├── logger.ts                     # Pino 配置（复用）
├── config.ts                     # 新增备份相关配置
├── middleware/
│   ├── security.ts               # 添加 CSP
│   └── request-logger.ts         # 新建：请求延迟中间件
├── auth/rate-limit.ts            # 已有，需在入口挂载
├── api/
│   ├── index.ts                  # 挂载限流中间件
│   └── runner-info.ts            # 加鉴权
├── core/
│   ├── backup.ts                 # 新建：备份服务
│   └── data-retention.ts         # 新建：数据清理
│
packages/agent-runtime/src/
├── logger.ts                     # 新建：Pino 实例
├── index.ts                      # 替换 console → logger
```

---

### 3. 方案设计

#### 3.1 安全加固（最优先，改动最小风险最低）

**3.1.1 全局 API 限流**

在 `api/index.ts` 中挂载已有的 `apiRateLimitMiddleware`：

```typescript
// api/index.ts
import { apiRateLimitMiddleware } from '../auth/rate-limit.js';

export const api = new Hono();
api.use('*', apiRateLimitMiddleware());  // 全局，未认证请求自动跳过
```

已有实现特性（无需修改 rate-limit.ts）：
- 基于用户 ID 滑动窗口，100 次/分钟
- 未认证请求自动 pass（由 auth 中间件拦截）
- 定时清理过期窗口

**3.1.2 runner-info 加鉴权**

```typescript
// runner-info.ts
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';

runnerInfoRoute.get('/workspaces/:id/runner-info',
  authMiddleware,
  requireWorkspaceAccess(),
  async (c) => { ... }
);
```

**3.1.3 CSP 头配置**

```typescript
// middleware/security.ts
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],   // TailwindCSS 需要
    imgSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],     // WebSocket 连接
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
});
```

开发环境可以放宽限制（Vite HMR 需要），生产环境严格。

#### 3.2 可观测性

**3.2.1 请求延迟中间件**

新建 `middleware/request-logger.ts`：

```typescript
import type { Context, Next } from 'hono';
import { logger } from '../logger.js';

export async function requestLogger(c: Context, next: Next) {
  const start = performance.now();
  await next();
  const ms = Math.round(performance.now() - start);
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: ms,
  }, 'request');
}
```

在 `index.ts` 中 `app.use('*', requestLogger)` 挂载。

**3.2.2 健康检查增强**

```typescript
app.get('/health', async (c) => {
  const checks = {
    status: 'ok' as 'ok' | 'degraded',
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    db: false,
    runners: 0,
  };

  // DB 检查
  try {
    db.select({ id: schema.users.id }).from(schema.users).limit(1).get();
    checks.db = true;
  } catch { checks.status = 'degraded'; }

  // Runner 在线数
  checks.runners = runnerManager.getOnlineCount();

  return c.json(checks);
});
```

**3.2.3 agent-runtime 接入 Pino**

在 `packages/agent-runtime/src/` 新建 `logger.ts`：

```typescript
import pino from 'pino';

const RUNNER_ID = process.env.RUNNER_ID || 'unknown';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  base: { runner: RUNNER_ID },  // 每条日志自动带 runner ID
});
```

替换 `index.ts` 中所有 `console.log/error/warn` 调用。pino 作为 shared 已在 server 使用，agent-runtime 的 `package.json` 需添加依赖。

#### 3.3 数据备份

**3.3.1 自动备份服务**

新建 `packages/server/src/core/backup.ts`：

```typescript
// 核心逻辑
export class BackupService {
  // SQLite 主库备份：使用 better-sqlite3 的 .backup() API
  async backupMainDb(): Promise<string>;

  // 遍历所有 workspace，备份每个 workspace.db + .db-wal
  async backupWorkspaceDbs(): Promise<string[]>;

  // 清理过期备份（主库 30 天，workspace 14 天）
  async pruneOldBackups(): Promise<number>;
}
```

备份目录结构：
```
/data/ccclaw/backups/
├── main/
│   ├── ccclaw-2026-03-19.db
│   └── ccclaw-2026-03-18.db
└── workspaces/
    └── {slug}/
        ├── workspace-2026-03-19.db
        └── workspace-2026-03-18.db
```

SQLite 备份使用 `better-sqlite3` 的 `.backup(destination)` API，支持在线热备（不阻塞读写）。

**调度方式**：复用已有的 Scheduler 模块（cron 表达式），在服务启动时注册系统内置任务：
- `0 2 * * *` — 每日凌晨 2 点执行备份
- 备份完成后自动清理过期文件

**3.3.2 手动备份/恢复 CLI**

新建 `packages/server/src/cli/backup-cli.ts`，通过 `tsx` 直接运行：

```bash
# 手动触发备份
npx tsx packages/server/src/cli/backup-cli.ts backup

# 恢复指定日期的备份
npx tsx packages/server/src/cli/backup-cli.ts restore --date 2026-03-18

# 列出可用备份
npx tsx packages/server/src/cli/backup-cli.ts list
```

**3.3.3 token_usage 数据清理**

新建 `packages/server/src/core/data-retention.ts`：

```typescript
export async function cleanExpiredTokenUsage(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const result = await db.delete(schema.tokenUsage)
    .where(lt(schema.tokenUsage.createdAt, cutoff));
  return result.rowsAffected;
}
```

随备份任务一起调度，在每日备份后执行。

---

### 4. 实施计划

按依赖关系分 3 批：

| 批次 | 任务 | 依赖 | 文件数 |
|------|------|------|--------|
| **P1 安全** | 全局限流 + runner-info 鉴权 + CSP | 无 | 3 |
| **P2 可观测** | 请求日志中间件 + health 增强 + runtime Pino | P1（先修好安全再加监控） | 4 |
| **P3 备份** | 备份服务 + CLI + token 清理 | 无 | 3 |

P1 和 P3 可并行，P2 在 P1 后顺序执行。

每个任务完成后运行 `pnpm typecheck` 验证类型安全。

---

### 5. 风险与边界

| 风险 | 应对 |
|------|------|
| CSP 过严导致前端白屏 | 开发环境不启用 CSP，生产环境渐进收紧 |
| 限流影响正常用户 | 100次/分钟已足够宽松，且只对认证用户生效 |
| 备份占用磁盘 | 自动清理过期文件 + 备份文件用日期命名便于管理 |
| better-sqlite3 backup API 阻塞 | .backup() 是异步的，不会阻塞主线程 |
| PostgreSQL/MySQL 场景的备份 | 本次只实现 SQLite 备份，PG/MySQL 用户依赖运维层面的 pg_dump/mysqldump |

**明确不做**：
- Prometheus metrics exporter
- 前端单元测试
- 异地备份对接
- session 归档/压缩
