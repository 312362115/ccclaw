// ============================================================
// Prompt Composer — 分层组合系统提示词
// ============================================================
//
// 4 层结构（优先级从高到低）：
//   Layer 1: 用户 systemPrompt（最高优先级）
//   Layer 2: Prompt Enhancers（内置增强，按模型等级自动选择）
//   Layer 3: Tool constraints（来自 ModelProfile）
//   Layer 4: Tool schema injection（CLI 模式，不在此处理）

import type { PromptComposerInput } from './types.js';
import { BASE_SYSTEM_PROMPT } from './base.js';
import { getToolGuidance } from './enhancers/tool-guidance.js';

/**
 * 组合系统提示词。
 * 按分层结构将用户提示词、增强指南、工具约束拼接为最终 system prompt。
 */
export function composeSystemPrompt(input: PromptComposerInput): string {
  const sections: string[] = [];

  // Layer 1: 用户提示词 or 默认提示词
  sections.push(input.userPrompt ?? BASE_SYSTEM_PROMPT);

  // Layer 2: 工具使用指南（仅当有工具且开启增强时）
  if (input.enhancements?.toolUseGuidance && input.toolDefs.length > 0) {
    const guidance = getToolGuidance(input.capabilityTier);
    if (guidance) {
      sections.push(guidance);
    }
  }

  // Layer 3: 工具调用约束
  if (input.toolCallConstraints) {
    sections.push(`## 工具调用约束\n${input.toolCallConstraints}`);
  }

  return sections.join('\n\n');
}
