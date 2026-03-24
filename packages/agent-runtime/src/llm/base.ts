/**
 * BaseLLMProvider shared utility functions.
 *
 * Provides shared retry, message sanitization, and image-stripping logic
 * for use across all LLM provider implementations.
 */

import type { LLMMessage } from './types.js';
import { getTextContent } from './types.js';

// ====== Constants ======

const RETRY_DELAYS = [1000, 2000, 4000];

// ====== Transient Error Detection ======

/**
 * Returns true if the error is transient (retryable).
 * Transient patterns: 429, rate limit, overloaded, 500, 502, 503, 504,
 * timeout, timed out, connection, temporarily unavailable.
 */
export function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();

  // Check for HTTP status codes embedded in the message
  if (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    return true;
  }

  // Check for descriptive transient patterns
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
 * Retries an async function with exponential backoff.
 * Max 3 retries (4 total attempts). Delays: [1000, 2000, 4000]ms.
 * Only retries on transient errors; non-transient errors are thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (attempt < RETRY_DELAYS.length && isTransientError(error)) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }

      throw error;
    }
  }

  // Should never be reached, but TypeScript requires it
  throw lastError ?? new Error('withRetry: unknown error');
}

// ====== Message Sanitization ======

/**
 * Fixes empty content issues in message arrays:
 * - Assistant message with toolCalls but empty/no content → content = null
 * - Assistant message with no toolCalls and empty/no content → content = '(empty)'
 * - Other messages pass through unchanged
 */
export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  // Step 1: Fix empty content in assistant messages
  const fixed = messages.map((msg) => {
    if (msg.role !== 'assistant') {
      return msg;
    }

    const textContent = getTextContent(msg.content);
    const isEmpty = !textContent || textContent.trim() === '';

    if (!isEmpty) {
      return msg;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant with tool calls: content should be null (not an empty string)
      return { ...msg, content: null as unknown as string };
    }

    // Assistant without tool calls: replace empty with placeholder
    return { ...msg, content: '(empty)' };
  });

  // Step 2: Remove orphan tool messages (tool messages not preceded by assistant with tool_calls)
  // This prevents API errors like "messages with role tool must be a response to a preceding message with tool_calls"
  const result: LLMMessage[] = [];
  for (let i = 0; i < fixed.length; i++) {
    const msg = fixed[i];
    if (msg.role === 'tool') {
      // Check if previous message in result is an assistant with tool_calls
      const prev = result[result.length - 1];
      if (!prev || prev.role !== 'assistant' || !prev.toolCalls || prev.toolCalls.length === 0) {
        // Orphan tool message — skip it
        continue;
      }
    }
    result.push(msg);
  }

  return result;
}

// ====== Image Content Stripping ======

/** Regex that matches base64-encoded image data URIs */
const BASE64_IMAGE_RE = /data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/]+=*/g;

/**
 * Strips image content from messages.
 * Handles both string content (base64 data URIs) and ContentBlock[] (image blocks).
 * Used when calling non-vision models.
 */
export function stripImageContent(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((msg) => {
    // ContentBlock[] format: filter out image blocks
    if (Array.isArray(msg.content)) {
      const textOnly = msg.content.filter((b) => b.type === 'text');
      if (textOnly.length === msg.content.length) return msg; // no images
      return { ...msg, content: textOnly.length > 0 ? textOnly : [{ type: 'text' as const, text: '[images removed]' }] };
    }

    // String format: strip base64 data URIs
    if (!msg.content || !BASE64_IMAGE_RE.test(msg.content)) {
      BASE64_IMAGE_RE.lastIndex = 0;
      return msg;
    }

    BASE64_IMAGE_RE.lastIndex = 0;
    const stripped = msg.content.replace(BASE64_IMAGE_RE, '[image removed]');
    return { ...msg, content: stripped };
  });
}
