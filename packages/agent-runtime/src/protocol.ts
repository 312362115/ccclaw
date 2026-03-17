// Agent 请求/响应协议 — 与 Server 端 runner-manager.ts 共享类型定义

import type { LLMStreamEvent, AgentStreamEvent, TokenUsage } from './llm/types.js';

export interface AgentRequest {
  method: 'run';
  params: {
    sessionId: string;
    message: string;
    apiKey: string;
    providerType: string;    // 'claude' | 'openai' | 'gemini' | etc
    apiBase?: string;        // custom endpoint
    context: {
      systemPrompt: string;
      memories: any[];
      skills: any[];
      history: any[];
      preferences: any;
      mcpServers: any[];
    };
  };
}

// Re-export stream event types for convenience
export type { LLMStreamEvent, AgentStreamEvent, TokenUsage } from './llm/types.js';
export type AgentResponse = AgentStreamEvent;  // backward compat alias

// Runner → Server 消息
export interface RunnerMessage {
  type: 'ping' | 'response';
  requestId?: string;
  data?: AgentResponse;
}

// Server → Runner 消息
export interface ServerMessage {
  type: 'registered' | 'pong' | 'request' | 'confirm_response';
  runnerId?: string;
  requestId?: string;
  data?: AgentRequest;
  // confirm_response fields
  confirmRequestId?: string;
  approved?: boolean;
}
