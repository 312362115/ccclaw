# 运维与交付

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## 定时任务

### 调度机制

- node-cron 进程内调度，每分钟扫描 scheduled_tasks 表
- p-queue 全局共享队列，限制并发（默认 3，`SCHEDULER_CONCURRENCY` 可配置）
- 每用户最多 10 个定时任务（`MAX_TASKS_PER_USER`）
- 调度按 `nextRunAt` 排序，FIFO 执行
- 每次执行创建临时 session，完整记录可回溯

> **单实例限制**：node-cron 为进程内调度，多实例部署会导致任务重复执行。当前设计为单 Server 实例。如需多实例部署，需引入分布式锁（如 PostgreSQL advisory lock 或 Redis `SET NX`），确保同一时刻只有一个实例执行调度扫描。

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

## 健康检查

```
GET /health

Response 200:
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": "ok",         // 主数据库连接
    "scheduler": "ok"         // node-cron 调度器状态
  }
}

Response 503:
{
  "status": "degraded",
  "checks": {
    "database": "error: connection refused",
    "scheduler": "ok"
  }
}
```

Docker / Kubernetes 部署时配置 liveness 和 readiness 探针指向此端点。

## 监控与告警

### 关键指标（Prometheus 格式）

| 指标 | 类型 | 说明 |
|------|------|------|
| `ccclaw_http_requests_total` | Counter | HTTP 请求计数（按 method、path、status 分标签） |
| `ccclaw_http_request_duration_seconds` | Histogram | 请求延迟分布 |
| `ccclaw_ws_connections_active` | Gauge | 当前 WebSocket 连接数（按类型：client/runner） |
| `ccclaw_agent_requests_total` | Counter | Agent 请求计数（按 workspace、status） |
| `ccclaw_agent_request_duration_seconds` | Histogram | Agent 请求耗时（含工具调用） |
| `ccclaw_tokens_total` | Counter | Token 消耗（按 model、direction:input/output） |
| `ccclaw_runner_status` | Gauge | Runner 状态（1=online, 0=offline，按 runnerId） |
| `ccclaw_scheduler_queue_depth` | Gauge | 调度队列深度 |
| `ccclaw_scheduler_task_runs_total` | Counter | 任务执行计数（按 status:success/failed） |

通过 Hono 中间件收集，暴露 `GET /metrics` 端点（仅限内网或 Bearer Token 访问）。

### 告警规则（参考）

| 条件 | 级别 | 动作 |
|------|------|------|
| HTTP 5xx 错误率 > 5%（5min 窗口） | Critical | 通知 admin |
| Agent 请求平均延迟 > 60s | Warning | 通知 admin |
| Runner 离线 > 5min | Warning | 通知 workspace owner |
| 调度队列深度 > 10 | Warning | 通知 admin |
| 任务连续失败 > 3 次 | Warning | 禁用任务 + 通知 owner |
| 磁盘使用 > 80% | Warning | 通知 admin |

## 备份与恢复

### 备份策略

| 数据 | 方式 | 频率 | 保留 |
|------|------|------|------|
| 主数据库（PostgreSQL） | `pg_dump --format=custom` | 每日凌晨 | 30 天 |
| 主数据库（MySQL） | `mysqldump --single-transaction` | 每日凌晨 | 30 天 |
| 主数据库（SQLite） | `sqlite3 .backup` 或复制文件 | 每日凌晨 | 30 天 |
| workspace.db（每个工作区） | 复制 `.db` + `.db-wal` 文件 | 每日凌晨 | 14 天 |
| 工作区文件（home/ + internal/） | rsync 或 tar | 每周 | 4 周 |

备份文件存储在 `/data/ccclaw/backups/`，建议异地备份（如 S3、OSS）。备份文件使用 GPG 或 age 加密。

### 恢复流程

```bash
# 1. 停止服务
docker compose down

# 2. 恢复主数据库
pg_restore -d ccclaw < /data/ccclaw/backups/pg-2026-03-16.dump

# 3. 恢复工作区数据
cp /data/ccclaw/backups/workspaces/{slug}/internal/workspace.db \
   /data/ccclaw/workspaces/{slug}/internal/workspace.db

# 4. 启动服务（自动执行 migration）
docker compose up -d

# 5. 验证
curl http://localhost:3000/health
```

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | HTTP 服务端口 |
| `DB_DIALECT` | 是 | - | 数据库类型：`postgres` / `mysql` / `sqlite` |
| `DATABASE_URL` | 是 | - | 数据库连接串（SQLite 为文件路径） |
| `ENCRYPTION_KEY` | 是 | - | AES-256-GCM 加密密钥（32 字节 hex） |
| `JWT_SECRET` | 是 | - | JWT 签名密钥 |
| `DATA_DIR` | 否 | `/data/ccclaw` | 工作区数据根目录 |
| `SCHEDULER_CONCURRENCY` | 否 | `3` | 定时任务并发数 |
| `MAX_TASKS_PER_USER` | 否 | `10` | 每用户最大定时任务数 |
| `MAX_SANDBOXES` | 否 | `5`（SQLite: `3`） | 最大并发沙箱数 |
| `LOG_LEVEL` | 否 | `info` | 日志级别（debug/info/warn/error） |
| `SANDBOX_IMAGE` | 否 | `ccclaw-sandbox:latest` | 沙箱 Docker 镜像 |
| `CORS_ORIGIN` | 否 | 自身域名 | CORS 允许的源 |

## 使用统计

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

**数据聚合**：

raw `token_usage` 记录量大，统计看板查询使用预聚合视图：

```sql
-- 每日聚合（定时任务每日凌晨执行）
CREATE TABLE token_usage_daily (
  date        date,
  userId      uuid,
  workspaceId uuid,
  model       text,
  inputTokens  bigint,
  outputTokens bigint,
  requestCount integer,
  PRIMARY KEY (date, userId, workspaceId, model)
);
```

**数据保留**：
- Raw `token_usage`：保留 90 天，之后清理
- `token_usage_daily`：保留 2 年
- 清理由定时任务执行：`DELETE FROM token_usage WHERE createdAt < NOW() - INTERVAL '90 days'`

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

## 分阶段交付

| 阶段 | 范围 |
|------|------|
| P0 | 核心骨架：工程结构 + DB schema + 邀请码注册/认证 + 基础 API |
| P1 | Agent 运行时：Runner + 工具集 + 流式通信（含 thinking_delta） |
| P2 | WebUI：对话界面 + 在线终端 + 管理控制台 |
| P3 | 记忆/技能/MCP 系统 + 上下文组装 + Provider 管理 |
| P4 | 定时任务 + Agent 行为安全 + 使用统计看板 |
| P5 | Agent Runtime 增强：Token 驱动整合 + ToolRegistry 参数修正 + MCP 懒连接超时 + 消息总线 + 子 Agent + Heartbeat |
| P6 | 渠道扩展：Telegram / 飞书 / 企微（基于消息总线） |
| P7 | 商业化：配额管理 + 订阅套餐 + 支付 + 账号池 |
