import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessagesTokens, estimateSessionTokens } from './token-estimator.js';

describe('estimateTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯英文：约 4 chars/token', () => {
    // 16 个 ASCII 字符 → 16 * 0.25 = 4 tokens
    const tokens = estimateTokens('hello world test');
    expect(tokens).toBe(4);
  });

  it('纯中文：约 2 chars/token', () => {
    // 4 个中文字符 → 4 * 0.5 = 2 tokens
    const tokens = estimateTokens('你好世界');
    expect(tokens).toBe(2);
  });

  it('中英混合', () => {
    // "hello" = 5 * 0.25 = 1.25, "你好" = 2 * 0.5 = 1.0 → ceil(2.25) = 3
    const tokens = estimateTokens('hello你好');
    expect(tokens).toBe(3);
  });

  it('长文本不为 0', () => {
    const longText = 'a'.repeat(10000);
    expect(estimateTokens(longText)).toBe(2500); // 10000 * 0.25
  });
});

describe('estimateMessagesTokens', () => {
  it('空消息数组返回 0', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('单条消息包含 overhead', () => {
    const tokens = estimateMessagesTokens([{ role: 'user', content: '' }]);
    expect(tokens).toBe(4); // 0 content + 4 overhead
  });

  it('多条消息累加', () => {
    const messages = [
      { role: 'user', content: 'hello world test' }, // 4 + 4 = 8
      { role: 'assistant', content: '你好世界' },     // 2 + 4 = 6
    ];
    expect(estimateMessagesTokens(messages)).toBe(14);
  });
});

describe('estimateSessionTokens', () => {
  it('组合估算', () => {
    const systemPrompt = 'You are a helpful assistant'; // 28 * 0.25 = 7
    const memories = ['记忆一'];                          // 3 * 0.5 = 1.5 → ceil = 2
    const messages = [{ role: 'user', content: 'hi' }]; // ceil(2*0.25) + 4 = 1 + 4 = 5
    const total = estimateSessionTokens(systemPrompt, memories, messages);
    expect(total).toBe(7 + 2 + 5);
  });
});
