// ============================================================
// Agent 核心类型
// ============================================================

import type { Tool } from './tools/types.js';
import type {
  AgentStreamEvent,
  TokenUsage,
  LLMToolCall,
} from './providers/types.js';

/** Agent 配置 */
export interface AgentConfig {
  /** 模型标识（如 qwen-plus, gpt-4o） */
  model: string;
  /** API 密钥 */
  apiKey: string;
  /** API 基础地址（自定义端点） */
  apiBase?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 可用工具列表 */
  tools?: Tool[];
  /** 最大工具调用轮次 */
  maxIterations?: number;
  /** 采样温度 */
  temperature?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** Provider 类型（如 'openai', 'anthropic'），不指定时自动推断 */
  provider?: string;
  /** 扩展思考配置 */
  thinking?: { budgetTokens: number };
  /** 提示词增强（如自动注入工具使用指南） */
  promptEnhancements?: boolean;
  /** 事件回调（流式输出时触发） */
  onEvent?: (event: AgentStreamEvent) => void;
}

/** Agent 单次运行结果 */
export interface AgentResult {
  /** 最终文本输出 */
  text: string;
  /** 本次运行中所有工具调用 */
  toolCalls: LLMToolCall[];
  /** token 用量汇总 */
  usage: TokenUsage;
  /** 实际执行的迭代轮次 */
  iterations: number;
}

/** Agent 接口 */
export interface Agent {
  /** 同步运行：发送消息，等待最终结果 */
  run(message: string): Promise<AgentResult>;
  /** 流式运行：发送消息，逐事件返回 */
  stream(message: string): AsyncIterable<AgentStreamEvent>;
}
