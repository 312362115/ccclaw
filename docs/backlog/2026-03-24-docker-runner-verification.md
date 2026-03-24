---
priority: P1
status: open
---

# Docker Runner 完整启动流程验证

## 背景
Docker Runner 镜像已修复 zod 依赖缺失问题（Dockerfile 中 /shared 包未 npm install），但尚未验证完整启动流程。

## 待办
1. `make docker-sandbox` 重建镜像
2. 手动验证容器能启动并连回 Server
3. 通过前端创建 docker 工作区 → 发消息 → 验证 AI 回复
4. 验证容器资源限制（512MB 内存、CPU quota）生效
5. 验证容器清理（工作区删除时 stop 容器）

## 关联
- 修复记录：docs/decisions/2026-03-24-session-fix-and-ui-enhancement.md
