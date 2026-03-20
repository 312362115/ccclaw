---
priority: P2
status: done
spec:
plan:
---

# 测试修复

## MCP Manager 测试（8 个失败）
vitest 升级后 `mockReturnValue` 不兼容 class 构造函数，需改用 `mockImplementation`。
文件：`packages/agent-runtime/src/mcp-manager.test.ts`

## FileWatcher flaky test（偶发失败）
`should ignore files in node_modules` 测试偶现超时，怀疑 fs.watch 事件时序问题。
文件：`packages/agent-runtime/src/file-watcher.test.ts`
