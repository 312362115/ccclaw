/**
 * spawn 工具 — 派生子 Agent
 */

import type { Tool } from '../tool-registry.js';
import type { SubagentManager } from '../subagent-manager.js';

export function createSpawnTool(subagentManager: SubagentManager, sessionId: string): Tool {
  return {
    name: 'spawn',
    description: '派生一个子 Agent 执行独立任务。子 Agent 有独立工具集和 15 轮迭代限制。',
    schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '子 Agent 要完成的任务描述' },
        label: { type: 'string', description: '子 Agent 的标签（用于追踪）' },
      },
      required: ['task', 'label'],
    },
    async execute(input) {
      const { task, label } = input as { task: string; label: string };
      const result = await subagentManager.spawn(sessionId, task, label);
      return `[子 Agent "${label}" 完成]\n迭代: ${result.iterations}\nTokens: ${result.inputTokens}/${result.outputTokens}\n\n${result.content}`;
    },
  };
}
