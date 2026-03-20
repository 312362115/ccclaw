// Agent 请求/响应协议 — 统一从 @ccclaw/shared 导入
// 本文件作为 runtime 内部的便捷 re-export 层

// 共享协议类型（Server 和 Runtime 的唯一可信来源）
export type {
  RuntimeConfig,
  AgentRequest,
  AgentResponse,
  RunnerMessage,
  ServerMessage,
  ContentBlock,
  TextContentBlock,
  ImageContentBlock,
} from '@ccclaw/shared';

// Runtime 特有的流式事件类型（不在共享协议中）
export type { LLMStreamEvent, AgentStreamEvent, TokenUsage } from './llm/types.js';
