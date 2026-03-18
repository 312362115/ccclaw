import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TreeHandler } from './tree-handler.js';

describe('TreeHandler', () => {
  let tmpDir: string;
  let handler: TreeHandler;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tree-test-'));
    handler = new TreeHandler(tmpDir);

    // Create a test structure:
    //   src/
    //     index.ts
    //     utils/
    //       helper.ts
    //   README.md
    await mkdir(join(tmpDir, 'src', 'utils'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'index.ts'), 'export {}');
    await writeFile(join(tmpDir, 'src', 'utils', 'helper.ts'), 'export const x = 1;');
    await writeFile(join(tmpDir, 'README.md'), '# Hello');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should list root with depth 1 (no children on dirs)', async () => {
    const result = await handler.list('/', 1);
    expect(result.truncated).toBe(false);
    // directories first, then files
    expect(result.entries[0].name).toBe('src');
    expect(result.entries[0].type).toBe('directory');
    expect(result.entries[0].children).toBeUndefined();
    const readmeName = result.entries.find(e => e.name === 'README.md');
    expect(readmeName).toBeDefined();
    expect(readmeName!.type).toBe('file');
  });

  it('should list root with depth 2 (children loaded)', async () => {
    const result = await handler.list('/', 2);
    expect(result.truncated).toBe(false);
    const src = result.entries.find(e => e.name === 'src');
    expect(src).toBeDefined();
    expect(src!.children).toBeDefined();
    expect(src!.children!.length).toBe(2); // utils/ and index.ts
    // directories first in children
    expect(src!.children![0].name).toBe('utils');
    expect(src!.children![0].type).toBe('directory');
    // utils has no children at depth 2 (utils is depth 2, its children would need depth 3)
    expect(src!.children![0].children).toBeUndefined();
  });

  it('should list a subdirectory', async () => {
    const result = await handler.list('src', 2);
    expect(result.path).toBe('src');
    expect(result.entries.length).toBe(2);
    const utils = result.entries.find(e => e.name === 'utils');
    expect(utils).toBeDefined();
    expect(utils!.children).toBeDefined();
    expect(utils!.children![0].name).toBe('helper.ts');
  });

  it('should truncate at maxEntries', async () => {
    const result = await handler.list('/', 2, 2);
    expect(result.truncated).toBe(true);
    // Total entries should be limited
    const totalCount = countEntries(result.entries);
    expect(totalCount).toBeLessThanOrEqual(2);
  });

  it('should reject path outside workspace', async () => {
    await expect(handler.list('../../etc')).rejects.toThrow();
  });
});

function countEntries(entries: { children?: any[] }[]): number {
  let count = entries.length;
  for (const e of entries) {
    if (e.children) count += countEntries(e.children);
  }
  return count;
}
