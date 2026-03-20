---
priority: P3
status: done
spec: docs/specs/system-design/security.md
plan:
---

# 自定义 seccomp profile

## 背景
当前 Docker 沙箱使用 `seccomp=unconfined`（不限制系统调用），安全性不足。
需要替换为自定义 seccomp profile，只允许 Agent 运行所需的系统调用。

## 要做的事
- 分析 Agent Runtime 实际使用的系统调用（strace 采样）
- 编写自定义 seccomp.json profile
- 阻止高危系统调用（mount、reboot、kexec_load 等）
- 在 Docker compose 和 Dockerfile 中引用
- 测试 Agent 基本功能不受影响

## 参考
- `docs/specs/system-design/security.md` 第 132 行
- Docker seccomp 文档
