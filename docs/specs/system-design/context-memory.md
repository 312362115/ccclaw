# 上下文组装与记忆沉淀

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## Session 与渠道关系

同一工作区可通过不同渠道（WebUI、Telegram 等）发起独立的 Session。各 Session 共享工作区的记忆（memories）、技能（skills）、MCP Server 配置，但会话历史（messages）相互独立。

```
工作区 A
├── 用户偏好（主数据库）            ← 所有渠道 Session 共享
├── workspace.db（工作区目录）      ← Runner 本地读写
│   ├── memories                   ← 所有 Session 共享的知识积累
│   ├── Session 1（WebUI）         ← 独立的 messages 历史
│   ├── Session 2（Telegram）      ← 独立的 messages 历史
│   └── Session 3（WebUI）         ← 独立的 messages 历史
├── skills（共享）
└── MCP servers（共享）
```

## 上下文组装顺序

每次 Agent 调用时，按以下顺序组装上下文：

```
1. Bootstrap 文件    ← home/ 目录下的 AGENTS.md / SOUL.md / USER.md / TOOLS.md（Runner 启动时加载）
2. 用户偏好          ← 主数据库 user_preferences 表（Server 读取，传给 Runner）
3. 工作区记忆（分级） ← workspace.db memories 表（Runner 本地读取）
   A. 必注入层：decision + feedback → 全文内联（行为约束，Agent 必须始终知道）
   B. 索引层：project + reference → 仅注入 name + type 摘要列表，Agent 按需 memory_read
   C. 搜索层：log → 不主动注入，仅向量/关键词搜索命中时带入
4. 用户级 skills + 工作区级 skills（同名覆盖）→ 渐进加载
   - always: true → 全文内联
   - 其他 → XML 摘要，Agent 按需 read_file
5. 内置工具 schema   ← ToolRegistry 注册的工具 JSON Schema
6. MCP 工具 schema   ← 懒连接 MCP 子进程后注入的外部工具定义
7. session 历史      ← workspace.db messages 表，取 messages[lastConsolidated:] 未整合尾部
→ 组装为 Agent 的 system prompt + conversation history
```

**记忆分级加载注入示例**：

```
## 行为约束（全文注入，decision + feedback）
[decision] 选择 WebSocket 而非 SSE，因为需要双向通信
[feedback] 这个项目不要 mock 数据库测试

## 工作区知识（索引注入，按需 memory_read 读取详情）
<memories count="12">
  <memory name="tech-stack" type="project">Next.js 14 + Drizzle ORM 技术栈</memory>
  <memory name="linear-bugs" type="reference">Bug 追踪在 Linear INGEST</memory>
  ...
  使用 memory_read 工具按名称读取完整内容
</memories>

## 相关日志（搜索命中时注入）
[log] 2026-03-16: 修复了 auth 模块 token 过期 bug，改了 middleware.ts 和 jwt.ts
```

**必注入层超长压缩**：

当 decision + feedback 总 token 超过阈值（默认 4000 tokens）时：
1. 调用 LLM 将同类记忆合并为精简摘要
2. 原始记忆保留不删（审计可追溯），标记 `compressed: true`
3. 后续注入使用压缩版，原始版可通过 memory_read 按需读取

**压缩失败降级**：

如果 LLM 压缩调用失败（Provider 不可用、返回空内容等）：
1. 第一次失败：重试 1 次
2. 再次失败：按 `updatedAt` 倒序保留最近的 decision + feedback 条目，截断到 4000 tokens 以内
3. 被截断的记忆不删除，仍可通过 `memory_read` 按需读取
4. 在下一次成功的 LLM 调用中重新尝试压缩

## Token 驱动的上下文整合（借鉴 nanobot）

> 原设计使用固定 20 条消息阈值触发摘要，但工具调用的消息可能很长（单条超万 token），导致 20 条远超上下文窗口。改为按 token 数量驱动整合，更精准也更安全。

**整合机制**：

```
每次消息处理后：
  estimatedTokens = estimateSessionTokens(session)    // 估算当前 prompt 总 token 数

  if estimatedTokens > contextWindowTokens * 0.5:     // 超过上下文窗口的 50% 触发整合
    while estimatedTokens > targetTokens:
      // 1. 找到安全的整合边界（对齐到用户轮次起点，不拆分工具调用链）
      boundary = pickConsolidationBoundary(session, tokensToRemove)

      // 2. 取出待整合的消息块
      chunk = messages[session.lastConsolidated : boundary]

      // 3. LLM 压缩为记忆摘要，写入 memories 表
      success = await consolidateMessages(chunk)

      // 4. 成功后更新偏移量
      if success:
        session.lastConsolidated = boundary
        saveSession(session)

      estimatedTokens = estimateSessionTokens(session)
```

**关键阈值**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 触发阈值 | `contextWindowTokens * 0.5` | 超过上下文窗口 50% 时开始整合 |
| 目标水位 | `contextWindowTokens * 0.3` | 整合到 30%，留 20% 余量给新对话 |
| 必注入层压缩阈值 | 4000 tokens | decision + feedback 总量超过此值触发 LLM 压缩 |
| 索引层最大条数 | 50 条 | project + reference 摘要列表上限，超出按 updatedAt 倒序截断 |
| memory_search 默认 K | 5 条 | 向量/关键词搜索返回的最大条数 |
| memory_search 最低相似度 | 0.7（cosine） | 低于此分的结果不返回；关键词模式要求至少一个词命中 |

**整合边界选择算法**：

```typescript
function pickConsolidationBoundary(
  messages: Message[],
  startOffset: number,
  tokensToRemove: number
): number {
  let accumulated = 0;
  let boundary = startOffset;

  // 按"用户轮次组"遍历：一个用户消息 + 后续所有 assistant/tool 消息，直到下一个用户消息
  for (const group of groupByUserTurn(messages, startOffset)) {
    const groupTokens = group.reduce((sum, m) => sum + estimateTokens(m), 0);
    accumulated += groupTokens;
    boundary = group[group.length - 1].index + 1;  // 组的下一条消息位置

    if (accumulated >= tokensToRemove) break;
  }

  return boundary;
}

// 分组规则：
// - 以 role='user' 消息为组的起点
// - 组包含该 user 消息 + 后续连续的 assistant、tool_result 消息
// - 遇到下一个 user 消息时开始新组
// - 永远不在 tool_use 和 tool_result 之间切割（保持工具调用链完整）
```

**三级降级策略**：
1. 调用 LLM 整合，使用 `tool_choice: forced`（强制调用 `save_memory` 工具写入记忆）
2. 若 Provider 不支持 `tool_choice`，降级为 `tool_choice: auto`
3. 连续 3 次失败，降级为原始归档（直接将消息原文追加到 `log` 类型记忆，不丢数据）

**整合 LLM Prompt 模板**：

```text
你是一个对话记忆整合助手。请阅读以下对话片段，提取其中值得长期记住的信息，调用 save_memory 工具保存。

规则：
1. 保留：技术决策、架构变更、文件路径、操作结果、用户反馈、重要发现
2. 丢弃：寒暄、已被纠正的错误尝试、重复信息、格式化输出的原始数据
3. 每条记忆用一个 save_memory 调用，选择合适的 type（project/reference/decision/feedback/log）
4. name 字段用简短英文标识（如 "auth-jwt-decision"、"db-migration-fix"）
5. content 用中文或英文均可，保持简洁但信息完整

对话片段：
---
{messages_chunk}
---
```

工具定义（强制调用）：
```json
{
  "name": "save_memory",
  "description": "保存一条记忆到工作区",
  "parameters": {
    "name": { "type": "string" },
    "type": { "type": "string", "enum": ["project", "reference", "decision", "feedback", "log"] },
    "content": { "type": "string" }
  }
}
```

**Token 估算**：使用 tiktoken 或简单按字符数估算（1 token ≈ 4 chars），无需精确 — 整合触发阈值留有余量。

**好处**：
- 避免固定条数的不精确性（工具调用消息 token 差异巨大）
- Append-Only 设计保证消息不丢失，审计可追溯
- `lastConsolidated` 偏移量使 LLM 请求前缀稳定，提高 prompt cache 命中率

## 记忆沉淀机制

跨 Session 的上下文连续性通过工作区记忆（workspace.db memories 表）实现。Agent 在 Runner 侧直接读写 SQLite，拥有 `memory_write` / `memory_read` / `memory_search` 工具。写入策略由 system prompt 引导，交给 Agent 自主判断。用户可通过 UI 查看、编辑、删除记忆。

**system prompt 注入指令**：

```
"你拥有工作区记忆管理能力（memory_write / memory_read / memory_search 工具）。
写入时机由你自主判断，以下是参考：
 - 用户明确说"记住…"、"以后都…"
 - 用户纠正你在这个工作区中的行为 → feedback
 - 对话中产生的项目决策、架构约定 → decision
 - 完成关键操作后记录工作日志 → log（异步写入，记录做了什么、改了哪些文件、结果如何）
 - 不确定时宁可不写，用户可以手动管理记忆
记忆类型：project | reference | decision | feedback | log
log 类型可高频写入，用于跨 Session 保持任务进展连续性。
同名记忆自动更新（log 除外，log 每次新建）。"
```

**内置工具定义**（Runner 侧直接操作 workspace.db）：

```
memory_write：
  参数：{ name: string, type: 'project' | 'reference' | 'decision' | 'feedback' | 'log', content: string }
  行为：写入当前工作区 workspace.db，有 embedding 模型时同时生成向量
  权限：Agent 运行时自动可用，无需用户确认

memory_read：
  参数：{ name?: string }
  行为：按名称读取指定记忆，或不传 name 返回全部记忆列表（name + type 摘要）
  权限：Agent 运行时自动可用

memory_search：
  参数：{ query: string, limit?: number }
  行为：按语义相似度搜索记忆（需 embedding 支持），返回最相关的 top-K 条
  降级：未配置 embedding 模型时，退化为全文关键词匹配
  权限：Agent 运行时自动可用
```

**Embedding 生成策略**：

- 时机：`memory_write` 同步写入文本，异步生成 embedding（不阻塞对话）
- 失败处理：embedding 生成失败时记忆仍然保存（无向量），退化为关键词搜索
- 补填：首次启用 embedding 模型时，提供 `backfill_embeddings()` 方法批量补填已有记忆的向量
- 维度：默认 384（bge-small-zh-v1.5），`PRAGMA` 中记录维度值，模型变更时需重建向量

**Session 归档总结**：Session 状态变为 `archived` 时：
1. 所有 messages 发送给 LLM 生成摘要，存入 `sessions.summary`（供历史查看）
2. 不再额外提取记忆 — 依赖 Agent 在对话过程中已主动沉淀

**长会话分块摘要**：

当 session 消息总 token 超过模型上下文窗口的 80% 时，采用分块摘要：

```
1. 将消息按时间顺序分为 N 个 chunk（每 chunk ≤ contextWindowTokens * 0.6）
2. 逐 chunk 调用 LLM 生成段落摘要
3. 将所有段落摘要拼接，再调用 LLM 生成最终全量摘要
4. 最终摘要写入 sessions.summary
```

如果摘要生成失败：标记 `summary = '[摘要生成失败]'`，保留消息原文可追溯。
