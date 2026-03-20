import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeConfig } from '@ccclaw/shared';

// Mock DB — where() 返回一个可 thenable 的数组（同时有 .limit()）
vi.mock('../db/index.js', () => {
  function makeQueryResult(data: unknown[] = []) {
    const result = Object.assign(Promise.resolve(data), {
      limit: vi.fn().mockResolvedValue(data),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(data).then(resolve, reject),
    });
    return result;
  }
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(makeQueryResult([])),
    }),
  });
  return {
    db: { select },
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

vi.mock('./runner-manager.js', () => ({
  runnerManager: {
    ensureRunner: vi.fn().mockResolvedValue({ slug: 'test-slug', runnerId: 'r-1' }),
    sendConfig: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../bus/instance.js', () => ({
  messageBus: { onInbound: vi.fn(), publishOutbound: vi.fn() },
}));

vi.mock('./oauth-token-manager.js', () => ({
  OAuthTokenManager: vi.fn(),
}));

describe('AgentManager', () => {
  let AgentManager: typeof import('./agent-manager.js').AgentManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./agent-manager.js');
    AgentManager = mod.AgentManager;
  });

  describe('assembleContext', () => {
    it('应返回结构化上下文（不含 history 和 memories，它们由 Runner 本地加载）', async () => {
      const manager = new AgentManager();
      const ctx = await manager.assembleContext('ws-1', 'user-1');

      // 不应包含 history 和 memories（Runner 从 workspace.db 本地加载）
      expect(ctx.memories).toEqual([]);
      expect(ctx.history).toEqual([]);
      // 应包含 systemPrompt
      expect(ctx.systemPrompt).toBeTruthy();
      expect(ctx.systemPrompt).toContain('CCCLaw');
    });

    it('应包含 skills 字段', async () => {
      const manager = new AgentManager();
      const ctx = await manager.assembleContext('ws-1', 'user-1');
      expect(ctx).toHaveProperty('skills');
      expect(Array.isArray(ctx.skills)).toBe(true);
    });
  });

  describe('buildRuntimeConfig', () => {
    it('应构建包含 workspaceId 的 RuntimeConfig', async () => {
      // Mock resolveProvider
      const manager = new AgentManager();
      vi.spyOn(manager, 'resolveProvider').mockResolvedValue({
        apiKey: 'sk-test',
        providerType: 'claude',
        model: 'claude-sonnet-4-20250514',
      });

      const cfg: RuntimeConfig = await manager.buildRuntimeConfig('ws-123', 'user-1');

      // 核心断言：RuntimeConfig 必须包含 workspaceId
      expect(cfg.workspaceId).toBe('ws-123');
      expect(cfg.apiKey).toBe('sk-test');
      expect(cfg.providerType).toBe('claude');
      expect(cfg.systemPrompt).toBeTruthy();
      expect(cfg.skills).toBeDefined();
    });
  });
});
