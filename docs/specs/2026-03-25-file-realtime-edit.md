## 技术方案：文件实时编辑

### 1. 背景与目标

- **为什么做**：当前 FilePreview 只读展示（`<pre>`），用户无法在 Web 端直接编辑文件，需切到终端用 vim/nano，体验割裂
- **解决什么**：在文件预览区直接编辑并保存，编辑后通过 DirectWs 发 `file:write`，实时生效
- **验收标准**：
  1. 点击文件后可切换到编辑模式
  2. 编辑内容通过防抖自动保存（500ms 无输入后触发）
  3. 保存状态可见（保存中 / 已保存 / 保存失败）
  4. 外部修改时提示冲突
  5. 二进制文件禁止编辑
- **不做**：
  - 多人协同编辑 / 编辑锁（当前单用户场景）
  - Monaco / CodeMirror 集成（MVP 用 textarea，后续迭代）
  - 大文件分块加载（限制 ≤1MB 可编辑）

### 2. 现状分析

**已就绪**：
- Runner `FileHandler.write(path, content)` — 完整实现，含路径校验、写入、返回 mtime
- DirectMessage 协议 — `FileWriteData { path, content }` / `FileWriteResult { success, path, size, mtime }` 已定义
- DirectServer `file:write` 路由 — 已在 `handleDirectMessage` 中实现
- FileWatcher — 文件修改事件广播已接通

**需改造**：
- `FilePreview` 组件 — 当前纯 `<pre>` 展示，无编辑能力
- `file-tree` store — 缺少编辑状态字段（editing / dirty / saving）
- `useDirectConnection` — 未处理 `write_result` / `error` 响应
- `FilePanel` — 需传递 `onSendDirectMessage` 给 FilePreview

### 3. 方案设计

**整体思路**：FilePreview 切换为编辑模式时显示 `<textarea>`，用户输入后防抖 500ms 自动通过 DirectWs 发 `file:write`，保存结果通过 `write_result` 回写 store，UI 展示保存状态。

**改动点**：

#### 3.1 Store 扩展（`packages/web/src/stores/file-tree.ts`）

新增字段：
```typescript
previewEditing: boolean;        // 是否处于编辑模式
previewDirty: boolean;          // 有未保存的修改
previewSaving: boolean;         // 保存中
previewSaveError: string | null; // 保存错误信息
```

新增 action：
```typescript
setPreviewEditing(editing: boolean): void;
setPreviewSaving(saving: boolean): void;
setPreviewSaveResult(error?: string): void;  // saving=false, 设置 error
```

行为约束：
- 切换文件时自动退出编辑模式（`setPreview` 中重置编辑状态）
- 二进制文件不允许进入编辑模式

#### 3.2 useDirectConnection 消息处理

在 `msg.channel === 'file'` 分支新增：
```typescript
else if (msg.action === 'write_result') {
  s.setPreviewSaving(false);
  // 更新 previewContent 为最新保存内容，避免编辑态和展示态不一致
}
else if (msg.action === 'error' && msg.requestId) {
  s.setPreviewSaveResult(msg.data.message);
}
```

#### 3.3 FilePreview 组件改造

当前结构：头部（文件名 + 重载按钮）+ `<pre>` 内容区

改造后：
- 头部增加「编辑 / 预览」切换按钮 + 保存状态指示
- 编辑模式：`<textarea>` 替代 `<pre>`，等宽字体，保持代码风格
- 防抖保存：`useRef` + `setTimeout` 实现 500ms debounce
- 保存状态：右上角小标签（保存中... / 已保存 / 保存失败）

```
┌─────────────────────────────────────┐
│ src/main.ts          [编辑] [重载]  │  ← 头部
│                         ● 已保存    │  ← 保存状态
├─────────────────────────────────────┤
│                                     │
│  <textarea> 或 <pre>                │  ← 内容区
│                                     │
└─────────────────────────────────────┘
```

#### 3.4 冲突检测

FileWatcher 已广播文件修改事件到前端（`tree:events`）。在 `useDirectConnection` 中：
- 收到 `modified` 事件且 path === 当前编辑文件 → store 设置 `previewChanged = true`
- FilePreview 检测到 `previewChanged && previewEditing` → 显示黄色提示条：「文件已被外部修改，是否重新加载？」

#### 3.5 数据流

```
用户输入 → textarea onChange → 本地 state 更新
  → 防抖 500ms → sendDirectMessage({ channel: 'file', action: 'write', data: { path, content } })
  → store: previewSaving = true
  → Runner FileHandler.write() → 磁盘写入
  → write_result 回传 → store: previewSaving = false
  → UI 显示「已保存」
```

### 4. 实施计划

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 1 | Store 扩展编辑状态字段 | `stores/file-tree.ts` |
| 2 | useDirectConnection 处理 write_result | `hooks/useDirectConnection.ts` |
| 3 | FilePreview 改造为可编辑 | `components/workspace/FilePreview.tsx` |
| 4 | FilePanel 传递 onSendDirectMessage | `components/workspace/FilePanel.tsx` |

### 5. 风险与边界

- **大文件性能**：textarea 编辑 >1MB 文件会卡 → 前端限制可编辑文件大小，超出只读
- **防抖期间切文件**：debounce 未触发就切了文件 → cleanup 中 flush 最后一次保存
- **保存失败**：网络断开或权限问题 → 显示错误提示，内容不丢（保留在 textarea 中）
- **外部修改覆盖**：编辑中文件被 Agent/终端修改 → 冲突提示条，用户选择重载或继续编辑
