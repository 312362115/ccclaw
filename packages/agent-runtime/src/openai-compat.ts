/**
 * OpenAI 兼容协议转换层
 *
 * 将 OpenAI ChatCompletion 请求转换为内部 AgentRequest，
 * 将内部 AgentStreamEvent 转换为 OpenAI SSE 响应。
 * 工具调用对外不可见，只返回最终文本。
 */

import type { AgentStreamEvent } from './llm/types.js';

// ====== OpenAI 请求类型 ======

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

// ====== OpenAI 响应类型 ======

export interface OpenAIChatChoice {
  index: number;
  message?: { role: string; content: string };
  delta?: { role?: string; content?: string };
  finish_reason: string | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ====== 请求解析 ======

export function parseOpenAIRequest(body: unknown): { messages: OpenAIChatMessage[]; stream: boolean; maxTokens?: number; temperature?: number; model?: string } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' };
  }

  const req = body as Record<string, unknown>;
  const messages = req.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages array is required and must not be empty' };
  }

  // 提取最后一条 user 消息作为 Agent 输入
  for (const msg of messages) {
    if (!msg.role || typeof msg.content !== 'string') {
      return { error: 'Each message must have role and content fields' };
    }
  }

  return {
    messages: messages as OpenAIChatMessage[],
    stream: req.stream === true,
    maxTokens: typeof req.max_tokens === 'number' ? req.max_tokens : undefined,
    temperature: typeof req.temperature === 'number' ? req.temperature : undefined,
    model: typeof req.model === 'string' ? req.model : undefined,
  };
}

/** 从 OpenAI messages 中提取最后一条 user 消息 */
export function extractUserMessage(messages: OpenAIChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return messages[messages.length - 1].content;
}

// ====== SSE 响应生成 ======

let completionCounter = 0;

function nextCompletionId(): string {
  return `chatcmpl-${Date.now()}-${++completionCounter}`;
}

/** 生成 SSE data 行 */
export function sseChunk(id: string, model: string, delta: { role?: string; content?: string }, finishReason: string | null): string {
  const chunk: OpenAIChatResponse = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
    }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** SSE 结束标记 */
export function sseDone(): string {
  return 'data: [DONE]\n\n';
}

// ====== 非流式响应生成 ======

export function nonStreamingResponse(id: string, model: string, content: string, inputTokens: number, outputTokens: number): OpenAIChatResponse {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// ====== 事件过滤 — 只输出文本，隐藏工具调用 ======

/** 判断一个 Agent 事件是否应该对外输出（只暴露文本） */
export function shouldEmitToClient(event: AgentStreamEvent): { type: 'text'; text: string } | { type: 'done'; inputTokens: number; outputTokens: number } | null {
  switch (event.type) {
    case 'text_delta':
      return { type: 'text', text: event.delta };
    case 'session_done':
      return { type: 'done', inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens };
    // 以下事件对外不可见
    case 'tool_use_start':
    case 'tool_use_delta':
    case 'tool_use_end':
    case 'tool_result':
    case 'confirm_request':
    case 'thinking_delta':
    case 'subagent_started':
    case 'subagent_result':
    case 'consolidation':
    case 'plan_mode':
    case 'usage':
    case 'done':
    case 'error':
      return null;
    default:
      return null;
  }
}

export { nextCompletionId };
