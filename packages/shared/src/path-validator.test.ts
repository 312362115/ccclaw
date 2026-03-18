import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePath, validatePathStrict } from './path-validator.js';

describe('validatePath', () => {
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'ccclaw-test-'));
    await mkdir(join(base, 'subdir'), { recursive: true });
    await writeFile(join(base, 'subdir', 'file.txt'), 'hello');
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('should resolve a relative path within base', () => {
    const result = validatePath(base, 'subdir/file.txt');
    expect(result).toBe(join(base, 'subdir/file.txt'));
  });

  it('should reject path traversal with ../', () => {
    expect(() => validatePath(base, '../etc/passwd')).toThrow('路径越界');
  });

  it('should reject absolute path outside base', () => {
    expect(() => validatePath(base, '/etc/passwd')).toThrow('路径越界');
  });

  it('should reject base prefix attack (e.g. /workspace-evil vs /workspace)', () => {
    // Use a base like /tmp/foo, then try to access /tmp/foo-evil/secret
    const shortBase = base; // e.g. /tmp/ccclaw-test-XXXXX
    const evilPath = shortBase + '-evil/secret';
    expect(() => validatePath(shortBase, evilPath)).toThrow('路径越界');
  });

  it('should allow access to the base itself', () => {
    const result = validatePath(base, '.');
    expect(result).toBe(base);
  });
});

describe('validatePathStrict', () => {
  let base: string;
  let outside: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'ccclaw-strict-'));
    outside = await mkdtemp(join(tmpdir(), 'ccclaw-outside-'));
    await mkdir(join(base, 'subdir'), { recursive: true });
    await writeFile(join(base, 'subdir', 'ok.txt'), 'ok');
    await writeFile(join(outside, 'secret.txt'), 'secret');
    // Create symlink inside base pointing outside
    await symlink(join(outside, 'secret.txt'), join(base, 'evil-link'));
    // Create symlink inside base pointing inside
    await symlink(join(base, 'subdir', 'ok.txt'), join(base, 'good-link'));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('should allow regular file access', async () => {
    const result = await validatePathStrict(base, 'subdir/ok.txt');
    expect(result).toBe(join(base, 'subdir', 'ok.txt'));
  });

  it('should reject symlink pointing outside workspace', async () => {
    await expect(validatePathStrict(base, 'evil-link')).rejects.toThrow('符号链接指向工作区外');
  });

  it('should allow symlink pointing inside workspace', async () => {
    const result = await validatePathStrict(base, 'good-link');
    expect(result).toBe(join(base, 'good-link'));
  });

  it('should reject path traversal', async () => {
    await expect(validatePathStrict(base, '../../etc/passwd')).rejects.toThrow('路径越界');
  });

  it('should pass for non-existent file (no symlink check needed)', async () => {
    const result = await validatePathStrict(base, 'nonexistent.txt');
    expect(result).toBe(join(base, 'nonexistent.txt'));
  });
});
