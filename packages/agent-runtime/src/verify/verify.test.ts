import { describe, it, expect } from 'vitest';
import { VerifierRegistry, formatVerifyFeedback } from './index.js';
import { createJsonVerifier, createBracketVerifier } from './generic.js';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = join(tmpdir(), 'ccclaw-verify-test');

// 确保临时目录存在
try { mkdirSync(TMP, { recursive: true }); } catch {}

describe('VerifierRegistry', () => {
  it('无验证器时直接通过', async () => {
    const vr = new VerifierRegistry();
    const result = await vr.verify('write', {}, 'ok');
    expect(result.passed).toBe(true);
  });

  it('注册验证器后对匹配工具运行', async () => {
    const vr = new VerifierRegistry();
    vr.register(['write'], async () => ({
      passed: false,
      errors: ['test error'],
    }));

    const result = await vr.verify('write', {}, 'ok');
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('test error');
  });

  it('不匹配的工具不运行验证器', async () => {
    const vr = new VerifierRegistry();
    vr.register(['write'], async () => ({
      passed: false,
      errors: ['should not run'],
    }));

    const result = await vr.verify('read', {}, 'ok');
    expect(result.passed).toBe(true);
  });

  it('通配符 * 匹配所有工具', async () => {
    const vr = new VerifierRegistry();
    vr.register(['*'], async () => ({
      passed: false,
      errors: ['wildcard hit'],
    }));

    const result = await vr.verify('bash', {}, 'ok');
    expect(result.passed).toBe(false);
  });

  it('验证器抛异常时视为通过', async () => {
    const vr = new VerifierRegistry();
    vr.register(['write'], async () => {
      throw new Error('boom');
    });

    const result = await vr.verify('write', {}, 'ok');
    expect(result.passed).toBe(true);
  });

  it('多个验证器错误合并', async () => {
    const vr = new VerifierRegistry();
    vr.register(['write'], async () => ({ passed: false, errors: ['err1'] }));
    vr.register(['write'], async () => ({ passed: false, errors: ['err2'] }));

    const result = await vr.verify('write', {}, 'ok');
    expect(result.errors).toEqual(['err1', 'err2']);
  });
});

describe('formatVerifyFeedback', () => {
  it('通过时返回空字符串', () => {
    expect(formatVerifyFeedback({ passed: true, errors: [] })).toBe('');
  });

  it('失败时格式化错误列表', () => {
    const feedback = formatVerifyFeedback({
      passed: false,
      errors: ['类型错误: string 不能赋值给 number', '缺少分号'],
    });
    expect(feedback).toContain('⚠️');
    expect(feedback).toContain('1. 类型错误');
    expect(feedback).toContain('2. 缺少分号');
  });
});

describe('JSON 验证器', () => {
  const verifier = createJsonVerifier();

  it('合法 JSON 通过', async () => {
    const file = join(TMP, 'valid.json');
    writeFileSync(file, '{"name": "test"}');
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(true);
    unlinkSync(file);
  });

  it('非法 JSON 报错', async () => {
    const file = join(TMP, 'invalid.json');
    writeFileSync(file, '{name: test}');
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('JSON');
    unlinkSync(file);
  });

  it('非 JSON 文件跳过', async () => {
    const result = await verifier('write', { file_path: '/tmp/test.ts' }, 'ok');
    expect(result.passed).toBe(true);
  });
});

describe('括号匹配验证器', () => {
  const verifier = createBracketVerifier();

  it('正常代码通过', async () => {
    const file = join(TMP, 'ok.ts');
    writeFileSync(file, 'function foo() { return [1, 2]; }');
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(true);
    unlinkSync(file);
  });

  it('多余右括号报错', async () => {
    const file = join(TMP, 'extra.ts');
    writeFileSync(file, 'function foo() { return 1; }}');
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('括号不匹配');
    unlinkSync(file);
  });

  it('未闭合括号报错', async () => {
    const file = join(TMP, 'unclosed.ts');
    writeFileSync(file, 'function foo() { return [1, 2];');
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('未闭合');
    unlinkSync(file);
  });

  it('字符串中的括号不影响', async () => {
    const file = join(TMP, 'string.ts');
    writeFileSync(file, "const s = 'hello { world }';");
    const result = await verifier('write', { file_path: file }, 'ok');
    expect(result.passed).toBe(true);
    unlinkSync(file);
  });
});
