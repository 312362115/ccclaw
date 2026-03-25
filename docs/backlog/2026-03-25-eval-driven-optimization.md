---
priority: P0
status: open
spec: docs/specs/2026-03-25-agent-engineering-boost.md
---

# 评测驱动优化：接入真实 Agent 跑数据，用数据指导迭代

## 背景

Agent 工程层提升（11 项）和生态兼容（8 项）的代码已全部完成，但大部分改进**没有经过真实 Agent + LLM 的端到端验证**。当前的"效果"是基于代码差异的主观判断，不是数据。

### 当前差距估算（主观，待数据验证）

```
CC + Opus 4.6:           ████████████████████ 100
CC + Sonnet 4.6:         ██████████████░░░░░░  70
CCCLaw + Opus 4.6:       ████████████░░░░░░░░  60   ← 框架差距约 40 分
CCCLaw + Qwen3-Coder:    ████████░░░░░░░░░░░░  40   ← 框架+模型双重差距
```

### CCCLaw + Opus vs CC + Opus（60 vs 100）的框架差距

| 差距 | 根因 |
|------|------|
| Prompt 工程积累 | CC 的 prompt 经过百万用户打磨，我们的基础 prompt 还没经过实战迭代 |
| 并行工具调用 | CC 能让 Opus 一轮并行 5+ 工具，我们 agent.ts 还是串行执行 |
| Context 管理精度 | CC 的压缩摘要质量高，我们的相关性评分是新写的还没验证 |
| 错误恢复链路 | CC 出错后的自我纠正成熟，我们的反馈 prompt 还很粗 |
| 生态打磨 | MCP/Skill 刚通链路没经过实际使用 |

### CCCLaw + Qwen vs CC + Sonnet（40 vs 70）

| 维度 | CC + Sonnet | CCCLaw + Qwen | 差距原因 |
|------|-------------|---------------|---------|
| 简单任务 | ~90% | ~70% | Qwen 工具调用偶尔格式错 |
| 中等任务 | ~75% | ~45% | Qwen 3-5 步后跑偏 |
| 复杂任务 | ~50% | ~15% | Qwen 多步推理弱（模型硬伤） |

### 已写完但未验证的能力

| 能力 | 验证状态 | 风险 |
|------|---------|------|
| Auto Plan 拆解 | ❌ 没接真实 LLM | 不确定 Qwen 能输出合格 JSON Plan |
| 分阶段 Prompt | ❌ 没对比效果 | 不知道对 Qwen 提升多少 |
| Reviewer Agent | ❌ 没跑过 | Qwen 做 review 质量未知 |
| CodeIndex 注入 | ⚠️ 索引可用但没集成到实际 context 注入 | 可能注入了但模型不会用 |
| 评测 runner | ❌ 框架有但没接 Agent 调用 | 核心缺失 |

## 待办

### 第一步：评测 runner 接入真实 Agent（P0，3-5 天）

- 在 `tests/eval/runner.ts` 中实现 `runAgentOnTask()`——启动 runtime，发送需求，等 Agent 完成
- 支持指定 Provider + Model（CC+Sonnet / CCCLaw+Qwen / CCCLaw+Opus）
- 跑完 4 个示例用例，出第一份基线报告

### 第二步：扩充评测用例到 20-30 题（P1，2-3 天）

- 从 CCCLaw 自身 git log 提取真实改动作为 simple 题
- 设计 medium 跨文件功能题
- 设计 complex 新模块题

### 第三步：A/B 对比优化（P1，持续）

- 关闭/开启各工程优化项，对比评测数据
- 数据显示提升大的打磨，提升小的简化
- 重点关注：Write-Verify-Fix 对 Qwen 的提升、Auto Plan 对复杂任务的提升、分阶段 Prompt 对工具调用准确率的提升

### 第四步：并行工具调用（P1，2-3 天）

- agent.ts 迭代循环支持并行执行（当 ModelProfile.parallelToolCalls=true 时）
- 这对 Opus 提升最大（一轮做 5 件事 vs 串行 5 轮）

### 第五步：Prompt 迭代（P1，持续）

- 基于评测失败用例分析 prompt 薄弱环节
- 针对性优化工具描述、system prompt
- 每次改动后重跑评测验证

## 验收标准

- 评测 runner 能自动跑全量用例并出对比报告
- 有 CC+Sonnet 基线数据
- 每次优化后的数据趋势可追踪
- CCCLaw+Qwen 在简单任务上一次成功率 ≥ 80%
