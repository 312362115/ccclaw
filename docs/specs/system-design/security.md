# 安全设计

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## 认证安全

| 措施 | 实现 |
|------|------|
| 注册方式 | 管理员邀请码注册，不开放自由注册 |
| 密码存储 | bcrypt, cost=12 |
| JWT | access token 15min + refresh token 7d |
| refresh token | 存 PG，单设备单 token，刷新即旧 token 失效 |
| 登录保护 | 同 IP 连续失败 5 次锁定 15 分钟 |

## API 安全

| 措施 | 实现 |
|------|------|
| 权限校验 | 路由中间件验证 workspace.createdBy === user.id |
| 请求限流 | 内存计数器，按用户限制 QPS |
| 输入校验 | Zod schema 校验所有入参 |
| CORS | 仅允许自身域名 |
| 安全响应头 | Hono secureHeaders 中间件 |
| CSRF 防护 | SameSite=Strict cookie |

**Content Security Policy**：

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' wss:;
  font-src 'self';
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
```

> Agent 生成的 Markdown 内容在前端渲染时，使用 DOMPurify 或等效库进行 HTML 清洗，移除 `<script>`、`<iframe>`、`on*` 事件属性等。代码块内容不清洗（用户预期看到原始代码）。

## 数据安全

| 措施 | 实现 |
|------|------|
| Provider 凭证 / Git Token | AES-256-GCM 加密存储，密钥从环境变量 `ENCRYPTION_KEY` 读取 |
| 密钥轮换 | 提供 `npm run rotate-key` CLI 命令重新加密所有行 |
| JWT 客户端存储 | access token 仅存内存，refresh token 用 httpOnly + Secure + SameSite=Strict cookie |
| 审计日志 | 关键操作全记录 |
| 数据库备份 | PostgreSQL: 定时 `pg_dump`；SQLite: 复制 `.db` 文件 |

## Agent 行为安全（四层防护）

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

**ToolGuard 增强方向**：

当前基于命令字符串的正则匹配存在绕过风险（如 `$(rm -rf /)`、`python -c "import os; os.system(...)"`）。增强策略：

1. **多层匹配**：先 shell 解析（处理变量展开、子命令、管道），再对每个命令段独立匹配
2. **解释器检测**：检测 `python -c`、`node -e`、`perl -e` 等内联执行模式，对内联代码内容二次扫描
3. **路径规范化**：将所有文件路径 `resolve()` 后检查，防止 `../../` 和符号链接绕过
4. **频率限制**：单次会话连续触发 3 次 block 后，自动暂停 Agent 并通知用户

**第三层：审计 + 告警**

- 所有工具调用记录在 messages.toolCalls
- 异常检测：单次会话 bash 超 50 次 / token 超阈值 / 连续 block → 告警 admin

**第四层：输出侧敏感信息过滤**

Agent 响应发送给客户端之前，扫描输出内容中的敏感信息模式：

| 模式 | 正则示例 | 处理 |
|------|---------|------|
| API Key | `sk-[a-zA-Z0-9]{20,}`, `AKIA[A-Z0-9]{16}` | 替换为 `[REDACTED:api_key]` |
| Token | `ghp_[a-zA-Z0-9]{36}`, `glpat-[a-zA-Z0-9-]{20}` | 替换为 `[REDACTED:token]` |
| 密码模式 | `password\s*[:=]\s*\S+` | 替换为 `[REDACTED:password]` |
| 私钥 | `-----BEGIN.*PRIVATE KEY-----` | 替换为 `[REDACTED:private_key]` |

> 过滤在 Server 侧 WebSocket 推送前执行，不影响 Runner 侧的工具执行结果（Agent 仍能看到完整输出以继续工作）。仅过滤发送给用户的最终 `text_delta` 消息。

## 运行环境安全

### Docker 启动模式

- 容器隔离，非 root 用户运行 Runner
- 资源限制（CPU/内存）
- Docker Socket 不暴露给容器
- RunnerManager 只操作 `ccclaw.workspace=true` 标签的容器
- 容器内 Runner 通过 WS 连接宿主 Server

**容器加固配置**：

```typescript
{
  // 已有配置
  User: 'agent',
  Memory: 512 * 1024 * 1024,
  CpuQuota: 50000,
  ReadonlyRootfs: true,
  Tmpfs: { '/tmp': 'size=100m' },
  Labels: { 'ccclaw.workspace': 'true' },
  NetworkMode: 'bridge',

  // 加固配置
  CapDrop: ['ALL'],                          // 移除所有 Linux capabilities
  SecurityOpt: [
    'no-new-privileges:true',                // 禁止提权
    'seccomp=<docker/sandbox/seccomp.json>', // 自定义 seccomp profile，仅允许 Agent 所需的系统调用
  ],
  PidsLimit: 256,                            // 限制进程数，防 fork 炸弹

  // Volume 挂载（解决 ReadonlyRootfs 与写入需求的冲突）
  Binds: [
    '/data/ccclaw/workspaces/{slug}/home:/home/agent:rw',
    '/data/ccclaw/workspaces/{slug}/internal:/internal:rw',
  ],
}
```

> `ReadonlyRootfs: true` 使容器根文件系统只读，`/home/agent` 和 `/internal` 通过 bind mount 提供可写目录。`/tmp` 使用 tmpfs（100MB 上限）。

### 网络出口控制

**Docker 模式**：

容器默认允许出站网络（Agent 需要 git clone、npm install、web-fetch 等），但限制高危出站：

```bash
# 容器启动时注入 iptables 规则（通过 Docker --cap-add=NET_ADMIN 或 init 脚本）
# 禁止访问云元数据服务（防 SSRF 获取云凭证）
iptables -A OUTPUT -d 169.254.169.254 -j DROP
# 禁止访问内网敏感段（按部署环境配置）
iptables -A OUTPUT -d 10.0.0.0/8 -p tcp --dport 5432 -j DROP   # 禁止直连数据库
iptables -A OUTPUT -d 10.0.0.0/8 -p tcp --dport 6379 -j DROP   # 禁止直连 Redis
```

> 完全禁止出站网络会导致 Agent 无法工作（无法 clone、安装依赖、调用 API）。采用黑名单策略拦截高危目标，而非白名单。后续可增强为 DNS 代理 + 审计日志。

**Local 模式**：
- 无网络隔离能力（与宿主机共享网络栈）
- 依赖 ToolGuard 拦截危险网络命令（如 `curl` 到内网地址）
- 安全敏感场景建议使用 Docker 模式

### Runner 模式 — 目录权限与连接安全

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
WORKSPACE_DIR=/data/workspaces/ws-xxx/home \
INTERNAL_DIR=/data/workspaces/ws-xxx/internal \
WORKSPACE_DB=/data/workspaces/ws-xxx/internal/workspace.db \
ALLOWED_PATHS=/data/workspaces/ws-xxx/home:/data/workspaces/ws-xxx/internal/skills \
RUNNER_ID=runner-office-01 \
SERVER_URL=wss://ccclaw.example.com/ws/runner \
AUTH_TOKEN=<runner-token> \
node agent-runtime --mode runner
```

**本地 Runner** 由 Server 自动 fork，无需手动部署，环境变量通过 `buildSafeEnv()` 自动配置。

### Local 模式资源限制

Local fork 模式缺少容器级隔离，通过进程级限制防止资源耗尽：

```typescript
const child = fork(agentRuntimePath, {
  env: buildSafeEnv(workspace),
  execArgv: [
    '--max-old-space-size=512',    // V8 堆内存上限 512MB
  ],
});

// 进程级超时（与 runtimeConfig.timeout 一致，默认 1800s）
const killTimer = setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 5000);  // 5s 后强制 kill
}, timeoutMs);
```

> Local 模式适合开发调试，生产环境建议使用 Docker 模式以获得完整隔离。
