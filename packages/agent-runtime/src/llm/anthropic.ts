/**
 * AnthropicAdapter — Claude Messages API adapter using native fetch (no SDK).
 *
 * Implements the LLMProvider interface for Anthropic Claude models.
 * Supports chat, streaming, tool use, extended thinking, and prompt caching.
 */

import { withRetry, sanitizeMessages } from './base.js';
import type {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  LLMToolCall,
  ChatParams,
  ChatResponse,
  LLMStreamEvent,
  ProviderCapabilities,
  ProviderConfig,
  StopReason,
} from './types.js';
import { ProviderConfigError, getTextContent } from './types.js';

// ============================================================
// Anthropic API types
// ============================================================

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  } | {
    type: 'url';
    url: string;
  };
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[] | null | string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  thinking?: AnthropicThinkingConfig;
  stream?: boolean;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: AnthropicUsage;
}

interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ============================================================
// SSE event types
// ============================================================

interface SSEMessageStartEvent {
  type: 'message_start';
  message: {
    usage: AnthropicUsage;
  };
}

interface SSEContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'tool_use'; id: string; name: string; input: string };
}

interface SSEContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string };
}

interface SSEContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

interface SSEMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
  };
  usage?: {
    output_tokens: number;
  };
}

type SSEEvent =
  | SSEMessageStartEvent
  | SSEContentBlockStartEvent
  | SSEContentBlockDeltaEvent
  | SSEContentBlockStopEvent
  | SSEMessageDeltaEvent
  | { type: string };

// ============================================================
// Helper functions
// ============================================================

/**
 * Map Anthropic stop_reason → StopReason
 */
function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

/**
 * Convert LLMMessage array → Anthropic messages format.
 * Tool role messages are converted to user messages with tool_result content blocks.
 * Assistant messages may have tool_use content blocks.
 */
function convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool results → user message with tool_result content blocks
      const blocks: AnthropicToolResultBlock[] = (msg.toolResults ?? []).map(
        (r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolCallId,
          content: r.output,
        }),
      );
      result.push({ role: 'user', content: blocks });
    } else if (msg.role === 'assistant') {
      // null content means tool-calls only assistant turn
      if (msg.content === null) {
        const blocks: AnthropicToolUseBlock[] = (msg.toolCalls ?? []).map(
          (tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          }),
        );
        result.push({ role: 'assistant', content: blocks });
      } else {
        const blocks: AnthropicContentBlock[] = [];
        const text = getTextContent(msg.content);
        if (text) {
          blocks.push({ type: 'text', text });
        }
        for (const tc of msg.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        result.push({
          role: 'assistant',
          content: blocks.length > 0 ? blocks : null,
        });
      }
    } else {
      // user role — 支持纯文本或多模态内容块
      if (Array.isArray(msg.content)) {
        const blocks: AnthropicContentBlock[] = msg.content.map((block) => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          if (block.type === 'image') return { type: 'image' as const, source: block.source } as AnthropicImageBlock;
          return { type: 'text' as const, text: '' };
        });
        result.push({ role: 'user', content: blocks });
      } else {
        result.push({
          role: 'user',
          content: [{ type: 'text', text: msg.content }],
        });
      }
    }
  }

  return result;
}

/**
 * Convert LLMToolDefinition array → Anthropic tools format.
 */
function convertTools(tools: LLMToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema,
  }));
}

// ============================================================
// AnthropicAdapter
// ============================================================

export class AnthropicAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;
  readonly defaultModel?: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('Anthropic API key is required', 'apiKey');
    }
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase ?? 'https://api.anthropic.com';
    this.defaultModel = config.defaultModel;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: true,
      promptCaching: true,
      vision: true,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.apiKey.startsWith('oauth_')) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  private buildRequestBody(params: ChatParams, stream = false): AnthropicRequestBody {
    const sanitized = sanitizeMessages(params.messages);
    const body: AnthropicRequestBody = {
      model: params.model,
      messages: convertMessages(sanitized),
      max_tokens: params.maxTokens ?? this.capabilities().maxOutputTokens,
    };

    if (params.systemPrompt) {
      body.system = params.systemPrompt;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = convertTools(params.tools);
    }

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.thinkingConfig) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: params.thinkingConfig.budgetTokens,
      };
    }

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      const signal = params.signal ?? controller.signal;

      let response: Response;
      try {
        response = await fetch(`${this.apiBase}/v1/messages`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(this.buildRequestBody(params)),
          signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as
          | AnthropicErrorResponse
          | Record<string, unknown>;
        const errorMessage =
          'error' in errorBody && errorBody.error
            ? (errorBody as AnthropicErrorResponse).error.message
            : `HTTP ${response.status}`;
        throw new Error(`Anthropic API error ${response.status}: ${errorMessage}`);
      }

      const data = (await response.json()) as AnthropicResponse;

      // Extract text content
      let content = '';
      const toolCalls: LLMToolCall[] = [];

      for (const block of data.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
        stopReason: mapStopReason(data.stop_reason),
      };
    });
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    const signal = params.signal ?? controller.signal;

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/v1/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildRequestBody(params, true)),
        signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorBody = (await response.json().catch(() => ({}))) as
        | AnthropicErrorResponse
        | Record<string, unknown>;
      const errorMessage =
        'error' in errorBody && errorBody.error
          ? (errorBody as AnthropicErrorResponse).error.message
          : `HTTP ${response.status}`;
      throw new Error(`Anthropic API error ${response.status}: ${errorMessage}`);
    }

    const body = response.body;
    if (!body) {
      clearTimeout(timeoutId);
      throw new Error('Anthropic API: no response body');
    }

    // Track usage across events
    let inputTokens = 0;
    let outputTokens = 0;

    // Track tool_use blocks by index so we can emit tool_use_end
    const toolUseIndexToId = new Map<number, string>();

    try {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          let event: SSEEvent;
          try {
            event = JSON.parse(jsonStr) as SSEEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case 'message_start': {
              const e = event as SSEMessageStartEvent;
              inputTokens = e.message.usage.input_tokens;
              outputTokens = e.message.usage.output_tokens;
              yield {
                type: 'usage',
                usage: { inputTokens, outputTokens },
              };
              break;
            }

            case 'content_block_start': {
              const e = event as SSEContentBlockStartEvent;
              if (e.content_block.type === 'tool_use') {
                toolUseIndexToId.set(e.index, e.content_block.id);
                yield {
                  type: 'tool_use_start',
                  toolCallId: e.content_block.id,
                  name: e.content_block.name,
                };
              }
              break;
            }

            case 'content_block_delta': {
              const e = event as SSEContentBlockDeltaEvent;
              if (e.delta.type === 'text_delta') {
                yield { type: 'text_delta', delta: e.delta.text };
              } else if (e.delta.type === 'thinking_delta') {
                yield { type: 'thinking_delta', delta: e.delta.thinking };
              } else if (e.delta.type === 'input_json_delta') {
                const toolCallId = toolUseIndexToId.get(e.index);
                if (toolCallId !== undefined) {
                  yield {
                    type: 'tool_use_delta',
                    toolCallId,
                    delta: e.delta.partial_json,
                  };
                }
              }
              break;
            }

            case 'content_block_stop': {
              const e = event as SSEContentBlockStopEvent;
              const toolCallId = toolUseIndexToId.get(e.index);
              if (toolCallId !== undefined) {
                yield { type: 'tool_use_end', toolCallId };
              }
              break;
            }

            case 'message_delta': {
              const e = event as SSEMessageDeltaEvent;
              if (e.usage) {
                outputTokens = e.usage.output_tokens;
                yield {
                  type: 'usage',
                  usage: { inputTokens, outputTokens },
                };
              }
              yield {
                type: 'done',
                stopReason: mapStopReason(e.delta.stop_reason),
              };
              break;
            }

            default:
              break;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
