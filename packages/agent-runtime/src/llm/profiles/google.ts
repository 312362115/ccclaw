/**
 * Google Gemini 系列模型 Profile
 */

import type { ModelProfile } from '../model-profile.js';

export const googleProfiles: ModelProfile[] = [
  // ====== Gemini 2.5 Pro ======
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    vendor: 'google',
    capabilities: {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: true,
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
      roles: ['primary', 'planning', 'coding', 'review'],
      costEfficiency: 3,
      capabilityTier: 4,
    },
  },

  // ====== Gemini 2.5 Flash ======
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    vendor: 'google',
    capabilities: {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      toolUse: true,
      extendedThinking: true,
      vision: true,
      promptCaching: true,
      jsonMode: true,
      parallelToolCalls: true,
    },
    defaults: { temperature: 0.1, maxTokens: 8192 },
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
      roles: ['primary', 'coding', 'subagent'],
      costEfficiency: 5,
      capabilityTier: 3,
    },
  },
];
