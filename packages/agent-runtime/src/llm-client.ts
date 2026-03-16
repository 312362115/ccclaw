/**
 * LLM Client — 封装 Anthropic API 调用
 *
 * 功能：指数退避重试、空内容消毒、结果截断。
 * 瞬态错误（429/5xx/timeout/connection）自动重试，非瞬态直接抛出。
 */

// ====== Types ======

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: LLMToolCall[];
  tool_use_id?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
}

export interface LLMCallParams {
  model?: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
}

// ====== Constants ======

const RETRY_DELAYS = [1000, 2000, 4000];
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// ====== LLMClient ======

export class LLMClient {
  private apiKey: string;
  private apiBase: string;
  private defaultModel: string;

  constructor(options: {
    apiKey: string;
    apiBase?: string;
    defaultModel?: string;
  }) {
    this.apiKey = options.apiKey;
    this.apiBase = options.apiBase ?? 'https://api.anthropic.com';
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  /** 调用 LLM（含自动重试） */
  async call(params: LLMCallParams): Promise<LLMResponse> {
    return callWithRetry(() => this.rawCall(params));
  }

  private async rawCall(params: LLMCallParams): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: params.model ?? this.defaultModel,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: params.systemPrompt,
      messages: this.buildMessages(params.messages),
    };

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools?.length) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema ?? { type: 'object', properties: {} },
      }));
    }

    const res = await fetch(`${this.apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new LLMError(`API error ${res.status}: ${text}`, res.status);
      throw err;
    }

    const data = (await res.json()) as AnthropicResponse;
    return this.parseResponse(data);
  }

  /** 将内部消息格式转为 Anthropic API 格式 */
  private buildMessages(messages: LLMMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'tool') {
        // tool result
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_use_id ?? '',
            content: sanitizeContent(msg.content),
          }],
        });
      } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // assistant with tool_use
        const content: AnthropicContentBlock[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.params,
          });
        }
        result.push({ role: 'assistant', content });
      } else {
        result.push({
          role: msg.role as 'user' | 'assistant',
          content: sanitizeContent(msg.content),
        });
      }
    }

    return result;
  }

  /** 解析 Anthropic API 响应 */
  private parseResponse(data: AnthropicResponse): LLMResponse {
    let content = '';
    const toolCalls: LLMToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          name: block.name ?? '',
          params: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      stopReason: data.stop_reason ?? 'end_turn',
    };
  }
}

// ====== Retry Logic ======

export class LLMError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof LLMError && err.statusCode) {
    // 429 Too Many Requests, 5xx Server Errors
    return err.statusCode === 429 || err.statusCode >= 500;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('aborted')
    );
  }
  return false;
}

export async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS.length && isTransientError(err)) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====== Content Sanitization ======

/** 确保内容非空（Anthropic API 拒绝空字符串） */
export function sanitizeContent(content: string): string {
  if (!content || content.trim() === '') return '(empty)';
  return content;
}

// ====== Anthropic API Types ======

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}
