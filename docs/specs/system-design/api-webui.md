# API 设计与 WebUI

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## API 设计

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
  PUT    /api/settings/password               修改密码（需验证当前密码）
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

消息
  GET    /api/workspaces/:id/sessions/:sid/messages    消息列表（?limit=50&before=cursor）

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
  POST   /api/workspaces/:id/tasks/:tid/run      手动触发执行
  GET    /api/workspaces/:id/tasks/:tid/runs      执行历史

Runner 状态
  GET    /api/workspaces/:id/runner/status        Runner 运行状态

文件管理
  GET    /api/workspaces/:id/files?path=/     列出目录内容
  GET    /api/workspaces/:id/files/*path      读取文件内容
  POST   /api/workspaces/:id/files            创建文件或文件夹
  PUT    /api/workspaces/:id/files/*path      更新文件内容
  DELETE /api/workspaces/:id/files/*path      删除文件或文件夹
  POST   /api/workspaces/:id/files/move       移动/重命名

审计日志（用户查看自己的操作记录）
  GET    /api/settings/logs                   当前用户的操作日志

统计看板
  GET    /api/settings/dashboard/summary         总览（总 token、总对话、活跃工作区数）
  GET    /api/settings/dashboard/usage           Token 用量趋势（?range=7d&groupBy=workspace|provider|model）

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

### 统一错误响应

所有 API 错误使用统一格式：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "邮箱格式不正确",
    "details": [{ "field": "email", "message": "must be a valid email" }]
  }
}
```

| HTTP 状态码 | error.code | 说明 |
|------------|------------|------|
| 400 | `VALIDATION_ERROR` | 请求参数校验失败（Zod） |
| 401 | `UNAUTHORIZED` | 未登录或 Token 过期 |
| 403 | `FORBIDDEN` | 无权限（非资源 owner 或非 admin） |
| 404 | `NOT_FOUND` | 资源不存在（对无权限资源也返回 404，防枚举） |
| 409 | `CONFLICT` | 资源冲突（如邮箱已注册、slug 重复） |
| 429 | `RATE_LIMITED` | 请求限流（响应头含 `Retry-After`） |
| 500 | `INTERNAL_ERROR` | 服务端错误 |

### 分页约定

列表接口统一使用 cursor 分页：

```
GET /api/workspaces?limit=20&cursor=xxx

Response:
{
  "data": [...],
  "cursor": "next-cursor-value",   // null 表示最后一页
  "total": 42                      // 可选，部分接口提供
}
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
  { type: 'subagent_started', sessionId, taskId, label }   // 子 Agent 启动
  { type: 'subagent_result', sessionId, taskId, output }    // 子 Agent 完成
  { type: 'runner_status', workspaceId, status }            // Runner 状态变更
  { type: 'session_archived', sessionId }                   // 会话归档通知
```

> **终端 ID 映射**：客户端使用 `sessionId` + `workspaceId` 标识终端连接，Server 内部生成 `terminalId` 转发给 Runner。映射关系由 Server 维护，客户端无需感知 `terminalId`。

> **`done` 消息 tokens 结构**：`tokens: { inputTokens: number, outputTokens: number }`，为本轮 Agent Loop 的累计值（含所有工具调用轮次）。

## WebUI 页面结构

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
/chat/:workspaceId/files             # 工作区文件浏览器
/chat/:workspaceId/terminal          # 工作区在线终端（xterm.js）
/chat/:workspaceId/settings          # 工作区设置（记忆、skill、MCP、定时任务、Runner 状态）
/chat/:workspaceId/settings/tasks/:tid/runs  # 任务执行历史

个人设置
/settings/profile                    # 个人信息（姓名、邮箱、密码修改、git 凭证）
/settings/preferences                # 偏好设置（语言、风格、自定义规则、模型参数、工具确认模式）
/settings/providers                  # Provider 管理（API Key / OAuth 凭证、默认 Provider 选择）
/settings/channels                   # IM 渠道绑定（Telegram、飞书等）
/settings/skills                     # 用户级 Skill 管理（跨所有工作区生效）
/settings/skills/marketplace         # Skill 市场（浏览和安装社区 Skill）
/settings/mcp-servers                # 用户级 MCP Server 管理（跨所有工作区生效）

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
