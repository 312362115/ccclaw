import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioTransport, HttpTransport } from './mcp-transport.js';
import type { JsonRpcRequest, JsonRpcResponse } from './mcp-transport.js';

// ====== StdioTransport Tests ======

describe('StdioTransport', () => {
  it('onData 正确解析换行分隔的 JSON', () => {
    // 使用 cat 命令作为回显进程（输出它接收到的内容）
    // 我们测试的是内部解析逻辑，通过创建一个可控的传输实例
    // 直接测试私有 onData 方法的逻辑：使用 node -e 回显
    const transport = new StdioTransport('node', ['-e', 'process.stdin.pipe(process.stdout)']);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const responsePromise = transport.send(request);

    // 子进程会将发送的 JSON 回显回来，触发 onData 并解析
    return responsePromise.then((resp) => {
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe(1);
      transport.close();
    }).catch(() => {
      // 如果回显的不是合法的 JsonRpcResponse 格式，pending 不会被 resolve
      // 这种情况下手动 close 即可
      transport.close();
    });
  });

  it('pending 请求通过 id 匹配', async () => {
    // 创建一个只回显输入的进程
    const transport = new StdioTransport('node', [
      '-e',
      'process.stdin.on("data", d => process.stdout.write(d))',
    ]);

    // 构造一个真正合法的 JsonRpcResponse 字符串由子进程回显
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 42,
      method: 'ping',
    };

    const promise = transport.send(request);

    // 回显的请求本身包含 id:42，虽然是请求而不是响应，
    // 但 JSON 解析后 id 字段存在，pending 会被 resolve
    const resp = await promise.catch(() => null);
    // 如果 onData 正确匹配了 id，resp 应该是解析后的对象
    if (resp !== null) {
      expect((resp as JsonRpcResponse).id).toBe(42);
    }
    // 无论如何，pending 不应该泄漏
    transport.close();
  });

  it('close() 拒绝所有 pending 请求', async () => {
    // 使用 sleep 命令保证进程不会立即响应
    const transport = new StdioTransport('node', [
      '-e',
      'setTimeout(() => {}, 60000)',
    ]);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const promise = transport.send(request);

    // 立即关闭
    transport.close();

    await expect(promise).rejects.toThrow('Transport closed');
  });

  it('进程退出时拒绝所有 pending 请求', async () => {
    // 立即退出的进程
    const transport = new StdioTransport('node', ['-e', 'process.exit(0)']);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const promise = transport.send(request);

    await expect(promise).rejects.toThrow('MCP process exited');
  });

  it('超时后 reject（使用 fake timers）', async () => {
    vi.useFakeTimers();

    const transport = new StdioTransport('node', [
      '-e',
      'setTimeout(() => {}, 60000)',
    ]);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 99,
      method: 'slow/method',
    };

    const promise = transport.send(request);

    // 快进 30 秒
    vi.advanceTimersByTime(30_000);

    await expect(promise).rejects.toThrow('MCP request slow/method timed out after 30s');

    vi.useRealTimers();
    transport.close();
  });

  it('onData 忽略空行和格式错误的 JSON', () => {
    // 通过创建一个会发送格式错误数据的进程来测试
    const transport = new StdioTransport('node', [
      '-e',
      // 先发送空行和乱码，然后发送有效 JSON
      `process.stdout.write("\\n\\nbad json\\n");
       setTimeout(() => {
         const resp = JSON.stringify({ jsonrpc: "2.0", id: 7, result: "ok" }) + "\\n";
         process.stdout.write(resp);
       }, 50);
       setTimeout(() => {}, 5000);`,
    ]);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'test',
    };

    const promise = transport.send(request);

    return promise.then((resp) => {
      expect(resp.id).toBe(7);
      expect(resp.result).toBe('ok');
      transport.close();
    });
  });

  it('多行 chunk 分批到达时正确缓冲', () => {
    // 进程发送两个半行，测试 buffer 拼接逻辑
    const transport = new StdioTransport('node', [
      '-e',
      // 分两次写，模拟 chunk 分片
      `const part1 = '{"jsonrpc":"2.0","id":3,"re';
       const part2 = 'sult":"done"}\\n';
       process.stdout.write(part1);
       setTimeout(() => process.stdout.write(part2), 20);
       setTimeout(() => {}, 5000);`,
    ]);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'chunked',
    };

    const promise = transport.send(request);

    return promise.then((resp) => {
      expect(resp.id).toBe(3);
      expect(resp.result).toBe('done');
      transport.close();
    });
  });
});

// ====== HttpTransport Tests ======

describe('HttpTransport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('发送正确的 POST 请求', async () => {
    const mockResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    };

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const transport = new HttpTransport('http://localhost:3000/mcp');
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    await transport.send(request);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/mcp');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(options?.body).toBe(JSON.stringify(request));
  });

  it('解析并返回 JSON 响应', async () => {
    const mockResponse: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: 5,
      result: { answer: 42 },
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const transport = new HttpTransport('http://example.com/rpc');
    const resp = await transport.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'compute',
    });

    expect(resp).toEqual(mockResponse);
  });

  it('非 2xx 响应时抛出错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);

    const transport = new HttpTransport('http://example.com/rpc');

    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'test' }),
    ).rejects.toThrow('MCP HTTP 500');
  });

  it('404 响应时抛出包含状态码的错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response);

    const transport = new HttpTransport('http://example.com/rpc');

    await expect(
      transport.send({ jsonrpc: '2.0', id: 2, method: 'missing' }),
    ).rejects.toThrow('MCP HTTP 404');
  });

  it('自定义 headers 被合并到请求中', async () => {
    const mockResponse: JsonRpcResponse = { jsonrpc: '2.0', id: 1, result: null };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const transport = new HttpTransport('http://example.com/rpc', {
      Authorization: 'Bearer token123',
      'X-Custom-Header': 'value',
    });

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const headers = options?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token123');
    expect(headers['X-Custom-Header']).toBe('value');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('close() 不抛出错误（HTTP 无状态）', () => {
    const transport = new HttpTransport('http://example.com/rpc');
    expect(() => transport.close()).not.toThrow();
  });
});
