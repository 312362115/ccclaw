import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WorkspaceDB } from './workspace-db.js';
import { ToolRegistry } from './tool-registry.js';
import { SubagentManager } from './subagent-manager.js';
import type { LLMProvider, ChatResponse } from './llm/types.js';

let tmpDir: string;
let db: WorkspaceDB;
let registry: ToolRegistry;

function createMockProvider(responses: ChatResponse[]): LLMProvider {
  let callIdx = 0;
  return {
    chat: vi.fn(async () => {
      const resp = responses[callIdx] ?? responses[responses.length - 1];
      callIdx++;
      return resp;
    }),
    stream: vi.fn(),
    capabilities: vi.fn(() => ({
      streaming: true,
      toolUse: true,
      extendedThinking: false,
      promptCaching: false,
      vision: false,
      contextWindow: 200000,
      maxOutputTokens: 8192,
    })),
  } as unknown as LLMProvider;
}

const textResponse = (content: string): ChatResponse => ({
  content,
  toolCalls: [],
  usage: { inputTokens: 100, outputTokens: 50 },
  stopReason: 'end_turn',
});

const toolCallResponse = (toolName: string, input: Record<string, unknown>): ChatResponse => ({
  content: '',
  toolCalls: [{ id: 'tc-1', name: toolName, input }],
  usage: { inputTokens: 80, outputTokens: 40 },
  stopReason: 'tool_use',
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
  mkdirSync(tmpDir, { recursive: true });
  db = new WorkspaceDB(join(tmpDir, 'test.db'));
  registry = new ToolRegistry();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SubagentManager', () => {
  it('执行简单任务返回结果', async () => {
    const provider = createMockProvider([
      textResponse('子任务完成了'),
    ]);

    const manager = new SubagentManager(db, provider, registry);
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const result = await manager.spawn(session.id, '计算 1+1', '数学计算');

    expect(result.content).toBe('子任务完成了');
    expect(result.iterations).toBe(1);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('子 Agent 可以调用工具', async () => {
    registry.register({
      name: 'echo',
      description: '回声',
      async execute(input) { return `echo: ${(input as any).text}`; },
    });

    const provider = createMockProvider([
      toolCallResponse('echo', { text: 'hello' }),
      textResponse('工具调用完成'),
    ]);

    const manager = new SubagentManager(db, provider, registry);
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const result = await manager.spawn(session.id, '测试工具', '工具测试');

    expect(result.content).toBe('工具调用完成');
    expect(result.iterations).toBe(2);
  });

  it('spawn 工具不会被传递给子 Agent', async () => {
    registry.register({
      name: 'spawn',
      description: '派生子 Agent',
      async execute() { return 'should not happen'; },
    });
    registry.register({
      name: 'echo',
      description: '回声',
      async execute() { return 'ok'; },
    });

    const provider = createMockProvider([
      textResponse('完成'),
    ]);

    const manager = new SubagentManager(db, provider, registry);
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });

    // spawn 工具应该被过滤掉，不传给子 Agent
    const callSpy = provider.chat as ReturnType<typeof vi.fn>;
    await manager.spawn(session.id, '任务', '标签');

    const toolsArg = callSpy.mock.calls[0][0].tools;
    expect(toolsArg.every((t: any) => t.name !== 'spawn')).toBe(true);
    expect(toolsArg.some((t: any) => t.name === 'echo')).toBe(true);
  });

  it('并发限制生效', async () => {
    const provider = createMockProvider([
      textResponse('done'),
    ]);

    // 设置并发限制为 1
    const manager = new SubagentManager(db, provider, registry, { maxConcurrent: 1 });
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });

    // 模拟第一个 spawn 正在运行（通过延迟响应）
    let resolveFirst: () => void;
    const blockingProvider = {
      chat: vi.fn(() => new Promise<ChatResponse>((resolve) => {
        resolveFirst = () => resolve(textResponse('first done'));
      })),
      stream: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const blockingManager = new SubagentManager(db, blockingProvider, registry, { maxConcurrent: 1 });
    const first = blockingManager.spawn(session.id, '任务1', '标签1');

    // 等一下确保 first 已开始
    await new Promise((r) => setTimeout(r, 10));

    // 第二个应该被拒绝
    await expect(
      blockingManager.spawn(session.id, '任务2', '标签2'),
    ).rejects.toThrow('并发上限');

    // 释放第一个
    resolveFirst!();
    await first;
  });

  it('迭代限制生效', async () => {
    // 每次都返回工具调用，永远不结束
    const provider = createMockProvider([
      toolCallResponse('echo', { text: 'loop' }),
    ]);

    registry.register({
      name: 'echo',
      description: '回声',
      async execute() { return 'ok'; },
    });

    const manager = new SubagentManager(db, provider, registry, { maxIterations: 3 });
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });
    const result = await manager.spawn(session.id, '无限循环', '测试');

    expect(result.iterations).toBe(3);
  });

  it('getActiveCount 正确追踪', async () => {
    const provider = createMockProvider([textResponse('done')]);
    const manager = new SubagentManager(db, provider, registry);
    const session = db.createSession({ workspace_id: 'ws-1', user_id: 'u-1' });

    expect(manager.getActiveCount(session.id)).toBe(0);
    await manager.spawn(session.id, '任务', '标签');
    expect(manager.getActiveCount(session.id)).toBe(0); // 完成后归零
  });
});
