---
priority: P2
status: done
---

# PTY 终端 posix_spawnp 失败

## 现象
Runner 中 TerminalManager 打开 PTY 时报 `posix_spawnp failed`，Web 终端无法使用。

## 根因
node-pty 1.1.0 的 prebuild 二进制（含 spawn-helper）不兼容 Node 25（ABI 141）。
Docker 环境使用 node:22-alpine 不受影响，仅影响本地开发（Node 25+）。

## 修复
- 将 `node-pty` 加入 `pnpm.onlyBuiltDependencies`，允许 pnpm 运行其安装脚本
- 添加 `postinstall` 脚本：`npm_config_build_from_source=true pnpm rebuild node-pty`
- 确保每次 `pnpm install` 自动从源码编译 node-pty，生成与当前 Node ABI 兼容的二进制

## 验证结果
- Node v25.8.1 下 PTY spawn + IO 测试通过
- Docker (Node 22) 不受影响（已通过 E2E 9/9）
