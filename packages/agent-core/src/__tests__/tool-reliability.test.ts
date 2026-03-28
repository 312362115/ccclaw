import { describe, it, expect } from 'vitest';
import { repairJson, parseToolCallsFromText, looksLikeFailedToolCall } from '../tools/format.js';
import { ToolReliabilityTracker } from '../harness/tool-reliability.js';

// ====== repairJson ======

describe('repairJson', () => {
  it('合法 JSON 原样返回', () => {
    const valid = '{"name": "test", "value": 42}';
    expect(repairJson(valid)).toBe(valid);
  });

  it('修复尾逗号', () => {
    const input = '{"a": 1, "b": 2,}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('修复数组中的尾逗号', () => {
    const input = '{"items": [1, 2, 3,]}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ items: [1, 2, 3] });
  });

  it('修复单引号', () => {
    const input = "{'name': 'test', 'value': 'hello'}";
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 'hello' });
  });

  it('移除块注释', () => {
    const input = '{"a": /* comment */ 1}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('给未加引号的 key 补双引号', () => {
    const input = '{name: "test", value: 42}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });

  it('剥离 markdown ```json 包裹', () => {
    const input = '```json\n{"command": "ls -la"}\n```';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ command: 'ls -la' });
  });

  it('剥离 markdown ``` 包裹（无 json 标识）', () => {
    const input = '```\n{"key": "val"}\n```';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ key: 'val' });
  });

  it('无法修复的内容返回原文', () => {
    const input = 'this is not json at all {{{';
    const result = repairJson(input);
    expect(result).toBe(input);
  });

  it('组合修复：未加引号 key + 尾逗号', () => {
    const input = '{command: "ls", timeout: 1000,}';
    const result = repairJson(input);
    expect(JSON.parse(result)).toEqual({ command: 'ls', timeout: 1000 });
  });
});

// ====== parseToolCallsFromText with repairJson ======

describe('parseToolCallsFromText 模糊修复集成', () => {
  it('修复 XML 格式中的尾逗号 JSON', () => {
    const text = '<tool name="bash">{"command": "ls",}</tool>';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'bash', input: { command: 'ls' } }]);
  });

  it('修复 XML 格式中的单引号 JSON', () => {
    const text = "<tool name=\"search\">{'query': 'test'}</tool>";
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'search', input: { query: 'test' } }]);
  });

  it('修复 XML 格式中未加引号的 key', () => {
    const text = '<tool name="bash">{command: "ls -la"}</tool>';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'bash', input: { command: 'ls -la' } }]);
  });

  it('修复 JSON block 格式中的畸形 JSON', () => {
    const text = '```tool\n{name: "bash", input: {command: "ls",}}\n```';
    const result = parseToolCallsFromText(text);
    expect(result).toEqual([{ name: 'bash', input: { command: 'ls' } }]);
  });
});

// ====== looksLikeFailedToolCall ======

describe('looksLikeFailedToolCall', () => {
  it('包含 <tool 标签时返回 true', () => {
    expect(looksLikeFailedToolCall('我要调用 <tool name="bash">...')).toBe(true);
  });

  it('包含 ```tool 块时返回 true', () => {
    expect(looksLikeFailedToolCall('```tool\n{broken json\n```')).toBe(true);
  });

  it('纯文本返回 false', () => {
    expect(looksLikeFailedToolCall('This is just plain text.')).toBe(false);
  });
});

// ====== ToolReliabilityTracker ======

describe('ToolReliabilityTracker', () => {
  it('初始指标为零', () => {
    const tracker = new ToolReliabilityTracker();
    const m = tracker.getMetrics();
    expect(m.totalCalls).toBe(0);
    expect(m.successfulCalls).toBe(0);
    expect(m.parseErrors).toBe(0);
    expect(m.retriedCalls).toBe(0);
    expect(m.byTool).toEqual({});
  });

  it('recordCall 正确累计成功调用', () => {
    const tracker = new ToolReliabilityTracker();
    tracker.recordCall('bash', true);
    tracker.recordCall('bash', true);
    tracker.recordCall('search', true);

    const m = tracker.getMetrics();
    expect(m.totalCalls).toBe(3);
    expect(m.successfulCalls).toBe(3);
    expect(m.byTool['bash']).toEqual({ total: 2, errors: 0 });
    expect(m.byTool['search']).toEqual({ total: 1, errors: 0 });
  });

  it('recordCall 正确累计失败调用', () => {
    const tracker = new ToolReliabilityTracker();
    tracker.recordCall('bash', true);
    tracker.recordCall('bash', false);

    const m = tracker.getMetrics();
    expect(m.totalCalls).toBe(2);
    expect(m.successfulCalls).toBe(1);
    expect(m.byTool['bash']).toEqual({ total: 2, errors: 1 });
  });

  it('recordParseError 和 recordRetry 独立计数', () => {
    const tracker = new ToolReliabilityTracker();
    tracker.recordParseError();
    tracker.recordParseError();
    tracker.recordRetry();

    const m = tracker.getMetrics();
    expect(m.parseErrors).toBe(2);
    expect(m.retriedCalls).toBe(1);
  });

  it('reset 清空所有指标', () => {
    const tracker = new ToolReliabilityTracker();
    tracker.recordCall('bash', true);
    tracker.recordParseError();
    tracker.recordRetry();
    tracker.reset();

    const m = tracker.getMetrics();
    expect(m.totalCalls).toBe(0);
    expect(m.successfulCalls).toBe(0);
    expect(m.parseErrors).toBe(0);
    expect(m.retriedCalls).toBe(0);
    expect(m.byTool).toEqual({});
  });

  it('getMetrics 返回快照（不受后续修改影响）', () => {
    const tracker = new ToolReliabilityTracker();
    tracker.recordCall('bash', true);

    const snapshot = tracker.getMetrics();
    tracker.recordCall('bash', false);

    // snapshot 不应被后续 recordCall 影响
    expect(snapshot.totalCalls).toBe(1);
    expect(snapshot.successfulCalls).toBe(1);
  });
});
