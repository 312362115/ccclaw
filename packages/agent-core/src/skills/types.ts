// ============================================================
// Skill types — 双模 Skill 系统类型定义
//
// Prompt Skill: 纯文本注入 system prompt（适合强模型）
// Code Skill: 文本注入 + 生命周期钩子（适合弱模型，用代码兜底）
// ============================================================

import type { Tool } from '../tools/types.js';

/** Prompt Skill — 纯文本注入，强模型靠指令就能遵守 */
export interface PromptSkill {
  type: 'prompt';
  name: string;
  description: string;
  /** 注入到 system prompt 的文本 */
  prompt: string;
  /** 按模型能力分层的 prompt 变体（可选） */
  promptByTier?: {
    strong?: string;  // capabilityTier >= 5
    medium?: string;  // capabilityTier 3-4
    weak?: string;    // capabilityTier <= 2
  };
  /** 此 Skill 提供的工具 */
  tools?: Tool[];
  /** 始终注入（vs 按需注入） */
  always?: boolean;
}

/** Code Skill 钩子返回值 */
export interface SkillHookResult {
  /** 是否阻止工具调用 */
  block: boolean;
  /** 阻止时的提示信息 */
  message?: string;
}

/** Code Skill — 文本注入 + 生命周期钩子，弱模型用代码兜底 */
export interface CodeSkill {
  type: 'code';
  name: string;
  description: string;
  prompt: string;
  promptByTier?: { strong?: string; medium?: string; weak?: string };
  tools?: Tool[];
  always?: boolean;
  hooks: {
    /** 工具调用前钩子，可阻止调用 */
    beforeToolCall?: (
      toolName: string,
      input: Record<string, unknown>,
      state: Map<string, unknown>,
    ) => Promise<SkillHookResult>;
    /** 工具调用后钩子，用于记录或副作用 */
    afterToolCall?: (
      toolName: string,
      input: Record<string, unknown>,
      result: string,
      state: Map<string, unknown>,
    ) => Promise<void>;
  };
}

export type Skill = PromptSkill | CodeSkill;

export interface SkillLoaderConfig {
  /** 扫描 SKILL.md 的目录列表 */
  dirs?: string[];
  /** 编程方式注册的 Skill */
  inline?: Skill[];
}
