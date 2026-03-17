/**
 * MCP Transport — MCP JSON-RPC 传输层实现
 *
 * 提供三种传输方式：
 * - StdioTransport: 通过子进程 stdin/stdout 通信
 * - HttpTransport: 通过 HTTP POST 通信（兼容 SSE 和 streamable-http）
 */

import { spawn, ChildProcess } from 'child_process';

// ====== Types ======

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface MCPTransport {
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  close(): void;
}

// ====== StdioTransport ======

export class StdioTransport implements MCPTransport {
  private proc: ChildProcess;
  private pending = new Map<
    number,
    { resolve: (resp: JsonRpcResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = '';

  constructor(command: string, args: string[], env?: Record<string, string>) {
    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
    this.proc.on('error', (err: Error) => this.rejectAll(err));
    this.proc.on('exit', () => this.rejectAll(new Error('MCP process exited')));
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request ${request.method} timed out after 30s`));
      }, 30_000);
      this.pending.set(request.id, { resolve, reject, timer });
      this.proc.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  close() {
    this.rejectAll(new Error('Transport closed'));
    this.proc.kill();
  }

  private onData(data: string) {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const resp = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pending.get(resp.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(resp.id);
          pending.resolve(resp);
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  private rejectAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}

// ====== HttpTransport ======
// 同时用于 SSE 和 streamable-http（请求/响应部分相同，流式处理由上层负责）

export class HttpTransport implements MCPTransport {
  constructor(
    private url: string,
    private headers?: Record<string, string>,
  ) {}

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
    return resp.json() as Promise<JsonRpcResponse>;
  }

  close() {
    /* HTTP is stateless */
  }
}

// ====== SSETransport / StreamableHttpTransport aliases ======

/** SSE 传输（请求/响应通过 HTTP POST，流式事件由上层处理） */
export const SSETransport = HttpTransport;

/** Streamable HTTP 传输（与 SSETransport 相同实现） */
export const StreamableHttpTransport = HttpTransport;
