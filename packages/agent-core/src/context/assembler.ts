// ============================================================
// Context Assembler — 基于 ModelProfile 组装最终 system prompt
// ============================================================

import type { ToolDefinition } from '../tools/types.js';
import type { ModelProfile } from '../profiles/types.js';
import { composeSystemPrompt } from '../prompt/composer.js';
import { estimateTokens } from './token-estimator.js';

/** assembleSystemPrompt 的输入 */
export interface AssembleInput {
  /** 用户自定义系统提示词 */
  userPrompt?: string;
  /** 模型能力画像 */
  profile: ModelProfile;
  /** 当前可用工具定义列表 */
  toolDefs: ToolDefinition[];
  /** 增强开关 */
  enhancements?: { toolUseGuidance?: boolean };
}

/**
 * 基于 ModelProfile 组装系统提示词。
 * 封装 composeSystemPrompt 并处理 token 上限截断。
 */
export function assembleSystemPrompt(input: AssembleInput): string {
  const capabilityTier = input.profile.routing?.capabilityTier ?? 3;
  const maxTokens = input.profile.promptStrategy.maxSystemPromptTokens;

  const composed = composeSystemPrompt({
    userPrompt: input.userPrompt,
    capabilityTier,
    toolDefs: input.toolDefs,
    toolCallConstraints: input.profile.promptStrategy.toolCallConstraints,
    enhancements: input.enhancements,
  });

  // 超出 token 上限时从末尾截断
  if (maxTokens > 0 && estimateTokens(composed) > maxTokens) {
    // 按字符比例截断（1 token ≈ 4 字符）
    const maxChars = maxTokens * 4;
    return composed.slice(0, maxChars);
  }

  return composed;
}
