/**
 * MCPManager — MCP Server 懒连接管理
 *
 * 特性：
 * - 首次消息时才连接（ensureConnected 幂等）
 * - 支持 stdio / SSE / streamable-http 三种传输
 * - 工具命名：mcp_{serverName}_{toolName}
 * - enabledTools 白名单过滤
 * - 每次工具调用独立 30s 超时（transport 层内置）
 */

import type { ToolRegistry } from './tool-registry.js';
import { StdioTransport, HttpTransport, type MCPTransport, type JsonRpcRequest } from './mcp-transport.js';

// ====== Logger ======

const logger = {
  warn: (msg: string) => console.warn(`[MCPManager] ${msg}`),
};

// ====== Types ======

export interface MCPServerConfig {
  command?: string;      // stdio mode
  args?: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse' | 'streamable-http';
  url?: string;          // HTTP mode
  headers?: Record<string, string>;
  enabledTools?: string[];
  timeout?: number;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface ActiveConnection {
  transport: MCPTransport;
  tools: MCPToolInfo[];
}

// ====== MCPManager ======

export class MCPManager {
  private connections = new Map<string, ActiveConnection>();
  private connected = false;

  constructor(
    private servers: Record<string, MCPServerConfig>,
    private toolRegistry: ToolRegistry,
  ) {}

  /** 幂等懒连接：确保所有 MCP Server 已连接 */
  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connected = true;

    for (const [name, config] of Object.entries(this.servers)) {
      try {
        const transport = this.createTransport(config);

        // Initialize MCP session
        let nextId = 1;
        const initReq: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: nextId++,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {} },
        };
        await transport.send(initReq);

        // Discover tools
        const listReq: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: nextId++,
          method: 'tools/list',
          params: {},
        };
        const listResp = await transport.send(listReq);

        if (listResp.error) {
          logger.warn(`MCP ${name} tools/list failed: ${listResp.error.message}`);
          transport.close();
          continue;
        }

        const tools = ((listResp.result as Record<string, unknown>)?.tools as MCPToolInfo[]) || [];
        const filtered = this.filterByEnabledList(tools, config.enabledTools);

        for (const tool of filtered) {
          const capturedId = nextId++;
          const capturedToolName = tool.name;
          this.toolRegistry.register({
            name: `mcp_${name}_${tool.name}`,
            description: tool.description || '',
            // 透传 MCP server 返回的 inputSchema，让 LLM 看到完整参数描述
            schema: tool.inputSchema ? {
              type: 'object' as const,
              properties: (tool.inputSchema as any).properties ?? {},
              required: (tool.inputSchema as any).required,
            } : undefined,
            execute: (params) => this._callTool(transport, capturedId, capturedToolName, params),
          });
        }

        this.connections.set(name, { transport, tools: filtered });
      } catch (err) {
        logger.warn(`MCP ${name} connection failed: ${err}`);
      }
    }
  }

  /** 创建对应配置的传输实例 */
  private createTransport(config: MCPServerConfig): MCPTransport {
    if (config.transport === 'stdio' || (!config.transport && config.command)) {
      if (!config.command) throw new Error('MCP stdio transport requires command');
      return new StdioTransport(config.command, config.args || [], config.env);
    }
    // SSE or streamable-http
    if (!config.url) throw new Error('MCP HTTP transport requires url');
    return new HttpTransport(config.url, config.headers);
  }

  /** 调用单个工具，通过 JSON-RPC tools/call。带重试 */
  private async _callTool(
    transport: MCPTransport,
    id: number,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: params },
    };

    try {
      const resp = await transport.send(req);
      if (resp.error) return `Error: ${resp.error.message}`;
      return JSON.stringify(resp.result);
    } catch (err) {
      // 传输层错误（进程崩溃 / 网络断开）→ 尝试重连一次
      const serverName = this.findServerByTransport(transport);
      if (serverName) {
        logger.warn(`MCP ${serverName} 调用失败，尝试重连: ${err}`);
        const reconnected = await this.reconnect(serverName);
        if (reconnected) {
          // 重连成功，用新 transport 重试
          const conn = this.connections.get(serverName);
          if (conn) {
            try {
              const resp = await conn.transport.send(req);
              if (resp.error) return `Error: ${resp.error.message}`;
              return JSON.stringify(resp.result);
            } catch (retryErr) {
              return `Error: MCP ${serverName} 重连后仍失败: ${retryErr}`;
            }
          }
        }
      }
      return `Error: MCP 工具调用失败: ${err}`;
    }
  }

  /** 通过 transport 实例反查 server 名称 */
  private findServerByTransport(transport: MCPTransport): string | undefined {
    for (const [name, conn] of this.connections) {
      if (conn.transport === transport) return name;
    }
    return undefined;
  }

  /** 重连指定 MCP server */
  private async reconnect(serverName: string): Promise<boolean> {
    const config = this.servers[serverName];
    if (!config) return false;

    // 关闭旧连接
    const oldConn = this.connections.get(serverName);
    if (oldConn) {
      try { oldConn.transport.close(); } catch { /* ignore */ }
      this.connections.delete(serverName);
    }

    try {
      const transport = this.createTransport(config);
      let nextId = 1;

      await transport.send({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });

      const listResp = await transport.send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list', params: {} });
      const tools = ((listResp.result as Record<string, unknown>)?.tools as MCPToolInfo[]) || [];
      const filtered = this.filterByEnabledList(tools, config.enabledTools);

      this.connections.set(serverName, { transport, tools: filtered });
      logger.warn(`MCP ${serverName} 重连成功（${filtered.length} 个工具）`);
      return true;
    } catch (err) {
      logger.warn(`MCP ${serverName} 重连失败: ${err}`);
      return false;
    }
  }

  /** 白名单过滤 */
  private filterByEnabledList(tools: MCPToolInfo[], enabledTools?: string[]): MCPToolInfo[] {
    if (!enabledTools) return tools;
    return tools.filter((t) => enabledTools.includes(t.name));
  }

  /** 断开所有连接 */
  async disconnect(): Promise<void> {
    for (const [, conn] of this.connections) {
      conn.transport.close();
    }
    this.connections.clear();
    this.connected = false;
  }

  /** 获取连接状态 */
  getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    return Object.keys(this.servers).map((name) => {
      const conn = this.connections.get(name);
      return {
        name,
        connected: conn !== undefined,
        toolCount: conn?.tools.length ?? 0,
      };
    });
  }
}
