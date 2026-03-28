/**
 * 共享工具函数：重试、消息清洗、图片剥离。
 * 供所有 LLM provider 实现复用。
 */

import type { LLMMessage } from './types.js';
import { getTextContent } from './types.js';

// ====== Constants ======

const RETRY_DELAYS = [1000, 2000, 4000];

// ====== Transient Error Detection ======

/**
 * 判断错误是否为瞬时错误（可重试）。
 * 匹配模式：429、500-504、rate limit、overloaded、timeout、connection 等。
 */
export function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();

  if (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    return true;
  }

  if (
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('connection') ||
    msg.includes('temporarily unavailable')
  ) {
    return true;
  }

  return false;
}

// ====== Retry with Exponential Backoff ======

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数退避重试。最多重试 maxRetries 次，延迟 [1s, 2s, 4s]。
 * 仅对瞬时错误重试，非瞬时错误立即抛出。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: Error | undefined;
  const delays = RETRY_DELAYS.slice(0, maxRetries);

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (attempt < delays.length && isTransientError(error)) {
        await sleep(delays[attempt]);
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error('withRetry: unknown error');
}

// ====== Message Sanitization ======

/**
 * 修复消息数组中的空 content 问题：
 * - assistant 有 toolCalls 但 content 为空 → content = null
 * - assistant 无 toolCalls 且 content 为空 → content = '(empty)'
 * - 清除孤立的 tool 消息（前面没有带 toolCalls 的 assistant 消息）
 */
export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  const fixed = messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;

    const textContent = getTextContent(msg.content);
    const isEmpty = !textContent || textContent.trim() === '';
    if (!isEmpty) return msg;

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return { ...msg, content: null as unknown as string };
    }

    return { ...msg, content: '(empty)' };
  });

  // 移除孤立的 tool 消息
  const result: LLMMessage[] = [];
  for (const msg of fixed) {
    if (msg.role === 'tool') {
      const prev = result[result.length - 1];
      if (
        !prev ||
        prev.role !== 'assistant' ||
        !prev.toolCalls ||
        prev.toolCalls.length === 0
      ) {
        continue;
      }
    }
    result.push(msg);
  }

  return result;
}

// ====== Image Content Stripping ======

const BASE64_IMAGE_RE = /data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/]+=*/g;

/**
 * 剥离消息中的图片内容。
 * 处理 ContentBlock[]（过滤 image 块）和 string（替换 base64 data URI）两种格式。
 * 用于调用不支持 vision 的模型时。
 */
export function stripImageContent(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((msg) => {
    if (Array.isArray(msg.content)) {
      const textOnly = msg.content.filter((b) => b.type === 'text');
      if (textOnly.length === msg.content.length) return msg;
      return {
        ...msg,
        content:
          textOnly.length > 0
            ? textOnly
            : [{ type: 'text' as const, text: '[images removed]' }],
      };
    }

    if (!msg.content || !BASE64_IMAGE_RE.test(msg.content)) {
      BASE64_IMAGE_RE.lastIndex = 0;
      return msg;
    }

    BASE64_IMAGE_RE.lastIndex = 0;
    const stripped = msg.content.replace(BASE64_IMAGE_RE, '[image removed]');
    return { ...msg, content: stripped };
  });
}
