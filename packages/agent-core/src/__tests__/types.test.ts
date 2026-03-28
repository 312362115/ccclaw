import { describe, it, expect } from 'vitest';
import { getTextContent } from '../providers/types.js';
import type {
  AgentStreamEvent,
  LLMProvider,
  LLMStreamEvent,
  ChatParams,
  TokenUsage,
  LLMToolCall,
  LLMToolResult,
  LLMMessage,
  ProviderCapabilities,
  ContentBlock,
  TextContentBlock,
  ImageContentBlock,
} from '../providers/types.js';
import type { Tool, ToolSchema, ToolDefinition } from '../tools/types.js';
import type { AgentConfig, AgentResult, Agent } from '../types.js';

// ============================================================
// providers/types.ts
// ============================================================

describe('getTextContent', () => {
  it('应从字符串返回原文', () => {
    expect(getTextContent('hello')).toBe('hello');
  });

  it('应从 ContentBlock[] 中提取文本', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello ' },
      {
        type: 'image',
        source: { type: 'url', url: 'https://example.com/img.png' },
      },
      { type: 'text', text: 'world' },
    ];
    expect(getTextContent(blocks)).toBe('hello world');
  });

  it('应处理 null / undefined', () => {
    expect(getTextContent(null)).toBe('');
    expect(getTextContent(undefined)).toBe('');
  });
});

describe('LLMStreamEvent 类型完整性', () => {
  it('应涵盖所有事件类型', () => {
    // 编译期验证：构造每种事件类型，确保类型定义正确
    const events: LLMStreamEvent[] = [
      { type: 'text_delta', delta: 'hi' },
      { type: 'thinking_delta', delta: 'hmm' },
      { type: 'tool_use_start', toolCallId: 'tc1', name: 'bash' },
      { type: 'tool_use_delta', toolCallId: 'tc1', delta: '{"cmd":"ls"}' },
      { type: 'tool_use_end', toolCallId: 'tc1' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'done', stopReason: 'end_turn' },
      { type: 'error', message: 'oops' },
    ];
    expect(events).toHaveLength(8);
  });
});

describe('AgentStreamEvent 类型完整性', () => {
  it('应包含 tool_result 和 session_done', () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', delta: 'hi' },
      { type: 'tool_result', toolCallId: 'tc1', output: 'ok' },
      {
        type: 'session_done',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];
    expect(events).toHaveLength(3);
  });
});

// ============================================================
// tools/types.ts
// ============================================================

describe('Tool 类型定义', () => {
  it('应接受完整的 Tool 定义', async () => {
    const tool: Tool = {
      name: 'echo',
      description: '回显输入内容',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '要回显的消息' },
        },
        required: ['message'],
      },
      execute: async (input) => String(input.message),
    };

    expect(tool.name).toBe('echo');
    expect(tool.schema?.required).toContain('message');
    const result = await tool.execute({ message: 'hi' });
    expect(result).toBe('hi');
  });

  it('应接受无 schema 的简单 Tool', async () => {
    const tool: Tool = {
      name: 'noop',
      description: '什么都不做',
      execute: async () => 'done',
    };

    expect(tool.schema).toBeUndefined();
    expect(await tool.execute({})).toBe('done');
  });

  it('ToolDefinition 不包含 execute', () => {
    const def: ToolDefinition = {
      name: 'read',
      description: '读取文件',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
        },
        required: ['path'],
      },
    };
    expect(def.name).toBe('read');
    // ToolDefinition 不应有 execute 属性
    expect('execute' in def).toBe(false);
  });
});

// ============================================================
// types.ts — AgentConfig / AgentResult / Agent
// ============================================================

describe('AgentConfig', () => {
  it('应接受最小配置（model + apiKey + tools）', () => {
    const config: AgentConfig = {
      model: 'qwen-plus',
      apiKey: 'sk-test-key',
      tools: [],
    };
    expect(config.model).toBe('qwen-plus');
    expect(config.apiKey).toBe('sk-test-key');
    expect(config.tools).toEqual([]);
  });

  it('应接受完整配置', () => {
    const tool: Tool = {
      name: 'test',
      description: 'test tool',
      execute: async () => 'ok',
    };

    const config: AgentConfig = {
      model: 'qwen-plus',
      apiKey: 'sk-test',
      apiBase: 'https://api.example.com',
      systemPrompt: 'You are helpful.',
      tools: [tool],
      maxIterations: 10,
      temperature: 0.7,
      maxTokens: 4096,
      provider: 'openai',
      thinking: { budgetTokens: 2048 },
      promptEnhancements: true,
      onEvent: () => {},
    };

    expect(config.maxIterations).toBe(10);
    expect(config.thinking?.budgetTokens).toBe(2048);
  });
});

describe('AgentResult', () => {
  it('应包含预期字段', () => {
    const result: AgentResult = {
      text: '任务完成',
      toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'ls' } }],
      usage: { inputTokens: 200, outputTokens: 100 },
      iterations: 3,
    };

    expect(result.text).toBe('任务完成');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(200);
    expect(result.iterations).toBe(3);
  });
});

describe('Agent 接口', () => {
  it('应满足 Agent 接口契约', async () => {
    // 构造一个最简 mock Agent，验证接口形状
    const mockAgent: Agent = {
      run: async (_message: string) => ({
        text: 'done',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        iterations: 1,
      }),
      stream: async function* (_message: string) {
        yield { type: 'text_delta' as const, delta: 'done' };
        yield {
          type: 'session_done' as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    };

    const result = await mockAgent.run('hello');
    expect(result.text).toBe('done');

    const events: AgentStreamEvent[] = [];
    for await (const event of mockAgent.stream('hello')) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('text_delta');
    expect(events[1].type).toBe('session_done');
  });
});

describe('ChatParams extra 字段', () => {
  it('应支持厂商扩展参数', () => {
    const params: ChatParams = {
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hi' }],
      extra: {
        enable_thinking: true,
        thinking_budget: 2048,
      },
    };
    expect(params.extra?.enable_thinking).toBe(true);
  });
});
