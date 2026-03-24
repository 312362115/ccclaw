---
priority: P1
status: open
---

# 直连通道扩展：终端 + 文件编辑

## 背景
当前终端和文件编辑走的是 Server relay（浏览器 → Server WS → Runner），多一跳导致明显卡顿。
聊天和文件树已经走直连（浏览器 → Runner DirectWs），需要把终端和文件编辑也迁移到直连通道。

## 待办

### 终端直连
- Runner 端：DirectServer 支持 `terminal` channel（open/input/resize/close/output/exit）
- 前端：TerminalPanel 优先走 DirectWs 发终端消息
- 前端：useDirectConnection 接收 terminal output/exit 事件并转发到 xterm

### 文件实时编辑
- 前端：FilePreview 改为可编辑（CodeMirror/Monaco 或简单 textarea）
- 前端：编辑后通过 DirectWs 发 `file:write` 保存
- Runner 端：已有 file write handler，无需改动
- 考虑：防抖保存、编辑锁、冲突提示

## 验收标准
- 终端输入无感知延迟（< 50ms）
- 文件编辑保存实时生效
- 直连断开时 graceful fallback 到 relay
