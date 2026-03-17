// ============================================================
// Core message types
// ============================================================

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMToolResult {
  toolCallId: string;
  output: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  toolResults?: LLMToolResult[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

// ============================================================
// Chat request / response
// ============================================================

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage: TokenUsage;
  stopReason: StopReason;
}

export interface CacheHint {
  type: 'ephemeral';
}

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  thinkingConfig?: { budgetTokens: number };
  cacheControl?: CacheHint;
}

// ============================================================
// Provider capabilities & config
// ============================================================

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  extendedThinking: boolean;
  promptCaching: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ProviderConfig {
  type: string;
  apiKey: string;
  apiBase?: string;
  defaultModel?: string;
}

export class ProviderConfigError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'ProviderConfigError';
    this.field = field;
    // Restore prototype chain (required when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================
// LLM stream events  (emitted by adapters)
// ============================================================

export type LLMStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_use_start'; toolCallId: string; name: string }
  | { type: 'tool_use_delta'; toolCallId: string; delta: string }
  | { type: 'tool_use_end'; toolCallId: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error?: Error; message?: string };

// ============================================================
// Agent stream events  (emitted by the Agent Loop)
// ============================================================

export type AgentStreamEvent =
  | LLMStreamEvent
  | { type: 'tool_result'; toolCallId: string; output: string }
  | {
      type: 'confirm_request';
      confirmId: string;
      toolName: string;
      input: unknown;
    }
  | { type: 'subagent_started'; subagentId: string; goal: string }
  | { type: 'subagent_result'; subagentId: string; result: string }
  | { type: 'consolidation'; summary: string }
  | { type: 'session_done'; usage: TokenUsage };

// ============================================================
// LLMProvider interface
// ============================================================

export interface LLMProvider {
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncIterable<LLMStreamEvent>;
  capabilities(): ProviderCapabilities;
}
