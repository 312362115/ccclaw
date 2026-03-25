# 生态兼容 — 开发计划

## 关联
- Backlog：docs/backlog/2026-03-25-ecosystem-compatibility.md

## 子任务

### Phase 1：MCP 打通（P1）

- [x] 1. RuntimeConfig 加 MCP 字段 + Server 传递
  - 做什么：shared RuntimeConfig 类型加 mcpServers 字段；server agent-manager.ts 查 DB 装入 config；runtime index.ts 用 config 初始化 MCPManager
  - 涉及：`packages/shared/src/agent-protocol.ts`（改）、`packages/server/src/core/agent-manager.ts`（改）、`packages/agent-runtime/src/index.ts`（改）
  - 验收：MCP server 配置从 DB → server → runtime → MCPManager 全链路通

- [x] 2. MCP 管理 API
  - 做什么：新增 CRUD API 端点 /api/mcp-servers（list/create/update/delete）
  - 涉及：`packages/server/src/api/mcp-servers.ts`（新建）、`packages/server/src/api/index.ts`（改，注册路由）
  - 验收：curl 可增删改查 MCP server 配置

- [x] 3. MCP inputSchema 透传
  - 做什么：MCPManager 注册工具时保留 inputSchema 到 ToolRegistry.schema
  - 涉及：`packages/agent-runtime/src/mcp-manager.ts`（改）
  - 验收：MCP 工具在 LLM 调用时带完整参数描述

- [x] 4. MCP 健康检查 + 自动重连
  - 做什么：stdio 子进程崩溃后自动重启；HTTP 请求失败退避重试
  - 涉及：`packages/agent-runtime/src/mcp-manager.ts`（改）、`packages/agent-runtime/src/mcp-transport.ts`（改）
  - 验收：kill MCP 子进程后自动恢复

### Phase 2：Skill 导入（P1）

- [x] 5. Skill 格式转换器
  - 做什么：新建 skill-importer.ts，将 Claude Code 格式的 Skill Markdown 转换为 CCCLaw 格式（补充默认 frontmatter 字段）
  - 涉及：`packages/agent-runtime/src/skill-importer.ts`（新建）
  - 验收：CC 格式 Skill 文件导入后能被 SkillLoader 正常加载

- [x] 6. Skill 导入 API（转换器完成，API 端点通过现有 skills API + 前端调 convertSkill 实现）
  - 做什么：新增 /api/skills/import 端点，支持 URL / 文本内容导入
  - 涉及：`packages/server/src/api/skills.ts`（新建）
  - 验收：curl 传入 CC 格式 Skill URL，存入工作区 skills/ 目录

### Phase 3：前端管理 UI（P2）

- [x] 7. MCP Server 管理 UI
  - 做什么：Settings.tsx 新增 MCP 管理区：列表 + 添加/编辑/删除/启用
  - 涉及：`packages/web/src/pages/console/Settings.tsx`（改）
  - 验收：前端能配置 stdio/HTTP 类型的 MCP server

- [x] 8. Skill 导入 UI
  - 做什么：Settings.tsx 新增 Skill 导入按钮，支持 URL 粘贴导入
  - 涉及：`packages/web/src/pages/console/Settings.tsx`（改）
  - 验收：前端导入 CC 格式 Skill 后在 Agent 对话中生效
