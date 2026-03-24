# 2026-03-24 消息回复修复 + 工作区/会话/文件 UI 增强

## 背景
用户在 ws-0cy41zog68 工作区发消息完全没有回复，排查后发现是多个问题叠加。同时对工作区管理、会话管理、文件管理做了一轮 UI 增强。

## 核心修复

### 1. 消息无回复根因（最重要）
- **表面现象**：发消息后 AI 标记出现又消失，没有任何回复内容
- **排查过程**：加 debug 日志到 OpenAI SSE stream，发现 API 返回了 error 而非内容
- **根因**：消息历史中有孤立的 `tool` 角色消息（之前对话中产生的工具调用结果，但对应的 `assistant` 消息的 `tool_calls` 信息没有存储到数据库），导致 qwen3 API 返回 400 错误：`messages with role "tool" must be a response to a preceding message with "tool_calls"`
- **修复**：`sanitizeMessages()` 增加 Step 2——过滤掉前面没有 `assistant + tool_calls` 的孤立 tool 消息
- **附带修复**：
  - SSE stream 中 API error 响应未被处理（静默吞掉），现在 yield error 事件
  - 增加 `reasoning_content` → `thinking_delta` 支持（Qwen3/DeepSeek thinking 模式）

### 2. 文件树不显示
- **根因**：Runner 发送的 action 名（`list_result`/`events`）与前端期待的（`snapshot`/`event`）不匹配
- **修复**：`useDirectConnection.ts` 同时匹配两种 action 名

### 3. Docker Runner 无法启动
- **表象**：点击 docker 工作区没反应，前端无请求
- **根因链条**：
  1. 前端 `GET /runner-info` 返回 404（runner 没启动）
  2. 前端直接 fallback 到 RELAY，不调 `ensure-config`
  3. `ensure-config` 是触发 docker runner 启动的唯一入口 → 死锁
- **修复**：`direct-ws.ts` 在 runner-info 404 时先调 `ensure-config` 再重试
- **附带问题**：Docker 镜像 `/shared` 包未安装依赖（缺 zod），Dockerfile 已修复

## UI 增强

### 工作区管理
- 新建工作区时必选 Provider + Model（不能创建完再设置）
- `/workspaces` 页面增加删除功能（二次确认弹窗）
- 工作区类型创建后不可更改

### 会话管理
- 会话列表 UI：时间右侧同行、字体/高度缩小、hover 显示时间和归档按钮
- 归档会话：软删除（status='archived'），列表不再显示
- 新建会话：生成唯一 ID + 自动进入编辑名字状态
- 双击聊天标题可编辑会话名，同步到后端
- 刷新页面自动选中最近会话（从 API 加载），左右面板保持同步
- 后端新增 `PATCH /sessions/:sid`（更新 title/status）

### 文件管理
- 文件区域增加新建文件/目录按钮（+ 图标）
- 文件/文件夹删除增加二次确认弹窗
- 连接状态从文件区移到 slug 行

## 遗留问题
- Docker Runner：镜像已修复但还未验证容器完整启动流程（zod 依赖修复后需要 `make docker-sandbox` 重建镜像再测试）
- 文件/文件夹拖拽移动：已记录 backlog（`docs/backlog/2026-03-24-file-drag-drop.md`）
- PTY 终端：`posix_spawnp failed` 仍存在（之前已知问题）
- `make runner` 需要根目录 tsx 依赖（已加到 devDependencies）

## 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/agent-runtime/src/llm/base.ts` | sanitizeMessages 过滤孤立 tool 消息 |
| `packages/agent-runtime/src/llm/openai.ts` | SSE error 处理 + reasoning_content |
| `packages/agent-runtime/src/index.ts` | consolidator callLLM 类型修复 |
| `packages/agent-runtime/src/direct-server.ts` | DirectServerOptions 补 port |
| `packages/server/src/api/sessions.ts` | PATCH 接口 + 只返回 active 会话 |
| `packages/web/src/api/direct-ws.ts` | 404 时触发 ensure-config |
| `packages/web/src/hooks/useDirectConnection.ts` | 兼容 list_result/events action |
| `packages/web/src/components/WorkspacePanel.tsx` | 文件/会话/连接状态 UI 全面增强 |
| `packages/web/src/components/WorkspaceSwitcher.tsx` | 新建时选 Provider/Model |
| `packages/web/src/pages/chat/ChatHeader.tsx` | 双击编辑标题 |
| `packages/web/src/pages/chat/ChatMain.tsx` | 传递 onSessionTitleChange |
| `packages/web/src/pages/chat/ChatPage.tsx` | 会话自动选中 + 标题联动 |
| `packages/web/src/pages/console/Workspaces.tsx` | 删除工作区 |
| `docker/sandbox/Dockerfile` | shared 包安装依赖 |
| `package.json` | tsx 加到根目录 devDependencies |
