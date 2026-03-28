import { describe, it, expect } from 'vitest';
import { createProvider } from '../providers/factory.js';
import { CompatProvider } from '../providers/compat.js';
import { isTransientError, withRetry, sanitizeMessages, stripImageContent } from '../providers/base.js';
import type { LLMMessage } from '../providers/types.js';

// ============================================================
// factory
// ============================================================

describe('createProvider', () => {
  it('创建 CompatProvider 实例', () => {
    const provider = createProvider({
      type: 'compat',
      apiKey: 'test-key',
      apiBase: 'https://api.example.com/v1',
    });
    expect(provider).toBeInstanceOf(CompatProvider);
  });

  it('缺少 apiKey 时抛出错误', () => {
    expect(() =>
      createProvider({
        type: 'compat',
        apiKey: '',
        apiBase: 'https://api.example.com/v1',
      }),
    ).toThrow('apiKey is required');
  });

  it('缺少 apiBase 时抛出错误', () => {
    expect(() =>
      createProvider({
        type: 'compat',
        apiKey: 'test-key',
      }),
    ).toThrow('apiBase is required');
  });
});

// ============================================================
// capabilities
// ============================================================

describe('CompatProvider.capabilities', () => {
  it('返回保守默认值', () => {
    const provider = createProvider({
      type: 'compat',
      apiKey: 'test-key',
      apiBase: 'https://api.example.com/v1',
    });
    const caps = provider.capabilities();
    expect(caps.streaming).toBe(true);
    expect(caps.toolUse).toBe(true);
    expect(caps.extendedThinking).toBe(false);
    expect(caps.vision).toBe(false);
    expect(caps.contextWindow).toBe(128000);
    expect(caps.maxOutputTokens).toBe(4096);
  });
});

// ============================================================
// base utilities
// ============================================================

describe('isTransientError', () => {
  it('识别 429 为瞬时错误', () => {
    expect(isTransientError(new Error('status 429'))).toBe(true);
  });

  it('识别 rate limit 为瞬时错误', () => {
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('识别 502 为瞬时错误', () => {
    expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
  });

  it('识别 timeout 为瞬时错误', () => {
    expect(isTransientError(new Error('request timed out'))).toBe(true);
  });

  it('非瞬时错误返回 false', () => {
    expect(isTransientError(new Error('invalid api key'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('成功时直接返回', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('非瞬时错误立即抛出', async () => {
    await expect(
      withRetry(() => Promise.reject(new Error('auth failed'))),
    ).rejects.toThrow('auth failed');
  });
});

describe('sanitizeMessages', () => {
  it('空 content 的 assistant 消息补为 (empty)', () => {
    const msgs: LLMMessage[] = [
      { role: 'assistant', content: '' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBe('(empty)');
  });

  it('有 toolCalls 的 assistant 空 content 设为 null', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '1', name: 'test', input: {} }],
      },
    ];
    const result = sanitizeMessages(msgs);
    expect(result[0].content).toBeNull();
  });

  it('移除孤立的 tool 消息', () => {
    const msgs: LLMMessage[] = [
      { role: 'tool', content: 'orphan', toolResults: [{ toolCallId: '1', output: 'x' }] },
      { role: 'user', content: 'hello' },
    ];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });
});

describe('stripImageContent', () => {
  it('过滤 ContentBlock[] 中的 image 块', () => {
    const msgs: LLMMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
    ];
    const result = stripImageContent(msgs);
    expect(Array.isArray(result[0].content)).toBe(true);
    const blocks = result[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });

  it('替换 string 中的 base64 data URI', () => {
    const msgs: LLMMessage[] = [
      { role: 'user', content: 'see data:image/png;base64,AAAA== here' },
    ];
    const result = stripImageContent(msgs);
    expect(result[0].content).toBe('see [image removed] here');
  });
});
