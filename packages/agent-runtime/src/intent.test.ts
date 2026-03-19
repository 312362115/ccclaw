import { describe, it, expect } from 'vitest';
import { classifyIntent, isInPlanMode, exitPlanMode } from './intent.js';

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

  // Plan 模式测试
  it('/plan returns plan', () => expect(classifyIntent('/plan', 's1')).toBe('plan'));
  it('/plan with message returns plan', () => expect(classifyIntent('/plan 重构用户模块', 's2')).toBe('plan'));
  it('plan mode: 执行 triggers plan_execute', () => {
    classifyIntent('/plan', 's3'); // 进入 plan 模式
    expect(isInPlanMode('s3')).toBe(true);
    expect(classifyIntent('执行', 's3')).toBe('plan_execute');
    expect(isInPlanMode('s3')).toBe(false);
  });
  it('plan mode: go triggers plan_execute', () => {
    classifyIntent('/plan', 's4');
    expect(classifyIntent('go', 's4')).toBe('plan_execute');
  });
  it('plan mode: non-confirm stays in plan', () => {
    classifyIntent('/plan', 's5');
    expect(classifyIntent('改一下第三步', 's5')).toBe('plan');
  });
  it('/stop exits plan mode', () => {
    classifyIntent('/plan', 's6');
    expect(isInPlanMode('s6')).toBe(true);
    classifyIntent('/stop', 's6');
    expect(isInPlanMode('s6')).toBe(false);
  });
});
