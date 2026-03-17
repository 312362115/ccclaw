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

  /** 调用单个工具，通过 JSON-RPC tools/call */
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
    const resp = await transport.send(req);
    if (resp.error) return `Error: ${resp.error.message}`;
    return JSON.stringify(resp.result);
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
