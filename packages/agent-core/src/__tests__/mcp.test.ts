import { describe, it, expect, vi } from 'vitest';
import { MCPManager } from '../mcp/manager.js';
import type { MCPServerConfig } from '../mcp/types.js';

describe('MCPManager', () => {
  it('应使用 server 配置构造', () => {
    const servers: Record<string, MCPServerConfig> = {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        transport: 'stdio',
      },
    };

    const manager = new MCPManager(servers);
    expect(manager).toBeInstanceOf(MCPManager);
  });

  it('getTools 应返回空数组（stub）', () => {
    const manager = new MCPManager({
      test: { command: 'echo', args: ['hello'] },
    });

    expect(manager.getTools()).toEqual([]);
  });

  it('ensureConnected 应打印警告且幂等', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new MCPManager({
      test: { command: 'echo' },
    });

    await manager.ensureConnected();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('stub');

    // 幂等：第二次不再打印
    warnSpy.mockClear();
    await manager.ensureConnected();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('disconnect 后可重新连接', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new MCPManager({
      test: { command: 'echo' },
    });

    await manager.ensureConnected();
    await manager.disconnect();

    // disconnect 后再次 ensureConnected 应重新触发
    warnSpy.mockClear();
    await manager.ensureConnected();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('getStatus 应返回所有 server 状态', () => {
    const manager = new MCPManager({
      fs: { command: 'fs-server' },
      web: { url: 'http://localhost:3000', transport: 'sse' },
    });

    const status = manager.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0]).toEqual({ name: 'fs', connected: false, toolCount: 0 });
    expect(status[1]).toEqual({ name: 'web', connected: false, toolCount: 0 });
  });

  it('空配置应正常工作', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new MCPManager({});
    await manager.ensureConnected();
    expect(manager.getTools()).toEqual([]);
    expect(manager.getStatus()).toEqual([]);

    // 空配置不应打印警告
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
