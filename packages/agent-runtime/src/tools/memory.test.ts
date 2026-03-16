import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from '../workspace-db.js';
import { createMemoryTools } from './memory.js';
import type { Tool } from '../tool-registry.js';

let db: WorkspaceDB;
let tools: Tool[];
let tmpDir: string;

function getTool(name: string): Tool {
  return tools.find((t) => t.name === name)!;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
  db = new WorkspaceDB(join(tmpDir, 'test.db'));
  tools = createMemoryTools(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('memory_write', () => {
  it('写入记忆', async () => {
    const result = await getTool('memory_write').execute({
      name: 'test-mem',
      type: 'project',
      content: '这是测试记忆',
    });
    expect(result).toContain('saved');

    const mem = db.getMemory('test-mem');
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe('这是测试记忆');
    expect(mem!.type).toBe('project');
  });

  it('同名覆盖', async () => {
    await getTool('memory_write').execute({ name: 'key', type: 'decision', content: 'v1' });
    await getTool('memory_write').execute({ name: 'key', type: 'decision', content: 'v2' });
    const mem = db.getMemory('key');
    expect(mem!.content).toBe('v2');
  });
});

describe('memory_read', () => {
  it('按名称读取', async () => {
    db.upsertMemory({ name: 'proj-a', type: 'project', content: '项目 A 信息' });
    const result = await getTool('memory_read').execute({ name: 'proj-a' });
    expect(result).toContain('[project] proj-a');
    expect(result).toContain('项目 A 信息');
  });

  it('不存在的记忆返回提示', async () => {
    const result = await getTool('memory_read').execute({ name: 'nonexistent' });
    expect(result).toContain('not found');
  });

  it('不传 name 返回分级索引', async () => {
    db.upsertMemory({ name: 'rule-1', type: 'decision', content: '必须遵守的规则' });
    db.upsertMemory({ name: 'proj-a', type: 'project', content: '项目信息' });
    db.upsertMemory({ name: 'log-1', type: 'log', content: '日志内容' });

    const result = await getTool('memory_read').execute({});
    expect(result).toContain('行为约束');
    expect(result).toContain('rule-1');
    expect(result).toContain('工作区知识');
    expect(result).toContain('proj-a');
    expect(result).toContain('日志');
  });
});

describe('memory_search', () => {
  it('关键词搜索', async () => {
    db.upsertMemory({ name: 'api-design', type: 'project', content: '使用 REST API 设计' });
    db.upsertMemory({ name: 'db-notes', type: 'reference', content: 'PostgreSQL 使用笔记' });

    const result = await getTool('memory_search').execute({ query: 'API' });
    expect(result).toContain('api-design');
    expect(result).toContain('REST API');
  });

  it('无匹配返回提示', async () => {
    const result = await getTool('memory_search').execute({ query: 'nonexistent' });
    expect(result).toContain('No memories matching');
  });
});
