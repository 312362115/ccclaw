import { describe, it, expect } from 'vitest';
import { toCLIFormat, parseToolCallsFromText } from './tool-format.js';
import type { ToolDefinition } from './tool-registry.js';

// ====== toCLIFormat ======

describe('toCLIFormat', () => {
  it('converts a single tool with name + description to one-line format', () => {
    const tools: ToolDefinition[] = [
      { name: 'bash', description: 'Execute shell command' },
    ];
    const output = toCLIFormat(tools);
    expect(output).toContain('bash - Execute shell command');
  });

  it('includes required params in angle brackets', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run' },
          },
          required: ['command'],
        },
      },
    ];
    const output = toCLIFormat(tools);
    expect(output).toContain('bash <command> - Execute shell command');
  });

  it('includes optional params in square brackets', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'grep',
        description: 'Search file contents',
        schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string', description: 'File path' },
          },
          required: ['pattern'],
        },
      },
    ];
    const output = toCLIFormat(tools);
    expect(output).toContain('grep <pattern> [path] - Search file contents');
  });

  it('multiple tools produce multi-line output', () => {
    const tools: ToolDefinition[] = [
      { name: 'bash', description: 'Execute shell command' },
      { name: 'git', description: 'Run git command' },
      { name: 'glob', description: 'Find files by pattern' },
    ];
    const output = toCLIFormat(tools);
    expect(output).toContain('bash - Execute shell command');
    expect(output).toContain('git - Run git command');
    expect(output).toContain('glob - Find files by pattern');
  });

  it('includes the <tool> usage instruction', () => {
    const output = toCLIFormat([]);
    expect(output).toContain('<tool name="tool_name">{"param1": "value1"}</tool>');
    expect(output).toContain('To use a tool, respond with:');
  });

  it('starts with ## Available Tools header', () => {
    const output = toCLIFormat([]);
    expect(output).toMatch(/^## Available Tools/);
  });
});

// ====== parseToolCallsFromText ======

describe('parseToolCallsFromText', () => {
  it('parses a single XML-format tool call', () => {
    const text = '<tool name="bash">{"command": "ls"}</tool>';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('bash');
    expect(calls[0].input).toEqual({ command: 'ls' });
  });

  it('parses multiple <tool> tags', () => {
    const text = [
      '<tool name="bash">{"command": "ls -la"}</tool>',
      'some text in between',
      '<tool name="git">{"args": "status"}</tool>',
    ].join('\n');
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('bash');
    expect(calls[1].name).toBe('git');
    expect(calls[1].input).toEqual({ args: 'status' });
  });

  it('parses ```tool JSON block format', () => {
    const text = '```tool\n{"name":"bash","input":{"command":"ls"}}\n```';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('bash');
    expect(calls[0].input).toEqual({ command: 'ls' });
  });

  it('parses multiple ```tool blocks', () => {
    const text = [
      '```tool',
      '{"name":"bash","input":{"command":"ls"}}',
      '```',
      'some text',
      '```tool',
      '{"name":"glob","input":{"pattern":"**/*.ts"}}',
      '```',
    ].join('\n');
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('bash');
    expect(calls[1].name).toBe('glob');
    expect(calls[1].input).toEqual({ pattern: '**/*.ts' });
  });

  it('returns empty array for plain text (no tool calls)', () => {
    const text = 'This is just a plain text response with no tool calls.';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseToolCallsFromText('')).toEqual([]);
  });

  it('handles malformed JSON gracefully — returns empty array for that call', () => {
    const text = '<tool name="bash">{invalid json}</tool>';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('skips malformed JSON but still parses valid calls', () => {
    const text = [
      '<tool name="bash">{bad json}</tool>',
      '<tool name="git">{"args": "log"}</tool>',
    ].join('\n');
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('git');
  });

  it('self-closing <tool name="bash" /> is NOT a valid format', () => {
    const text = '<tool name="bash" />';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('handles tool call with nested JSON object params', () => {
    const text = '<tool name="memory_write">{"name": "ctx", "type": "session", "content": {"key": "val"}}</tool>';
    const calls = parseToolCallsFromText(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({ name: 'ctx', type: 'session', content: { key: 'val' } });
  });

  it('ignores ```tool block missing name field', () => {
    const text = '```tool\n{"input":{"command":"ls"}}\n```';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });

  it('ignores ```tool block missing input field', () => {
    const text = '```tool\n{"name":"bash"}\n```';
    const calls = parseToolCallsFromText(text);
    expect(calls).toEqual([]);
  });
});
