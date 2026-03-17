import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent.js';

describe('classifyIntent', () => {
  it('/stop returns stop', () => expect(classifyIntent('/stop')).toBe('stop'));
  it('/cancel returns stop', () => expect(classifyIntent('/cancel')).toBe('stop'));
  it('停止 returns stop', () => expect(classifyIntent('停止')).toBe('stop'));
  it('取消 returns stop', () => expect(classifyIntent('取消')).toBe('stop'));
  it('/retry returns correction', () => expect(classifyIntent('/retry')).toBe('correction'));
  it('/redo returns correction', () => expect(classifyIntent('/redo')).toBe('correction'));
  it('重来 returns correction', () => expect(classifyIntent('重来')).toBe('correction'));
  it('重试 returns correction', () => expect(classifyIntent('重试')).toBe('correction'));
  it('normal message returns continue', () => expect(classifyIntent('写一个函数')).toBe('continue'));
  it('重新设计组件 returns continue (not correction)', () => expect(classifyIntent('重新设计组件')).toBe('continue'));
  it('不对称加密 returns continue (not correction)', () => expect(classifyIntent('不对称加密')).toBe('continue'));
  it('whitespace trimmed', () => expect(classifyIntent('  /stop  ')).toBe('stop'));
  it('case insensitive', () => expect(classifyIntent('/STOP')).toBe('stop'));
  it('empty string returns continue', () => expect(classifyIntent('')).toBe('continue'));
});
