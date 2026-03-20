---
priority: P2
status: done
spec:
plan:
---

# 前端测试覆盖

packages/web 当前零测试文件。需要建立基础测试体系。

## 优先级

1. **Zustand stores 单元测试**（chat.ts、workspace.ts）— 核心状态逻辑
2. **API 层 mock 测试**（api/*.ts）— 请求/响应处理
3. **关键组件测试**（消息列表、文件树）— 渲染和交互

## 技术选型
- vitest（已在 monorepo 中使用）
- @testing-library/react（组件测试）
- msw（API mock）
