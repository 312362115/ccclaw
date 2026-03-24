---
priority: P2
status: done
---

# 文件/文件夹拖动移动

## 需求
工作区文件树支持拖拽移动文件和文件夹到其他目录。

## 实现
- 前端 FileTree 组件增加 HTML5 drag & drop（draggable + onDragOver/onDrop）
- 目录节点和根区域作为 drop target，拖入时高亮反馈
- FilePanel 新增 handleMoveFile 回调，发送 `file:rename` DirectMessage
- 后端 FileHandler.rename() 已有完整实现，无需改动
- 文件树通过 FileWatcher 的 tree events 自动更新

## 验收结果
- 拖拽文件到目录可移动
- 拖拽文件夹到目录可移动
- 拖拽到根目录可移动
- 防止移动到自身或子目录
- 文件树实时更新（由 FileWatcher 驱动）
