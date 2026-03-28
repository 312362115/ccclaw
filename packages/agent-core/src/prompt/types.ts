// ============================================================
// Prompt Composer 类型
// ============================================================

import type { ToolDefinition } from '../tools/types.js';

/** composeSystemPrompt 的输入 */
export interface PromptComposerInput {
  /** 用户自定义系统提示词（最高优先级） */
  userPrompt?: string;
  /** 模型能力等级 1-5，来自 ModelProfile.routing.capabilityTier */
  capabilityTier: number;
  /** 当前可用工具定义列表 */
  toolDefs: ToolDefinition[];
  /** 工具调用约束提示，来自 ModelProfile.promptStrategy.toolCallConstraints */
  toolCallConstraints?: string;
  /** 可选的增强开关 */
  enhancements?: {
    /** 是否注入工具使用指南（按 capabilityTier 自动分级） */
    toolUseGuidance?: boolean;
    /** 是否注入思维链指南（按 capabilityTier 自动分级） */
    chainOfThought?: boolean;
    /** 是否注入输出格式指南（按 capabilityTier 自动分级） */
    outputFormat?: boolean;
  };
}
