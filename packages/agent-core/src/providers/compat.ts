/**
 * OpenAI-Compatible LLM Provider — 使用原生 fetch 实现 SSE 流式调用。
 *
 * 支持所有兼容 OpenAI Chat Completions API 的模型服务（Qwen、DeepSeek 等）。
 * 零外部依赖，仅使用 Web 标准 API（fetch、ReadableStream、TextDecoder）。
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMToolDefinition,
  ChatParams,
  ProviderCapabilities,
  ProviderConfig,
  StopReason,
  LLMStreamEvent,
  TokenUsage,
} from './types.js';
import { getTextContent } from './types.js';
import { sanitizeMessages } from './base.js';

// ============================================================
// OpenAI wire-format types (internal)
// ============================================================

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null | Array<Record<string, unknown>>;
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
 * 将内部 LLMMessage 数组转换为 OpenAI 格式。
 * tool 角色的消息展开为多条独立的 tool 消息（每个 toolResult 一条）。
 */
function toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: 'tool',
            content: tr.output,
            tool_call_id: tr.toolCallId,
          });
        }
      } else {
        result.push({
          role: 'tool',
          content: getTextContent(msg.content) ?? '',
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
          type: 'function' as const,
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

    // user 消息 — 支持多模态内容块
    if (Array.isArray(msg.content)) {
      const parts = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        }
        if (block.type === 'image') {
          if (block.source.type === 'base64') {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            };
          }
          return { type: 'image_url', image_url: { url: block.source.url } };
        }
        return { type: 'text', text: '' };
      });
      result.push({ role: msg.role as 'user', content: parts });
    } else {
      result.push({
        role: msg.role as 'user' | 'system',
        content: msg.content ?? '',
      });
    }
  }

  return result;
}

function toOpenAITools(tools: LLMToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
}

// ============================================================
// CompatProvider
// ============================================================

export class CompatProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;
  readonly defaultModel?: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error('apiKey is required');
    }
    if (!config.apiBase) {
      throw new Error('apiBase is required for compat provider');
    }
    this.apiKey = config.apiKey;
    this.apiBase = config.apiBase;
    this.defaultModel = config.defaultModel;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
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
      extra,
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
      stream_options: { include_usage: true },
    };

    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = toOpenAITools(tools);
    }

    if (params.responseFormat) {
      body.response_format = params.responseFormat;
    }

    // 厂商扩展参数（如 Qwen 的 enable_thinking）
    if (extra) {
      Object.assign(body, extra);
    }

    const res = await fetch(`${this.apiBase}/chat/completions`, {
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
      throw new Error(`API error ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error('Stream response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 按 index 跟踪进行中的 tool call
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
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice('data:'.length).trim();

          if (data === '[DONE]') {
            // 关闭所有未结束的 tool call
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
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
            error?: { message?: string };
          };

          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          // 处理流内 API 错误
          if (chunk.error) {
            const errMsg =
              chunk.error.message || JSON.stringify(chunk.error);
            yield {
              type: 'error',
              error: new Error(errMsg),
              message: errMsg,
            };
            continue;
          }

          // 捕获 usage
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

            // reasoning/thinking delta（Qwen3、DeepSeek 等）
            if (delta.reasoning_content) {
              yield {
                type: 'thinking_delta',
                delta: delta.reasoning_content,
              };
            }

            // 文本 delta
            if (delta.content) {
              yield { type: 'text_delta', delta: delta.content };
            }

            // tool call deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;

                if (tc.id && tc.function?.name) {
                  // 首个 chunk — 发出 tool_use_start
                  toolCallStates.set(idx, {
                    toolCallId: tc.id,
                    name: tc.function.name,
                  });
                  yield {
                    type: 'tool_use_start',
                    toolCallId: tc.id,
                    name: tc.function.name,
                  };
                  // 部分 provider 首个 chunk 就包含完整 arguments
                  if (tc.function.arguments) {
                    yield {
                      type: 'tool_use_delta',
                      toolCallId: tc.id,
                      delta: tc.function.arguments,
                    };
                  }
                } else if (tc.function?.arguments) {
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

    // 流非正常结束（如中断），仍需关闭 tool call 并发出 done
    for (const [, state] of toolCallStates) {
      yield { type: 'tool_use_end', toolCallId: state.toolCallId };
    }

    const stopReason = mapFinishReason(lastFinishReason ?? 'stop');
    yield { type: 'done', stopReason };
  }
}
