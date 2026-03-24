---
priority: P2
status: open
---

# 文件/文件夹拖动移动

## 需求
工作区文件树支持拖拽移动文件和文件夹到其他目录。

## 涉及
- 前端：FileTree 组件增加 drag & drop 交互
- 后端：agent-runtime file handler 增加 move/rename 操作
- 协议：DirectMessage 增加 `file.move` action

## 验收标准
- 拖拽文件到目录可移动
- 拖拽文件夹到目录可移动
- 拖拽到根目录可移动
- 文件树实时更新
