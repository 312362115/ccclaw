import { describe, it, expect, afterEach } from 'vitest';
import { ToolRegistry } from './tool-registry.js';
import { MCPManager } from './mcp-manager.js';

let registry: ToolRegistry;

afterEach(() => {
  registry = new ToolRegistry();
});

describe('MCPManager', () => {
  it('初始化不立即连接', () => {
    registry = new ToolRegistry();
    const manager = new MCPManager(
      [{ name: 'test-server', transport: 'stdio', command: 'echo' }],
      registry,
    );

    const status = manager.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].connected).toBe(false);
    expect(status[0].toolCount).toBe(0);
  });

  it('ensureConnected 幂等', async () => {
    registry = new ToolRegistry();
    const manager = new MCPManager(
      [{ name: 'stdio-server', transport: 'stdio', command: 'echo' }],
      registry,
    );

    // 连接两次不报错
    await manager.ensureConnected();
    await manager.ensureConnected();

    // stdio discover 目前返回空工具列表
    const status = manager.getStatus();
    expect(status[0].connected).toBe(true);
    expect(status[0].toolCount).toBe(0);
  });

  it('空 server 列表不报错', async () => {
    registry = new ToolRegistry();
    const manager = new MCPManager([], registry);
    await manager.ensureConnected();
    expect(manager.getStatus()).toEqual([]);
  });

  it('disconnect 清理状态', async () => {
    registry = new ToolRegistry();
    const manager = new MCPManager(
      [{ name: 'test', transport: 'stdio', command: 'echo' }],
      registry,
    );

    await manager.ensureConnected();
    expect(manager.getStatus()[0].connected).toBe(true);

    await manager.disconnect();
    expect(manager.getStatus()[0].connected).toBe(false);
  });

  it('连接失败不阻塞其他 server', async () => {
    registry = new ToolRegistry();
    const manager = new MCPManager(
      [
        { name: 'good', transport: 'stdio', command: 'echo' },
        { name: 'bad', transport: 'sse', url: 'http://localhost:99999' },
      ],
      registry,
    );

    await manager.ensureConnected();

    const status = manager.getStatus();
    expect(status.find((s) => s.name === 'good')?.connected).toBe(true);
    // bad server 连接失败但不影响 good
  });
});
