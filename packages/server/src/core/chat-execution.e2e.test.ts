/**
 * 端到端聊天执行 Smoke Test
 *
 * 验证完整链路：用户消息 → MessageBus → AgentManager → RunnerManager → 响应回流
 * 使用 mock RunnerManager（不启动真实 Runner），验证协议和消息流转。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageBus } from '../bus/index.js';
import type { OutboundMessage } from '../bus/index.js';

// Mock 所有外部依赖
vi.mock('../db/index.js', () => {
  function makeQueryResult(data: unknown[] = []) {
    return Object.assign(Promise.resolve(data), {
      limit: vi.fn().mockResolvedValue(data),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(data).then(resolve, reject),
    });
  }
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(makeQueryResult([])),
        }),
      }),
    },
    schema: {
      userPreferences: { userId: 'userId' },
      skills: { userId: 'userId', workspaceId: 'workspaceId' },
      mcpServers: { userId: 'userId', workspaceId: 'workspaceId', name: 'name', enabled: 'enabled' },
      workspaces: { id: 'id' },
      providers: { id: 'id', userId: 'userId', isDefault: 'isDefault' },
    },
  };
});

vi.mock('../config.js', () => ({
  config: { ENCRYPTION_KEY: 'test-key', PORT: 3000, RUNNER_SECRET: 'test' },
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('./oauth-token-manager.js', () => ({
  OAuthTokenManager: vi.fn(),
}));

// Mock RunnerManager — 模拟 Runner 返回 text_delta + done
const mockSend = vi.fn();
const mockEnsureRunner = vi.fn().mockResolvedValue({ slug: 'test-ws', runnerId: 'r-1' });
const mockSendConfig = vi.fn();

vi.mock('./runner-manager.js', () => ({
  runnerManager: {
    ensureRunner: (...args: unknown[]) => mockEnsureRunner(...args),
    sendConfig: (...args: unknown[]) => mockSendConfig(...args),
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

// 替换 messageBus 为测试用实例
const testBus = new MessageBus();
vi.mock('../bus/instance.js', () => ({
  messageBus: testBus,
}));

describe('Chat Execution E2E', () => {
  let AgentManager: typeof import('./agent-manager.js').AgentManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    testBus.removeAllListeners();

    // 默认 mock：send 时立即回调 text_delta + done
    mockSend.mockImplementation(async (_slug: string, _req: unknown, onMessage: (msg: any) => void) => {
      onMessage({ type: 'text_delta', delta: 'Hello from agent!' });
      onMessage({ type: 'done', tokens: 42 });
    });

    const mod = await import('./agent-manager.js');
    AgentManager = mod.AgentManager;
  });

  afterEach(() => {
    testBus.removeAllListeners();
  });

  it('用户消息应通过 Bus → AgentManager → 产生 text_delta 和 done 出站消息', async () => {
    const manager = new AgentManager();

    // Mock resolveProvider
    vi.spyOn(manager, 'resolveProvider').mockResolvedValue({
      apiKey: 'sk-test',
      providerType: 'claude',
      model: 'test-model',
    });

    // 启动 Bus 监听
    manager.startListening();

    // 收集出站消息
    const outbound: OutboundMessage[] = [];
    testBus.onSessionOutbound('sess-1', (msg) => {
      outbound.push(msg);
    });

    // 发送入站消息
    testBus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
      userId: 'user-1',
      channelType: 'test',
      content: '你好',
    });

    // 等异步处理完成
    await new Promise((r) => setTimeout(r, 100));

    // 验证：ensureRunner 被调用
    expect(mockEnsureRunner).toHaveBeenCalledWith('ws-1');

    // 验证：config 被推送
    expect(mockSendConfig).toHaveBeenCalled();
    const config = mockSendConfig.mock.calls[0][1];
    expect(config.workspaceId).toBe('ws-1');
    expect(config.apiKey).toBe('sk-test');

    // 验证：send 被调用，请求中包含 sessionId 和 message
    expect(mockSend).toHaveBeenCalled();
    const sendArgs = mockSend.mock.calls[0];
    expect(sendArgs[0]).toBe('test-ws'); // slug
    expect(sendArgs[1]).toEqual({
      method: 'run',
      params: { sessionId: 'sess-1', message: '你好' },
    });

    // 验证：出站消息包含 text_delta 和 done
    expect(outbound.length).toBeGreaterThanOrEqual(2);

    const textMsg = outbound.find((m) => m.type === 'text_delta');
    expect(textMsg).toBeDefined();
    expect(textMsg!.sessionId).toBe('sess-1');

    const doneMsg = outbound.find((m) => m.type === 'done');
    expect(doneMsg).toBeDefined();
    expect(doneMsg!.sessionId).toBe('sess-1');
  });

  it('Runner 返回错误时应产生 error 出站消息', async () => {
    // Mock send 返回错误
    mockSend.mockImplementation(async (_slug: string, _req: unknown, onMessage: (msg: any) => void) => {
      onMessage({ type: 'error', message: 'Provider 超时' });
    });

    const manager = new AgentManager();
    vi.spyOn(manager, 'resolveProvider').mockResolvedValue({
      apiKey: 'sk-test',
      providerType: 'claude',
    });

    manager.startListening();

    const outbound: OutboundMessage[] = [];
    testBus.onSessionOutbound('sess-2', (msg) => {
      outbound.push(msg);
    });

    testBus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 'sess-2',
      userId: 'user-1',
      channelType: 'test',
      content: 'test',
    });

    await new Promise((r) => setTimeout(r, 100));

    const errorMsg = outbound.find((m) => m.type === 'error');
    expect(errorMsg).toBeDefined();
    expect((errorMsg as any).message).toContain('Provider 超时');
  });

  it('出站消息的 payload 结构应保持稳定（前端依赖的字段）', async () => {
    mockSend.mockImplementation(async (_slug: string, _req: unknown, onMessage: (msg: any) => void) => {
      onMessage({ type: 'text_delta', delta: 'response text' });
      onMessage({ type: 'done', tokens: 100 });
    });

    const manager = new AgentManager();
    vi.spyOn(manager, 'resolveProvider').mockResolvedValue({
      apiKey: 'sk-test',
      providerType: 'openai',
    });

    manager.startListening();

    const outbound: OutboundMessage[] = [];
    testBus.onOutbound((msg) => {
      if (msg.sessionId === 'sess-3') outbound.push(msg);
    });

    testBus.publishInbound({
      type: 'user_message',
      workspaceId: 'ws-1',
      sessionId: 'sess-3',
      userId: 'user-1',
      channelType: 'test',
      content: 'hi',
    });

    await new Promise((r) => setTimeout(r, 100));

    // text_delta 必须有 sessionId + content
    const textMsg = outbound.find((m) => m.type === 'text_delta') as any;
    expect(textMsg).toHaveProperty('sessionId');
    expect(textMsg).toHaveProperty('content');
    expect(typeof textMsg.content).toBe('string');

    // done 必须有 sessionId + tokens
    const doneMsg = outbound.find((m) => m.type === 'done') as any;
    expect(doneMsg).toHaveProperty('sessionId');
    expect(doneMsg).toHaveProperty('tokens');
    expect(typeof doneMsg.tokens).toBe('number');
  });
});
