/**
 * OpenAIAdapter — Chat Completions API adapter using native fetch.
 *
 * Implements LLMProvider from ./types.js.
 * Uses withRetry and sanitizeMessages from ./base.js.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  LLMToolCall,
  ChatParams,
  ChatResponse,
  ProviderCapabilities,
  ProviderConfig,
  StopReason,
  LLMStreamEvent,
  TokenUsage,
} from './types.js';
import { ProviderConfigError } from './types.js';
import { withRetry, sanitizeMessages } from './base.js';

// ============================================================
// OpenAI wire-format types (internal)
// ============================================================

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ============================================================
// Helpers
// ============================================================

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

/**
 * Converts internal LLMMessage array to OpenAI wire format.
 * Tool results (role='tool') become separate messages with role='tool'.
 */
function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool result messages — expand toolResults if present
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool',
            content: tr.output,
            tool_call_id: tr.toolCallId,
          });
        }
      } else {
        // Fallback: bare tool message without structured toolResults
        result.push({
          role: 'tool',
          content: msg.content ?? '',
        });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const openAIMsg: OpenAIMessage = {
        role: 'assistant',
        content: (msg.content as string | null | undefined) ?? null,
      };

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        openAIMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.input === 'string'
                ? tc.input
                : JSON.stringify(tc.input),
          },
        }));
      }

      result.push(openAIMsg);
      continue;
    }

    // user / system
    result.push({
      role: msg.role as 'user' | 'system',
      content: msg.content ?? '',
    });
  }

  return result;
}

function toOpenAITools(tools: LLMToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
}

// ============================================================
// OpenAIAdapter
// ============================================================

export class OpenAIAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('apiKey is required for OpenAI provider', 'apiKey');
    }
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase ?? 'https://api.openai.com';
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      promptCaching: false,
      vision: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    };
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const {
      model,
      messages,
      tools,
      systemPrompt,
      maxTokens = 4096,
      temperature,
      signal,
    } = params;

    const sanitized = sanitizeMessages(messages);
    const openAIMessages: OpenAIMessage[] = [];

    if (systemPrompt) {
      openAIMessages.push({ role: 'system', content: systemPrompt });
    }
    openAIMessages.push(...toOpenAIMessages(sanitized));

    const body: Record<string, unknown> = {
      model,
      messages: openAIMessages,
      max_tokens: maxTokens,
    };

    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = toOpenAITools(tools);
    }

    const response = await withRetry(async () => {
      const res = await fetch(`${this.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<OpenAIResponse>;
    });

    const choice = response.choices[0];
    const message = choice.message;
    const stopReason = mapFinishReason(choice.finish_reason);

    const toolCalls: LLMToolCall[] = (message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: (() => {
        try {
          return JSON.parse(tc.function.arguments);
        } catch {
          return tc.function.arguments;
        }
      })(),
    }));

    const usage: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };

    return {
      content: message.content ?? '',
      toolCalls,
      usage,
      stopReason,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<LLMStreamEvent> {
    const {
      model,
      messages,
      tools,
      systemPrompt,
      maxTokens = 4096,
      temperature,
      signal,
    } = params;

    const sanitized = sanitizeMessages(messages);
    const openAIMessages: OpenAIMessage[] = [];

    if (systemPrompt) {
      openAIMessages.push({ role: 'system', content: systemPrompt });
    }
    openAIMessages.push(...toOpenAIMessages(sanitized));

    const body: Record<string, unknown> = {
      model,
      messages: openAIMessages,
      max_tokens: maxTokens,
      stream: true,
    };

    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = toOpenAITools(tools);
    }

    const res = await fetch(`${this.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error('OpenAI stream: no response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Track in-progress tool calls by index
    // index → { toolCallId, name, accumulated arguments }
    type ToolCallState = { toolCallId: string; name: string };
    const toolCallStates = new Map<number, ToolCallState>();
    let lastFinishReason: string | null = null;
    let streamUsage: TokenUsage | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep last (possibly incomplete) line in buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice('data:'.length).trim();

          if (data === '[DONE]') {
            // Emit tool_use_end for any still-open tool calls
            for (const [, state] of toolCallStates) {
              yield { type: 'tool_use_end', toolCallId: state.toolCallId };
            }
            toolCallStates.clear();

            if (streamUsage) {
              yield { type: 'usage', usage: streamUsage };
            }

            const stopReason = mapFinishReason(lastFinishReason ?? 'stop');
            yield { type: 'done', stopReason };
            return;
          }

          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
          };

          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          // Capture usage from final chunk if present
          if (chunk.usage) {
            streamUsage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            };
          }

          const choices = chunk.choices ?? [];
          for (const choice of choices) {
            if (choice.finish_reason) {
              lastFinishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            // Text delta
            if (delta.content) {
              yield { type: 'text_delta', delta: delta.content };
            }

            // Tool call deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;

                if (tc.id && tc.function?.name) {
                  // First chunk for this tool call index — emit tool_use_start
                  toolCallStates.set(idx, {
                    toolCallId: tc.id,
                    name: tc.function.name,
                  });
                  yield {
                    type: 'tool_use_start',
                    toolCallId: tc.id,
                    name: tc.function.name,
                  };
                } else if (tc.function?.arguments) {
                  // Subsequent chunk — emit tool_use_delta
                  const state = toolCallStates.get(idx);
                  if (state) {
                    yield {
                      type: 'tool_use_delta',
                      toolCallId: state.toolCallId,
                      delta: tc.function.arguments,
                    };
                  }
                }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If stream ended without [DONE] (e.g., aborted)
    for (const [, state] of toolCallStates) {
      yield { type: 'tool_use_end', toolCallId: state.toolCallId };
    }

    const stopReason = mapFinishReason(lastFinishReason ?? 'stop');
    yield { type: 'done', stopReason };
  }
}
