# 技术方案：前端适配 Agent 新能力

## 1. 背景与目标

agent-runtime 新增了工具结果结构化输出、Plan 模式、多模态消息、Hook 系统等能力，前端需要同步适配。

- **验收标准**：4 个子功能全部可用
- **设计原则**：工具调用默认降噪（极简日志行），细节按需展开，参考 Claude Code 风格
- **不做**：语法高亮主题自定义、图片编辑裁剪、Plan 历史管理

## 2. 现状分析

- `ChatMessage.tsx`：5 种 role 分别渲染，tool 消息用卡片式展示（当前过重）
- `chat.ts` store：tool 消息作为独立消息 push 到列表，导致每个工具调用占一行消息
- `ChatComposer.tsx`：纯文本输入，回形针按钮无功能
- `ChatMain.tsx`：streaming bubble 独立渲染，不包含工具调用
- `ChatHeader.tsx`：状态点只有 idle/thinking/typing，无 plan 模式

## 3. UI 设计

原型文件：`docs/prototypes/frontend-agent-adaptation-prototype.html`

### 工具调用（极简日志行）
- 工具行：`12px 灰色文字`，格式 `图标 工具名 摘要 状态`
- 默认折叠，成功不展开，失败自动展开
- 展开区域缩进到图标后，极淡背景
- Edit 用 diff 视图（红删绿增），Bash 用深色终端背景

### Plan 模式
- ChatHeader 显示紫色「📋 计划模式」徽章
- Plan 内容用浅灰圆角区块，Markdown 渲染
- 底部「执行计划」+「重新规划」按钮

### 图片上传
- Composer 新增蓝色图片按钮
- 支持点击选图 / 粘贴(Ctrl+V) / 拖拽
- 输入框上方显示缩略图行，带删除按钮
- 消息中图片以圆角卡片展示（max-width 300px）

### Hook 输出
- 作为工具展开详情中的附加区块
- 黄色背景，`🪝 Hook:` 前缀

## 4. 方案设计

### 核心重构：消息模型改造

当前每个 tool_use 创建独立消息，改为 **同一 AI 回合内的工具调用合并到一个消息中**：

```typescript
// ChatMessage 新增字段
interface ChatMessage {
  // ...existing
  toolCalls?: ToolCallInfo[];  // 一个 AI 消息可包含多个工具调用
  images?: ImageInfo[];         // 消息附带的图片
  planMode?: boolean;           // 是否为 Plan 模式输出
}

interface ToolCallInfo {
  id: string;
  name: string;
  summary: string;       // 一行摘要
  input?: string;        // 工具输入（JSON）
  output?: string;       // 工具输出
  hookOutput?: string;   // Hook 输出
  status: 'running' | 'success' | 'error';
  expanded: boolean;     // 是否展开
}

interface ImageInfo {
  data: string;          // base64
  mediaType: string;
  thumbnail?: string;    // 缩略图 data URL
}
```

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `stores/chat.ts` | 消息模型改造，工具调用合并到 AI 消息，图片状态管理，plan 模式状态 |
| `pages/chat/ChatMessage.tsx` | 重写 tool 渲染（日志行+折叠详情），图片渲染，plan 模式渲染 |
| `pages/chat/ChatComposer.tsx` | 图片上传（按钮/粘贴/拖拽），缩略图预览 |
| `pages/chat/ChatMain.tsx` | plan 模式下的执行/重新规划按钮 |
| `pages/chat/ChatHeader.tsx` | plan 模式徽章 |
| `hooks/useDirectConnection.ts` | 适配新消息模型 |

## 5. 实施计划

按依赖顺序分 4 步：

### Step 1：消息模型 + Store 重构
- chat.ts: 新增 ToolCallInfo/ImageInfo 类型
- 工具事件处理改造：tool_use_start 不再 push 新消息，而是往当前 AI 消息的 toolCalls 数组追加
- plan_mode 事件处理：记录 planMode 状态
- 图片状态管理：pendingImages 数组

### Step 2：工具展示重写
- ChatMessage.tsx: 重写 tool 渲染为极简日志行
- 折叠/展开逻辑
- Edit diff 视图、Bash 终端风格、Hook 输出区块
- 摘要提取逻辑（从工具输出中提取关键信息）

### Step 3：Plan 模式 UI
- ChatHeader.tsx: plan 模式徽章
- ChatMessage.tsx: plan 内容区块样式
- ChatMain.tsx: 执行/重新规划按钮

### Step 4：图片上传
- ChatComposer.tsx: 图片按钮 + 粘贴 + 拖拽 + 缩略图预览
- chat.ts: 发送时附带 ContentBlock[]
- ChatMessage.tsx: 消息中图片渲染

## 6. 风险与边界

- **消息模型迁移**：已加载的旧格式消息需要兼容（role='tool' 的独立消息仍能渲染）
- **工具摘要提取**：不同工具输出格式不一，需要容错处理
- **图片大小限制**：base64 编码后体积翻倍，需限制单图 5MB、总量 20MB
- **不做**：图片压缩、格式转换、多图拼接
