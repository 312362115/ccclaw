/**
 * SubagentManager — 子 Agent 管理
 *
 * 支持从主 Agent 中派生独立的子 Agent：
 * - 独立 ToolRegistry（禁止 spawn 递归）
 * - 独立迭代限制（15 轮）
 * - 每 Session 最多 3 个并发子 Agent
 */

import type { WorkspaceDB } from './workspace-db.js';
import type { LLMClient, LLMMessage, LLMToolDefinition } from './llm-client.js';
import type { ToolRegistry, Tool } from './tool-registry.js';

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

// ====== Constants ======

const DEFAULT_MAX_ITERATIONS = 15;
const DEFAULT_MAX_CONCURRENT = 3;

// ====== SubagentManager ======

export class SubagentManager {
  private activeCount = new Map<string, number>(); // sessionId → running count

  constructor(
    private db: WorkspaceDB,
    private llmClient: LLMClient,
    private parentRegistry: ToolRegistry,
    private config: SubagentConfig = {},
  ) {}

  /** 派生子 Agent 执行任务 */
  async spawn(
    sessionId: string,
    task: string,
    label: string,
  ): Promise<SubagentResult> {
    const maxConcurrent = this.config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    const current = this.activeCount.get(sessionId) ?? 0;

    if (current >= maxConcurrent) {
      throw new Error(`子 Agent 并发上限 ${maxConcurrent}，当前 ${current} 个运行中`);
    }

    this.activeCount.set(sessionId, current + 1);

    try {
      return await this.runSubagent(sessionId, task, label);
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
  ): Promise<SubagentResult> {
    const iterLimit = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    // 构建独立 ToolRegistry（复制父级工具，但排除 spawn）
    const childRegistry = new (this.parentRegistry.constructor as typeof ToolRegistry)();
    for (const def of this.parentRegistry.getDefinitions()) {
      if (def.name === 'spawn') continue; // 禁止递归
      const tool = this.parentRegistry.getTool(def.name);
      if (tool) childRegistry.register(tool);
    }

    // 工具定义
    const llmTools: LLMToolDefinition[] = childRegistry.getDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema ? (t.schema as unknown as Record<string, unknown>) : undefined,
    }));

    const systemPrompt = `你是一个子 Agent（${label}）。你的任务是完成以下工作后返回结果。不要发起新的子 Agent。`;
    const messages: LLMMessage[] = [
      { role: 'user', content: task },
    ];

    let iteration = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let finalContent = '';

    while (iteration < iterLimit) {
      iteration++;

      const response = await this.llmClient.call({
        systemPrompt,
        messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
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
            tool_calls: response.toolCalls,
          });
        }

        for (const call of response.toolCalls) {
          const result = await childRegistry.execute(call.name, call.params);
          messages.push({
            role: 'tool',
            content: result,
            tool_use_id: call.id,
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
}
