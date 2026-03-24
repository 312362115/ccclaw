---
priority: P2
status: open
---

# PTY 终端 posix_spawnp 失败

## 现象
Runner 中 TerminalManager 打开 PTY 时报 `posix_spawnp failed`，Web 终端无法使用。

## 可能原因
- node-pty 的 native addon 编译环境与运行环境不匹配
- Docker 容器中 CapDrop ALL 导致 PTY spawn 权限不足

## 待办
1. 排查本地（local 模式）PTY 失败原因
2. 排查 Docker 容器内 PTY 是否需要额外 capabilities
3. 验证 node-pty 版本与 Node.js 版本兼容性
