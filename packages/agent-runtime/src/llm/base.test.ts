import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTransientError,
  withRetry,
  sanitizeMessages,
  stripImageContent,
} from './base.js';
import type { LLMMessage } from './types.js';

// ============================================================
// isTransientError
// ============================================================

describe('isTransientError', () => {
  it('returns true for 429 errors', () => {
    expect(isTransientError(new Error('API error 429: Too Many Requests'))).toBe(true);
  });

  it('returns true for 500 errors', () => {
    expect(isTransientError(new Error('API error 500: Internal Server Error'))).toBe(true);
  });

  it('returns true for 502 errors', () => {
    expect(isTransientError(new Error('API error 502: Bad Gateway'))).toBe(true);
  });

  it('returns true for 503 errors', () => {
    expect(isTransientError(new Error('API error 503: Service Unavailable'))).toBe(true);
  });

  it('returns true for 504 errors', () => {
    expect(isTransientError(new Error('API error 504: Gateway Timeout'))).toBe(true);
  });

  it('returns true for rate limit errors', () => {
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('Rate Limit hit'))).toBe(true);
  });

  it('returns true for overloaded errors', () => {
    expect(isTransientError(new Error('Service is overloaded'))).toBe(true);
  });

  it('returns true for timeout errors', () => {
    expect(isTransientError(new Error('Request timeout'))).toBe(true);
    expect(isTransientError(new Error('operation timed out'))).toBe(true);
  });

  it('returns true for connection errors', () => {
    expect(isTransientError(new Error('connection refused'))).toBe(true);
    expect(isTransientError(new Error('connection reset'))).toBe(true);
  });

  it('returns true for temporarily unavailable', () => {
    expect(isTransientError(new Error('service temporarily unavailable'))).toBe(true);
  });

  it('returns false for 401 errors', () => {
    expect(isTransientError(new Error('API error 401: Unauthorized'))).toBe(false);
  });

  it('returns false for 400 errors', () => {
    expect(isTransientError(new Error('API error 400: Bad Request'))).toBe(false);
  });

  it('returns false for 403 errors', () => {
    expect(isTransientError(new Error('API error 403: Forbidden'))).toBe(false);
  });

  it('returns false for 404 errors', () => {
    expect(isTransientError(new Error('API error 404: Not Found'))).toBe(false);
  });

  it('returns false for normal errors', () => {
    expect(isTransientError(new Error('Something went wrong'))).toBe(false);
    expect(isTransientError(new Error('Invalid input'))).toBe(false);
    expect(isTransientError(new Error(''))).toBe(false);
  });
});

// ============================================================
// withRetry
// ============================================================

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns the result when the function succeeds on the first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors and succeeds on second attempt', async () => {
    const transientErr = new Error('API error 503: Service Unavailable');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue('ok');

    const promise = withRetry(fn);
    // Advance past first retry delay (1000ms)
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries up to 3 times and throws after 4 total attempts', async () => {
    const transientErr = new Error('API error 503: overloaded');
    const fn = vi.fn().mockRejectedValue(transientErr);

    const promise = withRetry(fn);
    // Attach rejection handler immediately to avoid unhandled rejection
    const caught = promise.catch((e: Error) => e);

    // Advance past all retry delays: 1000, 2000, 4000
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('API error 503: overloaded');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('throws immediately on non-transient errors without retrying', async () => {
    const nonTransientErr = new Error('API error 401: Unauthorized');
    const fn = vi.fn().mockRejectedValue(nonTransientErr);

    await expect(withRetry(fn)).rejects.toThrow('API error 401: Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 400 Bad Request without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('API error 400: Bad Request'));
    await expect(withRetry(fn)).rejects.toThrow('API error 400: Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// sanitizeMessages
// ============================================================

describe('sanitizeMessages', () => {
  it('sets content to null for assistant messages with toolCalls but empty content', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'myTool', input: {} }],
      },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBeNull();
  });

  it('sets content to null for assistant messages with toolCalls and whitespace-only content', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '   ',
        toolCalls: [{ id: 'tc1', name: 'myTool', input: {} }],
      },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBeNull();
  });

  it('sets content to null when assistant content is missing and toolCalls present', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: undefined as unknown as string,
        toolCalls: [{ id: 'tc1', name: 'myTool', input: {} }],
      },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBeNull();
  });

  it('sets content to "(empty)" for assistant messages with no toolCalls and empty content', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: '' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('(empty)');
  });

  it('sets content to "(empty)" for assistant messages with no toolCalls and whitespace content', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: '  \n  ' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('(empty)');
  });

  it('leaves assistant messages with real content unchanged', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'Hello, world!' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('Hello, world!');
  });

  it('leaves user messages unchanged even with empty content', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: '' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('');
  });

  it('leaves tool messages unchanged', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: '' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('');
  });

  it('handles mixed message arrays correctly', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'search', input: { q: 'test' } }],
      },
      { role: 'tool', content: 'result' },
      { role: 'assistant', content: '' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].content).toBe('Hello');
    expect(result[1].content).toBeNull();
    expect(result[2].content).toBe('result');
    expect(result[3].content).toBe('(empty)');
  });
});

// ============================================================
// stripImageContent
// ============================================================

describe('stripImageContent', () => {
  it('replaces a base64 PNG image with a placeholder', () => {
    const base64Data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const messages: LLMMessage[] = [
      { role: 'user', content: `Here is an image: data:image/png;base64,${base64Data}` },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toContain('[image removed]');
    expect(result[0].content).not.toContain('base64,');
  });

  it('replaces a base64 JPEG image with a placeholder', () => {
    const base64Data = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA==';
    const messages: LLMMessage[] = [
      { role: 'user', content: `data:image/jpeg;base64,${base64Data}` },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toBe('[image removed]');
  });

  it('replaces multiple base64 images in a single message', () => {
    const b64 = 'abc123==';
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: `First: data:image/png;base64,${b64} Second: data:image/gif;base64,${b64}`,
      },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toBe('First: [image removed] Second: [image removed]');
  });

  it('preserves normal text messages without base64 images', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Just a normal text message.' },
      { role: 'assistant', content: 'A reply with no images.' },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toBe('Just a normal text message.');
    expect(result[1].content).toBe('A reply with no images.');
  });

  it('preserves non-image base64-like text that is not a data URI', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Some base64 encoded text: SGVsbG8gV29ybGQ=' },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toBe('Some base64 encoded text: SGVsbG8gV29ybGQ=');
  });

  it('returns message unchanged when content is empty', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: '' },
    ];
    const result = stripImageContent(messages);
    expect(result[0].content).toBe('');
  });

  it('handles messages with no content field gracefully', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: undefined as unknown as string },
    ];
    const result = stripImageContent(messages);
    expect(result[0]).toEqual(messages[0]);
  });
});
