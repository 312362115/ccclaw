import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from './tool-registry.js';
import { MCPManager } from './mcp-manager.js';
import type { JsonRpcRequest, JsonRpcResponse, MCPTransport } from './mcp-transport.js';

// ====== Mock transports ======

vi.mock('./mcp-transport.js', () => {
  const makeMockTransport = (): MCPTransport & { sentRequests: JsonRpcRequest[] } => ({
    sentRequests: [],
    send: vi.fn(),
    close: vi.fn(),
  });

  const StdioTransport = vi.fn(() => makeMockTransport());
  const HttpTransport = vi.fn(() => makeMockTransport());

  return { StdioTransport, HttpTransport };
});

// Import after mock is set up
import { StdioTransport, HttpTransport } from './mcp-transport.js';

// ====== Helpers ======

function makeInitResponse(id: number): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05' } };
}

function makeToolListResponse(id: number, tools: Array<{ name: string; description: string; inputSchema?: object }>): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result: { tools } };
}

function makeErrorResponse(id: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code: -32000, message } };
}

// ====== Tests ======

describe('MCPManager', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('初始化不立即连接', () => {
    const manager = new MCPManager(
      { 'test-server': { transport: 'stdio', command: 'echo' } },
      registry,
    );

    const status = manager.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe('test-server');
    expect(status[0].connected).toBe(false);
    expect(status[0].toolCount).toBe(0);
  });

  it('空 server 列表不报错', async () => {
    const manager = new MCPManager({}, registry);
    await manager.ensureConnected();
    expect(manager.getStatus()).toEqual([]);
  });

  it('ensureConnected 幂等 — 只连接一次', async () => {
    const mockTransport = {
      sentRequests: [] as JsonRpcRequest[],
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { 'stdio-server': { transport: 'stdio', command: 'my-mcp-server' } },
      registry,
    );

    await manager.ensureConnected();
    await manager.ensureConnected(); // second call should be no-op

    // StdioTransport should only be constructed once
    expect(StdioTransport).toHaveBeenCalledTimes(1);
    expect(mockTransport.send).toHaveBeenCalledTimes(2); // initialize + tools/list
  });

  it('StdioTransport 使用 command 和 args 创建', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { server: { command: 'npx', args: ['-y', 'my-mcp'], env: { MY_KEY: 'val' } } },
      registry,
    );

    await manager.ensureConnected();

    expect(StdioTransport).toHaveBeenCalledWith('npx', ['-y', 'my-mcp'], { MY_KEY: 'val' });
  });

  it('HttpTransport 用于 sse/streamable-http', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [])),
      close: vi.fn(),
    };
    (HttpTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { server: { transport: 'sse', url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer tok' } } },
      registry,
    );

    await manager.ensureConnected();

    expect(HttpTransport).toHaveBeenCalledWith('http://localhost:3000/mcp', { Authorization: 'Bearer tok' });
  });

  it('ensureConnected 发送 initialize 然后 tools/list', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [{ name: 'search', description: 'Search the web' }])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp' } },
      registry,
    );

    await manager.ensureConnected();

    const calls = mockTransport.send.mock.calls;
    expect(calls[0][0]).toMatchObject({ method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(calls[1][0]).toMatchObject({ method: 'tools/list' });
  });

  it('工具以 mcp_{server}_{tool} 命名注册到 ToolRegistry', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [
          { name: 'search', description: 'Search the web', inputSchema: { type: 'object', properties: {} } },
          { name: 'fetch', description: 'Fetch a URL' },
        ])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp' } },
      registry,
    );

    await manager.ensureConnected();

    expect(registry.has('mcp_brave_search')).toBe(true);
    expect(registry.has('mcp_brave_fetch')).toBe(true);
    expect(manager.getStatus()[0]).toMatchObject({ name: 'brave', connected: true, toolCount: 2 });
  });

  it('enabledTools 白名单过滤工具', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [
          { name: 'search', description: 'Search' },
          { name: 'fetch', description: 'Fetch' },
          { name: 'scrape', description: 'Scrape' },
        ])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp', enabledTools: ['search', 'fetch'] } },
      registry,
    );

    await manager.ensureConnected();

    expect(registry.has('mcp_brave_search')).toBe(true);
    expect(registry.has('mcp_brave_fetch')).toBe(true);
    expect(registry.has('mcp_brave_scrape')).toBe(false);
    expect(manager.getStatus()[0].toolCount).toBe(2);
  });

  it('callTool 发送正确的 JSON-RPC tools/call', async () => {
    const toolCallResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'result data' }] },
    };
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [{ name: 'search', description: 'Search' }]))
        .mockResolvedValueOnce(toolCallResponse),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp' } },
      registry,
    );

    await manager.ensureConnected();

    const tool = registry.getTool('mcp_brave_search');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ query: 'hello world' });

    const toolCallReq = mockTransport.send.mock.calls[2][0] as JsonRpcRequest;
    expect(toolCallReq.method).toBe('tools/call');
    expect(toolCallReq.params).toMatchObject({ name: 'search', arguments: { query: 'hello world' } });
    expect(result).toBe(JSON.stringify(toolCallResponse.result));
  });

  it('tools/call 返回错误时返回 Error 字符串', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [{ name: 'search', description: 'Search' }]))
        .mockResolvedValueOnce(makeErrorResponse(3, 'rate limit exceeded')),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp' } },
      registry,
    );

    await manager.ensureConnected();

    const tool = registry.getTool('mcp_brave_search');
    const result = await tool!.execute({ query: 'test' });
    expect(result).toBe('Error: rate limit exceeded');
  });

  it('tools/list 返回错误时跳过该 server', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeErrorResponse(2, 'tools/list not supported')),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { bad: { command: 'bad-mcp' } },
      registry,
    );

    await manager.ensureConnected();

    expect(manager.getStatus()[0].connected).toBe(false);
  });

  it('连接失败不阻塞其他 server', async () => {
    const goodTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [{ name: 'tool1', description: 'Tool 1' }])),
      close: vi.fn(),
    };

    (StdioTransport as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ send: vi.fn().mockRejectedValue(new Error('spawn failed')), close: vi.fn() })
      .mockReturnValueOnce(goodTransport);

    const manager = new MCPManager(
      {
        bad: { command: 'nonexistent-mcp' },
        good: { command: 'good-mcp' },
      },
      registry,
    );

    await manager.ensureConnected();

    const status = manager.getStatus();
    expect(status.find((s) => s.name === 'bad')?.connected).toBe(false);
    expect(status.find((s) => s.name === 'good')?.connected).toBe(true);
  });

  it('disconnect 关闭所有 transport 并清理连接', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [{ name: 'search', description: 'Search' }])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { brave: { command: 'brave-mcp' } },
      registry,
    );

    await manager.ensureConnected();
    expect(manager.getStatus()[0].connected).toBe(true);

    await manager.disconnect();

    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()[0].connected).toBe(false);
    expect(manager.getStatus()[0].toolCount).toBe(0);
  });

  it('disconnect 后可以重新 ensureConnected', async () => {
    const mockTransport = {
      send: vi.fn()
        .mockResolvedValue(makeInitResponse(1))
        .mockResolvedValue(makeToolListResponse(2, [])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport);

    const manager = new MCPManager(
      { server: { command: 'mcp-server' } },
      registry,
    );

    await manager.ensureConnected();
    await manager.disconnect();

    // Should allow reconnect
    vi.clearAllMocks();
    const mockTransport2 = {
      send: vi.fn()
        .mockResolvedValueOnce(makeInitResponse(1))
        .mockResolvedValueOnce(makeToolListResponse(2, [])),
      close: vi.fn(),
    };
    (StdioTransport as ReturnType<typeof vi.fn>).mockReturnValue(mockTransport2);

    await manager.ensureConnected();
    expect(StdioTransport).toHaveBeenCalledTimes(1);
  });
});
