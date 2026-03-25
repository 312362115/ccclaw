/**
 * DeepSeek 系列模型 Profile
 */

import type { ModelProfile } from '../model-profile.js';

/** DeepSeek 通用工具约束 */
const DEEPSEEK_TOOL_CONSTRAINTS = [
  '每次只调用一个工具',
  '文件路径必须是绝对路径',
  'edit 工具的 old_string 必须从文件中精确复制',
].join('\n');

export const deepseekProfiles: ModelProfile[] = [
  // ====== DeepSeek Chat (V3) ======
  {
    id: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    vendor: 'deepseek',
    capabilities: {
      contextWindow: 65_536,
      maxOutputTokens: 8192,
      toolUse: true,
      extendedThinking: true,
      vision: false,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    overrides: {
      planning: { temperature: 0.2, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 8000,
      toolCallConstraints: DEEPSEEK_TOOL_CONSTRAINTS,
      needsToolExamples: true,
      preferPhasedPrompt: true,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: true,
      benefitsFromReview: true,
    },
    routing: {
      roles: ['primary', 'planning', 'coding'],
      costEfficiency: 5,
      capabilityTier: 3,
    },
  },

  // ====== DeepSeek Reasoner (R1) ======
  {
    id: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    vendor: 'deepseek',
    capabilities: {
      contextWindow: 65_536,
      maxOutputTokens: 16_384,
      toolUse: true,
      extendedThinking: true,
      vision: false,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    promptStrategy: {
      maxSystemPromptTokens: 8000,
      toolCallConstraints: DEEPSEEK_TOOL_CONSTRAINTS,
      needsToolExamples: true,
      preferPhasedPrompt: true,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 1,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: true,
      benefitsFromReview: false,
    },
    routing: {
      roles: ['primary', 'planning', 'review'],
      costEfficiency: 4,
      capabilityTier: 4,
    },
  },
];
