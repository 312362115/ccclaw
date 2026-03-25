/**
 * 兜底 Profile — 未知模型使用保守配置
 *
 * 原则：安全优先，宁可慢一点也不要出错。
 */

import type { ModelProfile } from '../model-profile.js';

export const defaultProfile: ModelProfile = {
  id: '_default',
  displayName: 'Unknown Model',
  vendor: 'unknown',

  capabilities: {
    contextWindow: 32_000,
    maxOutputTokens: 4096,
    toolUse: false,            // 保守：假设不支持原生 function calling
    extendedThinking: false,
    vision: false,
    promptCaching: false,
    jsonMode: false,
    parallelToolCalls: false,
  },

  defaults: {
    temperature: 0.1,
    maxTokens: 4096,
  },

  promptStrategy: {
    maxSystemPromptTokens: 4000,
    toolCallConstraints: [
      '每次只调用一个工具',
      '调用前先用一句话说明你要做什么',
      '文件路径必须是绝对路径',
    ].join('\n'),
    needsToolExamples: true,
    preferPhasedPrompt: true,
  },

  executionStrategy: {
    maxConcurrentToolCalls: 1,
    benefitsFromVerifyFix: true,
    benefitsFromAutoPlan: true,
    benefitsFromReview: true,
  },

  // 不设置 routing — 未知模型不参与模型路由
};
