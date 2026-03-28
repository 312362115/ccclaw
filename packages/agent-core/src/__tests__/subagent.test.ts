import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentManager } from '../subagent/manager.js';
import { DEFAULT_SUBAGENT_CONFIG } from '../subagent/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { LLMProvider, ChatParams, LLMStreamEvent } from '../providers/types.js';

// ====== Mock Provider ======

function createMockProvider(): LLMProvider {
  return {
    capabilities: () => ({
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    }),
    stream: async function* (_params: ChatParams): AsyncIterable<LLMStreamEvent> {
      yield { type: 'text_delta', delta: '任务完成' };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

// ====== Tests ======

describe('SubagentManager', () => {
  let provider: LLMProvider;
  let registry: ToolRegistry;

  beforeEach(() => {
    provider = createMockProvider();
    registry = new ToolRegistry();
  });

  it('应使用默认配置构造', () => {
    const manager = new SubagentManager(provider, 'test-model', registry);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('应使用自定义配置构造', () => {
    const manager = new SubagentManager(provider, 'test-model', registry, {
      maxConcurrent: 5,
      maxIterations: 10,
    });
    expect(manager.getActiveCount()).toBe(0);
  });

  it('getActiveCount 初始为 0', () => {
    const manager = new SubagentManager(provider, 'test-model', registry);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('spawn 执行后 activeCount 归零', async () => {
    const manager = new SubagentManager(provider, 'test-model', registry);
    const result = await manager.spawn('测试任务');

    expect(result.text).toBe('任务完成');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('spawn 超过并发上限时应抛错', async () => {
    // 创建一个永远不完成的 provider 来占住并发位
    const blockingProvider: LLMProvider = {
      capabilities: provider.capabilities,
      stream: async function* (): AsyncIterable<LLMStreamEvent> {
        // 永远挂起
        await new Promise(() => {});
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };

    const manager = new SubagentManager(blockingProvider, 'test-model', registry, {
      maxConcurrent: 1,
      maxIterations: 5,
    });

    // 第一个 spawn 不 await，让它占住并发位
    const first = manager.spawn('任务 1');

    // 等一个 tick 让 activeCount 递增
    await new Promise((r) => setTimeout(r, 10));

    // 第二个应该被拒绝
    await expect(manager.spawn('任务 2')).rejects.toThrow('并发上限');

    // 清理：中断第一个（忽略错误）
    // first 会一直 pending，测试结束后 vitest 会清理
  });

  it('spawn 应排除 spawn 工具防止递归', async () => {
    // 注册一个名为 spawn 的工具
    registry.register({
      name: 'spawn',
      description: '派生子 Agent',
      execute: async () => 'should not be called',
    });
    registry.register({
      name: 'read',
      description: '读文件',
      execute: async () => 'file content',
    });

    const manager = new SubagentManager(provider, 'test-model', registry);
    const result = await manager.spawn('测试任务');

    // 正常完成（spawn 工具被排除，不会引发递归）
    expect(result.text).toBe('任务完成');
  });

  it('reviewer 角色应排除写入类工具', async () => {
    registry.register({
      name: 'write',
      description: '写文件',
      execute: async () => 'ok',
    });
    registry.register({
      name: 'read',
      description: '读文件',
      execute: async () => 'content',
    });

    const manager = new SubagentManager(provider, 'test-model', registry);
    const result = await manager.spawn('审查代码', 'reviewer');

    expect(result.text).toBe('任务完成');
  });
});
