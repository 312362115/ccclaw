/**
 * 阿里云 Qwen 系列模型 Profile
 */

import type { ModelProfile } from '../model-profile.js';

/** Qwen 系列通用的工具调用约束 */
const QWEN_TOOL_CONSTRAINTS = [
  '每次只调用一个工具（不要并行，容易出错）',
  '调用前先用一句话说明你要做什么',
  '文件路径必须是绝对路径',
  'edit 工具的 old_string 必须从文件中精确复制，不能凭记忆写',
  '如果不确定文件内容，先用 read 工具查看',
].join('\n');

export const alibabaProfiles: ModelProfile[] = [
  // ====== Qwen Max ======
  {
    id: 'qwen-max',
    displayName: 'Qwen Max',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131_072,
      maxOutputTokens: 8192,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    overrides: {
      planning: { temperature: 0.2, maxTokens: 4096 },
      reviewing: { temperature: 0.15, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 6000,
      toolCallConstraints: QWEN_TOOL_CONSTRAINTS,
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
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 4,
      capabilityTier: 3,
    },
  },

  // ====== Qwen Plus ======
  {
    id: 'qwen-plus',
    displayName: 'Qwen Plus',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131_072,
      maxOutputTokens: 8192,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    overrides: {
      planning: { temperature: 0.2, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 6000,
      toolCallConstraints: QWEN_TOOL_CONSTRAINTS,
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
      roles: ['primary', 'coding'],
      costEfficiency: 4,
      capabilityTier: 3,
    },
  },

  // ====== Qwen Turbo ======
  {
    id: 'qwen-turbo',
    displayName: 'Qwen Turbo',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131_072,
      maxOutputTokens: 4096,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: false,
    },
    defaults: { temperature: 0.1, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: 4000,
      toolCallConstraints: QWEN_TOOL_CONSTRAINTS,
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
      roles: ['subagent'],
      costEfficiency: 5,
      capabilityTier: 2,
    },
  },

  // ====== Qwen3 Coder ======
  {
    id: 'qwen3-coder',
    displayName: 'Qwen3 Coder',
    vendor: 'alibaba',
    capabilities: {
      contextWindow: 131_072,
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
      reviewing: { temperature: 0.15, maxTokens: 4096 },
    },
    promptStrategy: {
      maxSystemPromptTokens: 6000,
      toolCallConstraints: QWEN_TOOL_CONSTRAINTS,
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
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 3,
      capabilityTier: 3,
    },
  },
];
