/**
 * Harness 自适应层类型定义
 *
 * 核心理念（来自 Anthropic）：
 * "Every component in a harness encodes an assumption about what the model can't do on its own."
 * 强模型需要更少的 harness，弱模型需要更多。
 *
 * HarnessTier 根据模型能力评级自动确定，
 * HarnessConfig 控制 Agent 循环中各项补偿策略的开关和参数。
 */

export type HarnessTier = 'light' | 'medium' | 'heavy';

export interface HarnessConfig {
  tier: HarnessTier;
  /** 工具调用模式：true = 强制 CLI 文本模式（绕过原生 function calling） */
  forceCliMode: boolean;
  /** 每轮限制单次工具调用（忽略多余的并行调用） */
  singleToolPerTurn: boolean;
  /** 向 system prompt 注入详细的工具使用指南 */
  injectToolGuidance: boolean;
  /** 向 system prompt 注入思维链框架 */
  injectChainOfThought: boolean;
  /** 工具调用解析失败时的最大重试次数 */
  maxParseRetries: number;
  /** 上下文压缩触发比例（占 context window 百分比） */
  compressionTriggerRatio: number;
}
