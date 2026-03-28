/**
 * 阿里巴巴 Qwen 系列模型 Profile
 */

import type { ModelProfile } from './types.js';

export const qwen35Plus: ModelProfile = {
  id: 'qwen3.5-plus',
  displayName: 'Qwen3.5 Plus',
  vendor: 'alibaba',

  capabilities: {
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    toolUse: true,
    extendedThinking: true,
    vision: true,
    promptCaching: true,
    jsonMode: true,
    parallelToolCalls: false,
  },

  defaults: {
    temperature: 0.1,
    maxTokens: 8192,
  },

  overrides: {
    planning: { temperature: 0.2, maxTokens: 4096 },
    reviewing: { temperature: 0.15, maxTokens: 4096 },
  },

  promptStrategy: {
    maxSystemPromptTokens: 8000,
    toolCallConstraints: [
      '每次只调用一个工具（不要并行，容易出错）',
      '调用前先用一句话说明你要做什么',
      '文件路径必须是绝对路径',
    ].join('\n'),
    needsToolExamples: false,
    preferPhasedPrompt: true,
  },

  executionStrategy: {
    maxConcurrentToolCalls: 1,
    benefitsFromVerifyFix: true,
    benefitsFromAutoPlan: true,
    benefitsFromReview: true,
  },

  routing: {
    roles: ['primary', 'planning', 'coding', 'review'],
    costEfficiency: 4,
    capabilityTier: 4,
  },
};

/** 阿里巴巴全部 Profile */
export const alibabaProfiles: ModelProfile[] = [qwen35Plus];
