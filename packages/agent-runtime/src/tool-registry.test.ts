import { describe, it, expect } from 'vitest';
import { ToolRegistry, castParams } from './tool-registry.js';
import type { Tool, ToolSchema } from './tool-registry.js';

// ====== 辅助工具 ======

function makeTool(name: string, schema?: ToolSchema, result = 'ok'): Tool {
  return {
    name,
    description: `${name} tool`,
    schema,
    async execute() { return result; },
  };
}

function makeErrorTool(name: string, error: string): Tool {
  return {
    name,
    description: `${name} tool`,
    async execute() { throw new Error(error); },
  };
}

// ====== Tests ======

describe('ToolRegistry', () => {
  it('注册和查询工具', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('bash'));
    registry.register(makeTool('file'));

    expect(registry.size).toBe(2);
    expect(registry.has('bash')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
    expect(registry.getToolNames()).toEqual(['bash', 'file']);
  });

  it('注销工具', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('bash'));
    registry.unregister('bash');
    expect(registry.has('bash')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('getDefinitions 返回工具定义', () => {
    const registry = new ToolRegistry();
    const schema: ToolSchema = {
      type: 'object',
      properties: { command: { type: 'string', description: 'cmd' } },
      required: ['command'],
    };
    registry.register(makeTool('bash', schema));

    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      name: 'bash',
      description: 'bash tool',
      schema,
    });
  });

  it('执行工具返回结果', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('echo', undefined, 'hello'));
    const result = await registry.execute('echo', {});
    expect(result).toBe('hello');
  });

  it('执行不存在的工具返回错误提示', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('bash'));
    const result = await registry.execute('unknown', {});
    expect(result).toContain('Error: Unknown tool "unknown"');
    expect(result).toContain('bash');
  });

  it('工具抛出异常返回错误提示', async () => {
    const registry = new ToolRegistry();
    registry.register(makeErrorTool('bad', 'something broke'));
    const result = await registry.execute('bad', {});
    expect(result).toContain('Error: something broke');
    expect(result).toContain('try a different approach');
  });

  it('结果超过 16000 字符时截断', async () => {
    const registry = new ToolRegistry();
    const longResult = 'x'.repeat(20000);
    registry.register(makeTool('long', undefined, longResult));
    const result = await registry.execute('long', {});
    expect(result.length).toBeLessThan(20000);
    expect(result).toContain('...(truncated)');
  });

  it('registerMCP 添加前缀', () => {
    const registry = new ToolRegistry();
    registry.registerMCP('github', [makeTool('list_repos'), makeTool('create_issue')]);
    expect(registry.has('mcp_github_list_repos')).toBe(true);
    expect(registry.has('mcp_github_create_issue')).toBe(true);
    expect(registry.size).toBe(2);
  });
});

describe('castParams', () => {
  const schema: ToolSchema = {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'count' },
      enabled: { type: 'boolean', description: 'flag' },
      tags: { type: 'array', description: 'tags' },
      config: { type: 'object', description: 'config' },
      name: { type: 'string', description: 'name' },
    },
  };

  it('string → number', () => {
    const result = castParams({ count: '42' }, schema);
    expect(result.count).toBe(42);
  });

  it('非数字字符串保持不变', () => {
    const result = castParams({ count: 'abc' }, schema);
    expect(result.count).toBe('abc');
  });

  it('string → boolean', () => {
    expect(castParams({ enabled: 'true' }, schema).enabled).toBe(true);
    expect(castParams({ enabled: 'false' }, schema).enabled).toBe(false);
    expect(castParams({ enabled: 'yes' }, schema).enabled).toBe('yes');
  });

  it('string → array (JSON)', () => {
    const result = castParams({ tags: '["a","b"]' }, schema);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('string → object (JSON)', () => {
    const result = castParams({ config: '{"key":"val"}' }, schema);
    expect(result.config).toEqual({ key: 'val' });
  });

  it('无效 JSON 保持原值', () => {
    const result = castParams({ tags: 'not json' }, schema);
    expect(result.tags).toBe('not json');
  });

  it('已经是正确类型不变', () => {
    const result = castParams({ count: 42, enabled: true, name: 'test' }, schema);
    expect(result).toEqual({ count: 42, enabled: true, name: 'test' });
  });

  it('schema 中不存在的字段保持不变', () => {
    const result = castParams({ unknown: '123' }, schema);
    expect(result.unknown).toBe('123');
  });
});
