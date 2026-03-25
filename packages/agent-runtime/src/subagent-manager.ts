/**
 * SubagentManager — 子 Agent 管理
 *
 * 支持从主 Agent 中派生独立的子 Agent：
 * - 独立 ToolRegistry（禁止 spawn 递归）
 * - 独立迭代限制（15 轮）
 * - 每 Session 最多 3 个并发子 Agent
 */

import type { WorkspaceDB } from './workspace-db.js';
import type { LLMProvider, LLMMessage, LLMToolDefinition } from './llm/types.js';
import type { ToolRegistry, Tool } from './tool-registry.js';
import { getProfileRegistry } from './llm/factory.js';
import { REVIEWING_PHASE_PROMPT } from './prompts/reviewing.js';

// ====== Types ======

export interface SubagentResult {
  content: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SubagentConfig {
  maxIterations?: number;
  maxConcurrent?: number;
}

/** 子 Agent 角色 — 不同角色用不同参数 */
export type AgentRole = 'coder' | 'reviewer' | 'explorer';

interface RoleProfile {
  temperature: number;
  maxTokens: number;
  systemPromptPrefix: string;
}

const ROLE_PROFILES: Record<AgentRole, RoleProfile> = {
  coder: {
    temperature: 0.1,
    maxTokens: 8192,
    systemPromptPrefix: '你是一个编码子 Agent。严格遵循规范，精确实现任务。',
  },
  reviewer: {
    temperature: 0.2,
    maxTokens: 4096,
    systemPromptPrefix: REVIEWING_PHASE_PROMPT,
  },
  explorer: {
    temperature: 0.3,
    maxTokens: 4096,
    systemPromptPrefix: '你是一个探索子 Agent。广泛搜索信息，分析可能的方案。',
  },
};

export interface ReviewResult {
  issues: string[];
  lgtm: boolean;
}

// ====== Constants ======

const DEFAULT_MAX_ITERATIONS = 15;
const DEFAULT_MAX_CONCURRENT = 3;

// ====== SubagentManager ======

export class SubagentManager {
  private activeCount = new Map<string, number>(); // sessionId → running count

  constructor(
    private db: WorkspaceDB,
    private provider: LLMProvider,
    private parentRegistry: ToolRegistry,
    private config: SubagentConfig = {},
  ) {}

  /** 派生子 Agent 执行任务 */
  async spawn(
    sessionId: string,
    task: string,
    label: string,
    role: AgentRole = 'coder',
  ): Promise<SubagentResult> {
    const maxConcurrent = this.config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const current = this.activeCount.get(sessionId) ?? 0;

    if (current >= maxConcurrent) {
      throw new Error(`子 Agent 并发上限 ${maxConcurrent}，当前 ${current} 个运行中`);
    }

    this.activeCount.set(sessionId, current + 1);

    try {
      return await this.runSubagent(sessionId, task, label, role);
    } finally {
      const count = this.activeCount.get(sessionId) ?? 1;
      if (count <= 1) {
        this.activeCount.delete(sessionId);
      } else {
        this.activeCount.set(sessionId, count - 1);
      }
    }
  }

  private async runSubagent(
    sessionId: string,
    task: string,
    label: string,
    role: AgentRole = 'coder',
  ): Promise<SubagentResult> {
    const iterLimit = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const roleProfile = ROLE_PROFILES[role];

    // 构建独立 ToolRegistry（复制父级工具，但排除 spawn）
    const childRegistry = new (this.parentRegistry.constructor as typeof ToolRegistry)();
    for (const def of this.parentRegistry.getDefinitions()) {
      if (def.name === 'spawn') continue; // 禁止递归
      const tool = this.parentRegistry.getTool(def.name);
      if (tool) childRegistry.register(tool);
    }

    // reviewer 角色不需要写入工具（只读审查）
    const llmTools: LLMToolDefinition[] = childRegistry.getDefinitions()
      .filter((t) => {
        if (role === 'reviewer') {
          return !['write', 'edit', 'bash'].includes(t.name);
        }
        return true;
      })
      .map((t) => ({
        name: t.name,
        description: t.description,
        schema: (t.schema as unknown as Record<string, unknown>) ?? { type: 'object', properties: {} },
      }));

    const systemPrompt = `${roleProfile.systemPromptPrefix}\n\n你是一个子 Agent（${label}）。完成任务后返回结果。不要发起新的子 Agent。`;
    const messages: LLMMessage[] = [
      { role: 'user', content: task },
    ];

    // 从 ModelProfile 获取子 Agent 推荐的模型参数
    const modelId = (this.provider as any).defaultModel ?? '';
    const registry = getProfileRegistry();
    const phaseParams = registry.getPhaseParams(modelId, role === 'reviewer' ? 'reviewing' : 'coding');

    let iteration = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let finalContent = '';

    while (iteration < iterLimit) {
      iteration++;

      const response = await this.provider.chat({
        model: modelId || 'claude-sonnet-4-20250514',
        systemPrompt,
        messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
        maxTokens: phaseParams.maxTokens,
        temperature: phaseParams.temperature,
      });

      totalInput += response.usage.inputTokens;
      totalOutput += response.usage.outputTokens;

      if (response.content) {
        finalContent = response.content;
        messages.push({ role: 'assistant', content: response.content });
      }

      if (response.toolCalls.length > 0) {
        if (!response.content) {
          messages.push({
            role: 'assistant',
            content: '',
            toolCalls: response.toolCalls,
          });
        }

        for (const call of response.toolCalls) {
          const result = await childRegistry.execute(call.name, call.input as Record<string, unknown>);
          messages.push({
            role: 'tool',
            content: result,
            toolResults: [{ toolCallId: call.id, output: result }],
          });
        }
      } else {
        break;
      }
    }

    return {
      content: finalContent,
      iterations: iteration,
      inputTokens: totalInput,
      outputTokens: totalOutput,
    };
  }

  /** 获取某 session 当前活跃子 Agent 数 */
  getActiveCount(sessionId: string): number {
    return this.activeCount.get(sessionId) ?? 0;
  }

  /**
   * 代码审查 — 用 Reviewer Agent 检查代码改动。
   *
   * 传入 diff 文本，返回审查结果。
   * 无问题时 lgtm=true，有问题时 issues 列出问题。
   */
  async review(sessionId: string, diff: string, context?: string): Promise<ReviewResult> {
    const reviewPrompt = [
      '请审查以下代码改动：',
      '',
      '```diff',
      diff,
      '```',
      context ? `\n背景信息：${context}` : '',
      '',
      '如果没有问题，只回复 "LGTM"。否则列出每个问题（编号列表）。',
    ].join('\n');

    const result = await this.spawn(sessionId, reviewPrompt, 'reviewer', 'reviewer');
    return parseReviewResult(result.content);
  }
}

/** 解析 Reviewer Agent 的输出 */
function parseReviewResult(content: string): ReviewResult {
  const normalized = content.trim();

  // LGTM 判断
  if (/^lgtm/i.test(normalized) || normalized.length < 20) {
    return { issues: [], lgtm: true };
  }

  // 提取编号列表中的问题
  const issues: string[] = [];
  const lines = normalized.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s*(.+)/);
    if (match) {
      issues.push(match[1].trim());
    }
  }

  // 如果没提取到编号列表，把整段内容作为一个 issue
  if (issues.length === 0 && normalized.length > 20) {
    issues.push(normalized.slice(0, 500));
  }

  return { issues, lgtm: issues.length === 0 };
}
