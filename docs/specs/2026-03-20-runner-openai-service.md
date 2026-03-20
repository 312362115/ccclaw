# 技术方案：Runner 独立 OpenAI 兼容服务

## 1. 背景与目标

Runner 可以脱离 Server 独立运行，暴露 OpenAI 兼容 API，让 Cursor/Continue 等 IDE 插件或其他系统通过标准 OpenAI SDK 接入 Agent 能力。

- **验收标准**：`--mode standalone` 启动后，`/v1/chat/completions` streaming SSE 正常工作
- **安全约束**：Bearer Token 认证 + 速率限制；连接 Server 的 Runner 不暴露此能力
- **能力边界**：工具调用对外不可见，只返回最终文本

## 2. 现状分析

- `index.ts`：Runner 入口，`--mode runner` 连接 Server WebSocket
- `direct-server.ts`：已有 HTTP + WS 服务器，用于前端直连
- `agent.ts`：`runAgent()` 是核心执行引擎，支持流式回调
- `llm/factory.ts`：`LLMProviderFactory.create()` 创建 Provider

## 3. 方案设计

新增 `standalone.ts` 作为独立入口，启动 HTTP 服务暴露 OpenAI API。

### 启动方式
```bash
# 独立模式（暴露 OpenAI API）
node dist/standalone.js --port 8080

# 环境变量配置
STANDALONE_API_KEY=sk-xxx        # 调用方使用的 Bearer Token
STANDALONE_PROVIDER=claude       # 后端 LLM Provider 类型
STANDALONE_PROVIDER_KEY=sk-ant-  # 后端 LLM Provider 的 API Key
STANDALONE_MODEL=claude-sonnet-4-20250514
STANDALONE_RATE_LIMIT=60         # 每分钟请求上限
```

### 接口设计
```
POST /v1/chat/completions
Authorization: Bearer <STANDALONE_API_KEY>

Request:  OpenAI ChatCompletion 格式
Response: OpenAI ChatCompletion 格式（stream: true 时 SSE）
```

### 安全设计
1. **Bearer Token 认证**：`STANDALONE_API_KEY` 必须配置，否则拒绝启动
2. **速率限制**：滑动窗口，每分钟 N 次请求
3. **工具不可见**：Agent 内部可调用工具，但对外只流式返回 text_delta
4. **互斥**：检测到 `SERVER_URL` 环境变量时，不启动 OpenAI API

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `standalone.ts` | 新增 | 独立入口，HTTP 服务 + OpenAI API |
| `openai-compat.ts` | 新增 | OpenAI 协议转换层（请求/响应映射） |
| `package.json` | 修改 | 新增 `standalone` script |

## 4. 实施计划

1. 新增 `openai-compat.ts`：请求解析 + SSE 响应生成
2. 新增 `standalone.ts`：HTTP 服务 + 认证 + 速率限制 + 调用 runAgent
3. 修改 `package.json`：新增启动脚本
4. 测试

## 5. 风险与边界
- **不做**：模型列表 `/v1/models`、embeddings、图片生成、function calling 暴露
- **风险**：长对话 token 消耗 → 限制单次请求 max_tokens
