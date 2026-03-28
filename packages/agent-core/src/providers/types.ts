// ============================================================
// Core message types
// ============================================================

/** 文本内容块 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** 图片内容块（支持 base64 和 URL） */
export interface ImageContentBlock {
  type: 'image';
  source:
    | {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      }
    | {
        type: 'url';
        url: string;
      };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

/** 获取消息的纯文本内容（兼容 string 和 ContentBlock[] 两种格式） */
export function getTextContent(
  content: string | ContentBlock[] | null | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextContentBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LLMToolResult {
  toolCallId: string;
  output: string;
}

/**
 * LLM 消息。content 支持两种格式：
 * - string: 纯文本（向后兼容）
 * - ContentBlock[]: 多模态内容块（文本 + 图片）
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCalls?: LLMToolCall[];
  toolResults?: LLMToolResult[];
}

// ============================================================
// Tool definition (LLM 侧)
// ============================================================

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

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  thinkingConfig?: { budgetTokens: number };
  /** 结构化输出格式 */
  responseFormat?: { type: 'json_object' | 'text' };
  /** 厂商扩展参数（如 Qwen 的 enable_thinking） */
  extra?: Record<string, unknown>;
}

// ============================================================
// Provider capabilities & config
// ============================================================

export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  extendedThinking: boolean;
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

// ============================================================
// LLM stream events（由 provider adapter 发出）
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
// Agent stream events（由 Agent Loop 发出，在 LLM 事件基础上扩展）
// ============================================================

export type AgentStreamEvent =
  | LLMStreamEvent
  | { type: 'tool_result'; toolCallId: string; output: string }
  | { type: 'session_done'; usage: TokenUsage };

// ============================================================
// LLMProvider interface
// ============================================================

export interface LLMProvider {
  stream(params: ChatParams): AsyncIterable<LLMStreamEvent>;
  capabilities(): ProviderCapabilities;
}
