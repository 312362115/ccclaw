/**
 * OpenAI GPT 系列模型 Profile
 */

import type { ModelProfile } from '../model-profile.js';

export const openaiProfiles: ModelProfile[] = [
  // ====== GPT-4o ======
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    vendor: 'openai',
    capabilities: {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: false,
      jsonMode: true,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    promptStrategy: {
      maxSystemPromptTokens: 20_000,
      needsToolExamples: false,
      preferPhasedPrompt: false,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 3,
      benefitsFromVerifyFix: false,
      benefitsFromAutoPlan: false,
      benefitsFromReview: false,
    },
    routing: {
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 3,
      capabilityTier: 4,
    },
  },

  // ====== GPT-4o-mini ======
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    vendor: 'openai',
    capabilities: {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: false,
      jsonMode: true,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: 10_000,
      needsToolExamples: true,
      preferPhasedPrompt: false,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 2,
      benefitsFromVerifyFix: true,
      benefitsFromAutoPlan: false,
      benefitsFromReview: false,
    },
    routing: {
      roles: ['subagent'],
      costEfficiency: 5,
      capabilityTier: 3,
    },
  },

  // ====== o3 ======
  {
    id: 'o3',
    displayName: 'OpenAI o3',
    vendor: 'openai',
    capabilities: {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: false,
      jsonMode: true,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 16_384 },
    promptStrategy: {
      maxSystemPromptTokens: 30_000,
      needsToolExamples: false,
      preferPhasedPrompt: false,
    },
    executionStrategy: {
      maxConcurrentToolCalls: 5,
      benefitsFromVerifyFix: false,
      benefitsFromAutoPlan: false,
      benefitsFromReview: false,
    },
    routing: {
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 1,
      capabilityTier: 5,
    },
  },
];
