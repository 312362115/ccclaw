/**
 * Anthropic Claude 系列模型 Profile
 */

import type { ModelProfile } from '../model-profile.js';

export const anthropicProfiles: ModelProfile[] = [
  // ====== Claude Opus 4 ======
  {
    id: 'claude-opus-4',
    displayName: 'Claude Opus 4',
    vendor: 'anthropic',
    capabilities: {
      contextWindow: 1_048_576,
      maxOutputTokens: 32_768,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: false,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    promptStrategy: {
      maxSystemPromptTokens: 50_000,
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

  // ====== Claude Sonnet 4 ======
  {
    id: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    vendor: 'anthropic',
    capabilities: {
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: false,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
    promptStrategy: {
      maxSystemPromptTokens: 30_000,
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
      roles: ['primary', 'planning', 'coding', 'review', 'subagent'],
      costEfficiency: 3,
      capabilityTier: 4,
    },
  },

  // ====== Claude Haiku 4 ======
  {
    id: 'claude-haiku-4',
    displayName: 'Claude Haiku 4',
    vendor: 'anthropic',
    capabilities: {
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      toolUse: true,
      extendedThinking: false,
      vision: true,
      promptCaching: true,
      jsonMode: false,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 4096 },
    promptStrategy: {
      maxSystemPromptTokens: 15_000,
      needsToolExamples: false,
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
];
