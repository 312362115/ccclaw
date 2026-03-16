import { describe, it, expect } from 'vitest';
import {
  isTransientError,
  callWithRetry,
  sanitizeContent,
  LLMError,
} from './llm-client.js';

describe('isTransientError', () => {
  it('429 是瞬态错误', () => {
    expect(isTransientError(new LLMError('rate limit', 429))).toBe(true);
  });

  it('500 是瞬态错误', () => {
    expect(isTransientError(new LLMError('server error', 500))).toBe(true);
  });

  it('503 是瞬态错误', () => {
    expect(isTransientError(new LLMError('service unavailable', 503))).toBe(true);
  });

  it('400 不是瞬态错误', () => {
    expect(isTransientError(new LLMError('bad request', 400))).toBe(false);
  });

  it('401 不是瞬态错误', () => {
    expect(isTransientError(new LLMError('unauthorized', 401))).toBe(false);
  });

  it('timeout 错误是瞬态', () => {
    expect(isTransientError(new Error('The operation was aborted due to timeout'))).toBe(true);
  });

  it('连接重置是瞬态', () => {
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
  });

  it('普通错误不是瞬态', () => {
    expect(isTransientError(new Error('some logic error'))).toBe(false);
  });

  it('非 Error 对象不是瞬态', () => {
    expect(isTransientError('string error')).toBe(false);
  });
});

describe('callWithRetry', () => {
  it('成功直接返回', async () => {
    const result = await callWithRetry(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('非瞬态错误直接抛出不重试', async () => {
    let calls = 0;
    await expect(
      callWithRetry(async () => {
        calls++;
        throw new LLMError('bad request', 400);
      }),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('瞬态错误重试后成功', async () => {
    let calls = 0;
    const result = await callWithRetry(async () => {
      calls++;
      if (calls < 3) throw new LLMError('rate limit', 429);
      return 'success';
    });
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('超过最大重试次数抛出', async () => {
    let calls = 0;
    await expect(
      callWithRetry(async () => {
        calls++;
        throw new LLMError('always failing', 500);
      }),
    ).rejects.toThrow('always failing');
    expect(calls).toBe(4); // 1 initial + 3 retries
  }, 15_000);
});

describe('sanitizeContent', () => {
  it('正常内容不变', () => {
    expect(sanitizeContent('hello')).toBe('hello');
  });

  it('空字符串替换为 (empty)', () => {
    expect(sanitizeContent('')).toBe('(empty)');
  });

  it('仅空白替换为 (empty)', () => {
    expect(sanitizeContent('   ')).toBe('(empty)');
  });
});
