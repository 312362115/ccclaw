/**
 * Planner — 任务拆解引擎
 *
 * 核心思路：弱模型做不了 10 步的任务，但能做好 1-2 步的任务。
 * 把大任务自动拆成小步，逐步执行。
 *
 * 流程：
 * 1. shouldPlan() — 判断是否需要 Plan（基于消息长度 + 关键词）
 * 2. generatePlan() — 用专门的 planning prompt 生成结构化计划（JSON）
 * 3. buildStepContext() — 为每步构建精简 context（步骤描述 + 前序摘要）
 *
 * 与现有 Plan 模式的关系：
 * - 用户 /plan → intent.ts 分类 → agent.ts 用 PLANNING_SYSTEM_PROMPT 生成计划文本展示给用户
 * - plan_execute → agent.ts 调用 Planner 解析计划并逐步执行
 * - 自动判断 → Planner.shouldPlan() → 复杂任务自动进入 plan-then-execute
 */

import type { LLMProvider, ChatParams, ChatResponse } from './llm/types.js';
import { PLANNING_SYSTEM_PROMPT, buildStepExecutionSuffix } from './prompts/planning.js';
import { getProfileRegistry } from './llm/factory.js';
import { logger } from './logger.js';

// ====== Types ======

export interface PlanStep {
  step: number;
  description: string;
  files: string[];
  action: 'create' | 'modify' | 'delete' | 'verify';
  detail: string;
  dependsOn: number[];
}

export interface Plan {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  steps: PlanStep[];
}

export interface StepResult {
  stepIndex: number;
  success: boolean;
  summary: string;
}

// ====== 复杂度判断 ======

/** 判断用户消息是否暗示复杂任务（需要自动 Plan） */
const COMPLEXITY_KEYWORDS = [
  '实现', '开发', '新增', '重构', '迁移', '设计', '搭建',
  '系统', '模块', '架构', '全面', '完整',
  'implement', 'develop', 'refactor', 'migrate', 'design', 'build',
  'system', 'module', 'architecture',
];

const SIMPLE_KEYWORDS = [
  '改一下', '修一下', '加个', '删掉', '修复', '更新',
  'fix', 'update', 'change', 'remove', 'add a',
];

/**
 * 判断是否需要自动 Plan。
 *
 * 规则：
 * - 消息长度 > 150 字 + 包含复杂度关键词 → 需要
 * - 消息包含多个文件/模块提及 → 需要
 * - 消息包含简单关键词且长度短 → 不需要
 * - ModelProfile.executionStrategy.benefitsFromAutoPlan = false → 不需要
 */
export function shouldPlan(message: string, modelId?: string): boolean {
  // 检查模型是否受益于自动 Plan
  if (modelId) {
    const profile = getProfileRegistry().resolve(modelId);
    if (!profile.executionStrategy.benefitsFromAutoPlan) {
      return false;
    }
  }

  const normalized = message.toLowerCase();

  // 短消息 + 简单关键词 → 不需要
  if (message.length < 30) {
    if (SIMPLE_KEYWORDS.some(k => normalized.includes(k))) return false;
  }

  // 中长消息 + 复杂度关键词 → 需要（中文消息字符数少但信息密度高，阈值低一些）
  if (message.length > 40) {
    if (COMPLEXITY_KEYWORDS.some(k => normalized.includes(k))) return true;
  }

  // 提及多个文件 → 需要
  const filePatterns = normalized.match(/[\w/-]+\.\w{1,4}/g) || [];
  if (filePatterns.length >= 3) return true;

  // 有编号列表（用户已经在拆步骤）→ 需要
  const numberedItems = message.match(/^\s*\d+[\.\)]/gm) || [];
  if (numberedItems.length >= 3) return true;

  return false;
}

// ====== Plan 解析 ======

/**
 * 从 LLM 输出中解析 Plan JSON。
 *
 * 容错策略：
 * 1. 直接 JSON.parse
 * 2. 提取 ```json ... ``` 代码块
 * 3. 提取首个 { ... } 块
 * 4. 全部失败 → 返回 null
 */
export function parsePlan(text: string): Plan | null {
  // 策略 1：直接解析
  try {
    const plan = JSON.parse(text);
    if (isValidPlan(plan)) return plan;
  } catch { /* continue */ }

  // 策略 2：提取 json 代码块
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const plan = JSON.parse(jsonBlockMatch[1].trim());
      if (isValidPlan(plan)) return plan;
    } catch { /* continue */ }
  }

  // 策略 3：提取首个 JSON 对象
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const plan = JSON.parse(text.substring(braceStart, braceEnd + 1));
      if (isValidPlan(plan)) return plan;
    } catch { /* continue */ }
  }

  return null;
}

function isValidPlan(obj: unknown): obj is Plan {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.summary === 'string' &&
    Array.isArray(p.steps) &&
    p.steps.length > 0 &&
    p.steps.every((s: unknown) => {
      if (!s || typeof s !== 'object') return false;
      const step = s as Record<string, unknown>;
      return typeof step.step === 'number' && typeof step.description === 'string';
    })
  );
}

// ====== Plan 生成 ======

/**
 * 调用 LLM 生成结构化计划。
 *
 * 使用专门的 planning prompt，不带工具定义（降低干扰）。
 * 如果模型支持 jsonMode，启用强制 JSON 输出。
 */
export async function generatePlan(
  provider: LLMProvider,
  userMessage: string,
  projectContext?: string,
): Promise<Plan | null> {
  const modelId = (provider as any).defaultModel ?? '';
  const registry = getProfileRegistry();
  const profile = registry.resolve(modelId);
  const params = registry.getPhaseParams(modelId, 'planning');

  let systemPrompt = PLANNING_SYSTEM_PROMPT;
  if (projectContext) {
    systemPrompt += `\n\n## 项目上下文\n${projectContext}`;
  }

  const chatParams: ChatParams = {
    model: modelId || 'default',
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
  };

  // 支持 JSON mode 的模型，强制 JSON 输出
  if (profile.capabilities.jsonMode) {
    chatParams.responseFormat = { type: 'json_object' };
  }

  try {
    const response: ChatResponse = await provider.chat(chatParams);
    const plan = parsePlan(response.content);

    if (!plan) {
      logger.warn({ content: response.content.slice(0, 200) }, 'Plan 解析失败');
      return null;
    }

    // 补全缺失字段
    for (const step of plan.steps) {
      if (!step.files) step.files = [];
      if (!step.dependsOn) step.dependsOn = [];
      if (!step.action) step.action = 'modify';
    }

    if (!plan.complexity) plan.complexity = 'medium';

    logger.info({ steps: plan.steps.length, complexity: plan.complexity }, 'Plan 生成成功');
    return plan;
  } catch (err) {
    logger.error({ err }, 'Plan 生成失败');
    return null;
  }
}

// ====== 步骤 Context 构建 ======

/**
 * 为 Plan 的第 N 步构建精简的 system prompt 后缀。
 *
 * 只包含：方案概述 + 前序步骤摘要 + 当前步骤详情。
 * 不带完整对话历史（由 Agent 循环自然管理）。
 */
export function buildStepContext(
  plan: Plan,
  stepIndex: number,
  prevResults: StepResult[],
): string {
  const step = plan.steps[stepIndex];
  if (!step) return '';

  const prevSummaries = prevResults.map(r => r.summary);

  return buildStepExecutionSuffix(
    plan.summary,
    step.step,
    plan.steps.length,
    step.detail || step.description,
    prevSummaries,
  );
}

/**
 * 格式化 Plan 为可读文本（用于展示给用户确认）。
 */
export function formatPlanForDisplay(plan: Plan): string {
  const lines = [
    `## 执行计划`,
    ``,
    `**方案**：${plan.summary}`,
    `**复杂度**：${plan.complexity}`,
    `**步骤数**：${plan.steps.length}`,
    ``,
  ];

  for (const step of plan.steps) {
    const deps = step.dependsOn.length > 0
      ? `（依赖步骤 ${step.dependsOn.join(', ')}）`
      : '';
    lines.push(`### 步骤 ${step.step}: ${step.description} ${deps}`);
    lines.push(`- **操作**：${step.action}`);
    if (step.files.length > 0) {
      lines.push(`- **文件**：${step.files.join(', ')}`);
    }
    lines.push(`- **详情**：${step.detail}`);
    lines.push('');
  }

  return lines.join('\n');
}
