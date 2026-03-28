import { describe, it, expect, vi } from 'vitest';
import { createAgent } from '../agent.js';
import type { Agent, AgentConfig } from '../types.js';
import type { Tool } from '../tools/types.js';

// ============================================================
// createAgent() 基础测试
// ============================================================

/**
 * 注意：这些测试验证 createAgent 的组装逻辑，不实际调用 LLM。
 * run() / stream() 的集成测试需要 mock provider，在后续阶段补充。
 */

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    model: 'qwen-plus',
    apiKey: 'test-key-123',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ...overrides,
  };
}

describe('createAgent()', () => {
  it('用最小配置创建 Agent，返回包含 run 和 stream 方法的对象', () => {
    const agent = createAgent(makeConfig());

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe('function');
    expect(typeof agent.stream).toBe('function');
  });

  it('满足 Agent 接口约束', () => {
    const agent: Agent = createAgent(makeConfig());

    // TypeScript 编译通过即验证接口满足
    expect(agent).toBeDefined();
    expect(agent.run).toBeDefined();
    expect(agent.stream).toBeDefined();
  });

  it('支持自定义工具注册', () => {
    const mockTool: Tool = {
      name: 'echo',
      description: '回显输入',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要回显的文本' },
        },
        required: ['text'],
      },
      execute: async (input) => String(input.text),
    };

    // 不抛异常即通过
    const agent = createAgent(makeConfig({ tools: [mockTool] }));
    expect(agent).toBeDefined();
  });

  it('支持多个工具注册', () => {
    const tools: Tool[] = [
      {
        name: 'tool_a',
        description: '工具 A',
        execute: async () => 'a',
      },
      {
        name: 'tool_b',
        description: '工具 B',
        execute: async () => 'b',
      },
    ];

    const agent = createAgent(makeConfig({ tools }));
    expect(agent).toBeDefined();
  });

  it('支持所有可选配置项', () => {
    const agent = createAgent(
      makeConfig({
        apiBase: 'https://custom.api.com/v1',
        systemPrompt: '你是一个测试助手',
        maxIterations: 5,
        temperature: 0.7,
        maxTokens: 2048,
        provider: 'compat',
        thinking: { budgetTokens: 4096 },
        promptEnhancements: true,
        onEvent: () => {},
      }),
    );

    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe('function');
    expect(typeof agent.stream).toBe('function');
  });

  it('缺少 apiKey 时抛出错误', () => {
    expect(() =>
      createAgent({
        model: 'qwen-plus',
        apiKey: '',
        apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      }),
    ).toThrow('apiKey is required');
  });
});
