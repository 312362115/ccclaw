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
    model?: string;          // override default model
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
export type RunnerMessage =
  | { type: 'ping' }
  | { type: 'response'; requestId: string; data: AgentResponse }
  | { type: 'terminal_output'; terminalId: string; data: string }
  | { type: 'terminal_exit'; terminalId: string; code: number };

// Server → Runner 消息
export type ServerMessage =
  | { type: 'registered'; runnerId?: string }
  | { type: 'pong' }
  | { type: 'request'; requestId: string; data: AgentRequest }
  | { type: 'confirm_response'; confirmRequestId: string; approved: boolean }
  | { type: 'terminal_open'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal_input'; terminalId: string; data: string }
  | { type: 'terminal_resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal_close'; terminalId: string };
