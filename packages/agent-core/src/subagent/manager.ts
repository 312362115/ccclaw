/**
 * SubagentManager — 子 Agent 管理
 *
 * 从主 Agent 派生独立的子 Agent 并行执行任务：
 * - 独立 ToolRegistry（禁止 spawn 防止递归）
 * - 角色化参数：reviewer 只读、explorer 高温度
 * - 独立迭代限制（默认 15 轮 vs 主 Agent 25 轮）
 * - 并发数限制（默认 3）
 */

import type { LLMProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop } from '../agent-loop.js';
import type { SubagentConfig, SubagentResult, SubagentRole } from './types.js';
import { DEFAULT_SUBAGENT_CONFIG, ROLE_PROFILES } from './types.js';

// ====== SubagentManager ======

export class SubagentManager {
  private activeCount = 0;
  private config: SubagentConfig;

  constructor(
    private provider: LLMProvider,
    private model: string,
    private toolRegistry: ToolRegistry,
    config?: Partial<SubagentConfig>,
  ) {
    this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
  }

  /** 派生子 Agent 执行任务 */
  async spawn(task: string, role: SubagentRole = 'coder'): Promise<SubagentResult> {
    if (this.activeCount >= this.config.maxConcurrent) {
      throw new Error(
        `子 Agent 并发上限 ${this.config.maxConcurrent}，当前 ${this.activeCount} 个运行中`,
      );
    }

    this.activeCount++;

    try {
      return await this.runSubagent(task, role);
    } finally {
      this.activeCount--;
    }
  }

  /** 获取当前活跃子 Agent 数 */
  getActiveCount(): number {
    return this.activeCount;
  }

  // ---- 内部实现 ----

  private async runSubagent(
    task: string,
    role: SubagentRole,
  ): Promise<SubagentResult> {
    const roleProfile = ROLE_PROFILES[role];

    // 构建独立 ToolRegistry：复制父级工具，排除 spawn 防止递归
    const childRegistry = new (this.toolRegistry.constructor as typeof ToolRegistry)();
    const parentDefs = this.toolRegistry.getDefinitions();

    for (const def of parentDefs) {
      // 排除 spawn 工具防止递归
      if (def.name === 'spawn') continue;
      // reviewer 角色排除写入类工具
      if (roleProfile.excludeTools?.includes(def.name)) continue;

      // 从父级获取完整 Tool 对象（含 execute）并注册到子 registry
      // ToolRegistry 没有暴露 getTool，用 execute 代理
      childRegistry.register({
        name: def.name,
        description: def.description,
        schema: def.schema,
        execute: (input) => this.toolRegistry.execute(def.name, input),
      });
    }

    const systemPrompt = `${roleProfile.systemPromptPrefix}\n\n你是一个子 Agent。完成任务后返回结果。不要发起新的子 Agent。`;

    // 收集结果
    let finalText = '';
    let iterations = 0;
    const usage = { inputTokens: 0, outputTokens: 0 };

    await runAgentLoop(task, (event) => {
      switch (event.type) {
        case 'text_delta':
          finalText += event.delta;
          break;
        case 'usage':
          usage.inputTokens += event.usage.inputTokens;
          usage.outputTokens += event.usage.outputTokens;
          break;
        case 'done':
          iterations++;
          break;
      }
    }, {
      provider: this.provider,
      toolRegistry: childRegistry,
      systemPrompt,
      model: this.model,
      maxIterations: this.config.maxIterations,
      temperature: roleProfile.temperature,
      maxTokens: roleProfile.maxTokens,
    });

    return { text: finalText, iterations, usage };
  }
}
