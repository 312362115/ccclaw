/**
 * Prompt 模块入口 — 按阶段组装 system prompt
 *
 * 分阶段 prompt 策略：弱模型受益于精简的阶段化 prompt（减少信息过载）
 * 强模型可以用完整的单体 prompt（不需要分阶段）
 *
 * 由 ModelProfile.promptStrategy.preferPhasedPrompt 决定是否启用
 */

import { BASE_SYSTEM_PROMPT } from './base.js';
import { CODING_PHASE_PROMPT } from './coding.js';
import { REVIEWING_PHASE_PROMPT } from './reviewing.js';
import { PLANNING_SYSTEM_PROMPT } from './planning.js';
import type { AgentPhase } from '../llm/model-profile.js';

export { BASE_SYSTEM_PROMPT } from './base.js';
export { CODING_PHASE_PROMPT } from './coding.js';
export { REVIEWING_PHASE_PROMPT } from './reviewing.js';
export { PLANNING_SYSTEM_PROMPT } from './planning.js';

/**
 * 根据阶段获取组合后的 prompt。
 *
 * planning → 使用专用的 planning prompt（不含 base，因为 planning prompt 自成体系）
 * coding → base + coding
 * reviewing → base + reviewing
 */
export function getPhasePrompt(phase: AgentPhase): string {
  switch (phase) {
    case 'planning':
      return PLANNING_SYSTEM_PROMPT;
    case 'coding':
      return [BASE_SYSTEM_PROMPT, CODING_PHASE_PROMPT].join('\n\n');
    case 'reviewing':
      return [BASE_SYSTEM_PROMPT, REVIEWING_PHASE_PROMPT].join('\n\n');
    default:
      return BASE_SYSTEM_PROMPT;
  }
}
