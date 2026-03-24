---
priority: P1
status: done
---

# Docker Runner 完整启动流程验证

## 背景
Docker Runner 镜像已修复 zod 依赖缺失问题（Dockerfile 中 /shared 包未 npm install），但尚未验证完整启动流程。

## 验证结果（2026-03-24）

自动化验证脚本：`scripts/verify-docker-runner.sh`，9/9 ALL PASS。

| 验证项 | 结果 |
|--------|------|
| `make docker-sandbox` 镜像构建 | PASS |
| 登录 + 创建 docker 工作区 | PASS |
| `ensure-config` 触发容器启动 | PASS |
| 容器 running | PASS |
| Runner 注册成功（WS 连回 Server） | PASS |
| 收到 config 消息 | PASS |
| `runner-info` 返回 directUrl | PASS |
| Memory 512MB | PASS |
| CpuQuota 50% | PASS |

## 修复过程中发现的问题
1. **`runner-info.ts` 类型错误**：`c.req.param('id')` 返回 `string | undefined`，加 `!` 断言修复
2. **`file-tree.test.ts` 类型错误**：`mtime` 应为 `number`，测试中误写为字符串
3. **创建工作区 `startMode` 位置**：必须放在 `settings` 对象内，非顶层字段

## AI 对话 E2E（2026-03-24 补充验证）

验证脚本：`scripts/verify-docker-chat.mjs`

| 验证项 | 结果 |
|--------|------|
| 创建 Provider（litellm, qwen3-coder-plus） | PASS |
| 创建 docker 工作区绑定 Provider + Model | PASS |
| ensure-config 推送 LLM 配置到容器 | PASS |
| WebSocket 直连 Runner | PASS |
| 发消息并收到 AI 回复 | PASS |

修复了 2 个 bug：
1. **Docker 容器缺 `JWT_SECRET`** — 浏览器直连用 JWT 验证，但容器没收到 `JWT_SECRET`，已在 `startDockerRunner` 的 Env 中补上
2. **容器内 `apiBase` 地址不通** — Provider 存的 `127.0.0.1` 在容器内指向自身，`applyConfig` 中检测到 Docker 环境时自动替换为 `host.docker.internal`

## 遗留
- 容器清理：删除工作区时不会自动 stop 容器（需手动或另加逻辑）

## 关联
- 修复记录：docs/decisions/2026-03-24-session-fix-and-ui-enhancement.md
