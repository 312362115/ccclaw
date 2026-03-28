import { describe, it, expect } from 'vitest';
import { parseToolCallsFromText, toCLIFormat } from '../tools/format.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Tool, ToolDefinition } from '../tools/types.js';

// ====== parseToolCallsFromText ======

describe('parseToolCallsFromText', () => {
  it('解析 XML 格式工具调用', () => {
    const text = '<tool name="search">{"query": "test"}</tool>';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'search', input: { query: 'test' } }]);
  });

  it('解析 JSON block 格式工具调用', () => {
    const text = '```tool\n{"name": "search", "input": {"query": "test"}}\n```';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'search', input: { query: 'test' } }]);
  });

  it('纯文本返回空数组', () => {
    const text = 'This is just plain text with no tool calls.';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([]);
  });

  it('畸形 JSON 被跳过，不抛异常', () => {
    const text = '<tool name="bad">{not valid json}</tool>';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([]);
  });

  it('混合文本和多个工具调用', () => {
    const text = `Here is some text.
<tool name="read">{"path": "/tmp/a.txt"}</tool>
More text in between.
<tool name="write">{"path": "/tmp/b.txt", "content": "hello"}</tool>`;
    const result = parseToolCallsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('read');
    expect(result[1].name).toBe('write');
  });
});

// ====== toCLIFormat ======

describe('toCLIFormat', () => {
  it('包含工具名和描述', () => {
    const defs: ToolDefinition[] = [
      { name: 'search', description: 'Search for files' },
    ];
    const output = toCLIFormat(defs);
    expect(output).toContain('search');
    expect(output).toContain('Search for files');
  });

  it('展示使用格式说明', () => {
    const defs: ToolDefinition[] = [
      { name: 'bash', description: 'Run a command' },
    ];
    const output = toCLIFormat(defs);
    expect(output).toContain('<tool name="tool_name">');
  });

  it('展示必填和可选参数', () => {
    const defs: ToolDefinition[] = [
      {
        name: 'bash',
        description: 'Run a command',
        schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The command' },
            timeout: { type: 'number', description: 'Timeout in ms' },
          },
          required: ['command'],
        },
      },
    ];
    const output = toCLIFormat(defs);
    expect(output).toContain('<command>');
    expect(output).toContain('[timeout]');
  });
});

// ====== ToolRegistry ======

describe('ToolRegistry', () => {
  function makeTool(name: string, handler: (input: Record<string, unknown>) => Promise<string>): Tool {
    return {
      name,
      description: `Tool: ${name}`,
      execute: handler,
    };
  }

  it('register + execute 正常工作', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('echo', async (input) => `Echo: ${input.msg}`));

    const result = await registry.execute('echo', { msg: 'hello' });
    expect(result).toBe('Echo: hello');
  });

  it('未知工具返回错误字符串', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nonexistent', {});
    expect(result).toContain('Error');
    expect(result).toContain('Unknown tool');
    expect(result).toContain('nonexistent');
  });

  it('结果超过 16K 字符时截断', async () => {
    const registry = new ToolRegistry();
    const longString = 'x'.repeat(20_000);
    registry.register(makeTool('long', async () => longString));

    const result = await registry.execute('long', {});
    expect(result.length).toBeLessThan(20_000);
    expect(result).toContain('...(truncated)');
  });

  it('工具执行异常返回错误字符串而非抛出', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('fail', async () => { throw new Error('boom'); }));

    const result = await registry.execute('fail', {});
    expect(result).toContain('Error');
    expect(result).toContain('boom');
  });

  it('has / unregister / getToolNames / getDefinitions', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a', async () => 'ok'));
    registry.register(makeTool('b', async () => 'ok'));

    expect(registry.has('a')).toBe(true);
    expect(registry.has('c')).toBe(false);
    expect(registry.getToolNames()).toEqual(['a', 'b']);
    expect(registry.getDefinitions()).toHaveLength(2);

    registry.unregister('a');
    expect(registry.has('a')).toBe(false);
    expect(registry.size).toBe(1);
  });
});
