---
priority: P1
status: open
---

# 生态兼容：打通 Claude Code 生态（MCP / Skill / Plugin）

## 背景

Claude Code 已形成丰富的生态（MCP Server、Skill、Plugin），CCCLaw 的 Agent 框架与其有较高的底层兼容性，但缺少最后一步打通。打通后可以直接复用社区已有的工具和技能，大幅扩展 Agent 能力而无需自研。

## 兼容性现状

| 生态组件 | 兼容度 | 现状 | 差距 |
|---------|--------|------|------|
| **Tool 定义** | ✅ 100% | JSON Schema 格式完全一致，和 Claude API / OpenAI API 对齐 | 无 |
| **MCP Server** | ⚠️ 80% | MCPManager 已实现 stdio + HTTP 传输，支持 initialize / tools/list / tools/call | 缺 resources / prompts / sampling 方法 |
| **Skill 文件** | ⚠️ 60% | 都是 Markdown + YAML frontmatter，但字段不同 | 需要格式转换器 |
| **Plugin** | ⚠️ 80% | Plugin 底层是 MCP Server，MCP 通了 Plugin 就通 | 同 MCP 差距 |

## MCP 详细分析

### 已实现

- `initialize` — 协议握手，版本 `2024-11-05`
- `tools/list` — 获取工具列表，支持 enabledTools 白名单过滤
- `tools/call` — 调用工具，结果截断 16KB
- stdio 传输 — 子进程 stdin/stdout
- HTTP/SSE 传输 — HttpTransport 统一处理
- 工具自动注册 — `mcp_{serverName}_{toolName}` 命名

### 未实现

- `resources/list` + `resources/read` — 资源浏览（如数据库 schema、文件列表）
- `prompts/list` + `prompts/get` — 提示词模板
- `sampling/createMessage` — 服务端采样
- inputSchema 透传 — MCP server 返回的 schema 未保留到 ToolRegistry
- 健康检查 / 自动重连 — 断线后不恢复
- 超时可配 — 当前硬编码 30s

### 实际影响

大部分 MCP server（Brave Search、GitHub、Filesystem、Puppeteer 等）主要提供 tools，**现在就能用**。少数提供 resources 的（数据库浏览类）暂不支持。

## Skill 格式差异

### Claude Code 格式

```markdown
---
name: tdd
description: Test-driven development workflow
---

You MUST write tests before implementation...
```

### CCCLaw 格式

```markdown
---
name: tdd
description: Test-driven development workflow
command: npm test
trust: sandbox
requires:
  bins: [node, npm]
always: false
---

You MUST write tests before implementation...
```

### 差异点

| 字段 | Claude Code | CCCLaw | 说明 |
|------|------------|--------|------|
| name | ✅ | ✅ | 一致 |
| description | ✅ | ✅ | 一致 |
| command | ❌ | ✅ | CCCLaw 独有，声明可执行命令 |
| trust | ❌ | ✅ | CCCLaw 独有，安全级别 |
| requires | ❌ | ✅ | CCCLaw 独有，运行时依赖 |
| always | ❌ | ✅ | CCCLaw 独有，是否始终注入 system prompt |
| setup | ❌ | ✅ | CCCLaw 独有，安装脚本 |
| markdown body | ✅ | ✅ | **完全一致，核心内容通用** |

转换逻辑简单：Claude Code skill 导入时忽略未知字段，CCCLaw 独有字段设为默认值即可。

## 待办

### 第一步：MCP 配置前端入口（P1，2-3 天）

- 在工作区设置页添加 MCP Server 管理界面
- 支持 stdio / HTTP 两种传输方式配置
- 配置项：名称、命令/URL、参数、环境变量、启用的工具白名单
- 配置存入工作区 settings，Runner 启动时加载

### 第二步：Skill 导入功能（P1，2-3 天）

- 前端：Skill 管理页添加「导入」按钮
- 支持从 URL / Git 仓库 / 本地文件导入
- 自动格式转换（Claude Code → CCCLaw frontmatter 映射）
- 导入后存入 workspace 的 `skills/` 目录

### 第三步：MCP inputSchema 透传（P2，1 天）

- MCPManager 注册工具时保留 MCP server 返回的 inputSchema
- 传递到 ToolRegistry，使 LLM 能看到完整参数描述
- 提升弱模型调用 MCP 工具时的参数准确率

### 第四步：MCP 健康检查 + 重连（P2，1-2 天）

- stdio 传输：子进程崩溃后自动重启
- HTTP 传输：请求失败后指数退避重试
- 前端展示 MCP server 连接状态

### 第五步：补全 MCP resources / prompts（P3，3-5 天）

- 实现 `resources/list` + `resources/read`
- 实现 `prompts/list` + `prompts/get`
- 覆盖 100% MCP server 兼容

## 验收标准

- 能在前端配置并连接一个 stdio 类型的 MCP server（如 Brave Search）
- 能从 URL 导入一个 Claude Code 格式的 skill 文件，自动转换并生效
- MCP 工具在 Agent 对话中可正常调用
