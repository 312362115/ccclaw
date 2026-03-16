/**
 * MCPManager — MCP Server 懒连接管理
 *
 * 特性：
 * - 首次消息时才连接（ensureConnected 幂等）
 * - 支持 stdio / SSE / streamable-http 三种传输
 * - 工具命名：mcp_{serverName}_{toolName}
 * - enabledTools 白名单过滤
 * - 每次工具调用独立 30s 超时
 */

import { execSync } from 'node:child_process';
import type { ToolRegistry, Tool } from './tool-registry.js';

// ====== Types ======

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;         // stdio: 启动命令
  args?: string[];          // stdio: 命令参数
  url?: string;             // sse/http: 服务地址
  enabledTools?: string[];  // 白名单，不设则全部启用
  timeout?: number;         // 单次调用超时（ms），默认 30000
  env?: Record<string, string>;
}

export interface MCPConnection {
  config: MCPServerConfig;
  connected: boolean;
  tools: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

// ====== Constants ======

const DEFAULT_TIMEOUT = 30_000;

// ====== MCPManager ======

export class MCPManager {
  private connections = new Map<string, MCPConnection>();

  constructor(
    private servers: MCPServerConfig[],
    private toolRegistry: ToolRegistry,
  ) {
    // 初始化连接记录（不立即连接）
    for (const server of servers) {
      this.connections.set(server.name, {
        config: server,
        connected: false,
        tools: [],
      });
    }
  }

  /** 幂等懒连接：确保所有 MCP Server 已连接 */
  async ensureConnected(): Promise<void> {
    const connectTasks: Promise<void>[] = [];

    for (const [name, conn] of this.connections) {
      if (conn.connected) continue;
      connectTasks.push(this.connectServer(name));
    }

    await Promise.allSettled(connectTasks);
  }

  /** 连接单个 MCP Server */
  private async connectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn || conn.connected) return;

    try {
      const tools = await this.discoverTools(conn.config);

      // 白名单过滤
      const enabledTools = conn.config.enabledTools;
      const filtered = enabledTools
        ? tools.filter((t) => enabledTools.includes(t.name))
        : tools;

      conn.tools = filtered;
      conn.connected = true;

      // 注册到 ToolRegistry
      const wrappedTools: Tool[] = filtered.map((t) =>
        this.wrapMCPTool(conn.config, t),
      );
      this.toolRegistry.registerMCP(name, wrappedTools);
    } catch (err) {
      // 连接失败不阻塞其他 Server
      conn.connected = false;
      console.error(`[MCPManager] 连接 ${name} 失败:`, err);
    }
  }

  /** 发现 MCP Server 提供的工具（简化实现） */
  private async discoverTools(config: MCPServerConfig): Promise<MCPToolInfo[]> {
    // 完整实现需要通过 MCP 协议（JSON-RPC over stdio/SSE/HTTP）
    // 调用 tools/list 获取工具列表。
    // 这里提供骨架，后续对接 @modelcontextprotocol/sdk 完善。

    if (config.transport === 'stdio' && config.command) {
      // stdio: 启动子进程，发送 tools/list 请求
      // 简化：返回空列表，待 MCP SDK 集成后完善
      return [];
    }

    if (config.transport === 'sse' || config.transport === 'streamable-http') {
      // HTTP: 调用 URL 获取工具列表
      if (config.url) {
        try {
          const res = await fetch(`${config.url}/tools/list`, {
            signal: AbortSignal.timeout(config.timeout ?? DEFAULT_TIMEOUT),
          });
          if (res.ok) {
            const data = (await res.json()) as { tools?: MCPToolInfo[] };
            return data.tools ?? [];
          }
        } catch {
          // 连接失败
        }
      }
    }

    return [];
  }

  /** 将 MCP 工具包装为 ToolRegistry 兼容的 Tool */
  private wrapMCPTool(config: MCPServerConfig, toolInfo: MCPToolInfo): Tool {
    return {
      name: toolInfo.name,
      description: toolInfo.description,
      async execute(input) {
        // 完整实现：通过 MCP 协议调用工具
        // stdio: 向子进程发送 tools/call 请求
        // HTTP: POST 到 {url}/tools/call
        const timeout = config.timeout ?? DEFAULT_TIMEOUT;

        if (config.transport === 'stdio' && config.command) {
          const inputJson = JSON.stringify(input);
          try {
            const result = execSync(
              `echo '${inputJson.replace(/'/g, "'\\''")}' | ${config.command} ${(config.args ?? []).join(' ')}`,
              {
                encoding: 'utf-8',
                timeout,
                maxBuffer: 1024 * 1024,
                env: { ...process.env, ...config.env },
              },
            );
            return result;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`MCP tool "${toolInfo.name}" 执行失败: ${message}`);
          }
        }

        if (config.url) {
          const res = await fetch(`${config.url}/tools/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: toolInfo.name, arguments: input }),
            signal: AbortSignal.timeout(timeout),
          });
          if (!res.ok) throw new Error(`MCP tool "${toolInfo.name}" HTTP ${res.status}`);
          const data = (await res.json()) as { content?: string; result?: string };
          return data.content ?? data.result ?? JSON.stringify(data);
        }

        throw new Error(`MCP tool "${toolInfo.name}" 无可用传输方式`);
      },
    };
  }

  /** 断开所有连接 */
  async disconnect(): Promise<void> {
    for (const [name, conn] of this.connections) {
      if (conn.connected) {
        // 注销已注册的工具
        for (const tool of conn.tools) {
          this.toolRegistry.unregister(`mcp_${name}_${tool.name}`);
        }
        conn.connected = false;
        conn.tools = [];
      }
    }
  }

  /** 获取连接状态 */
  getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    return [...this.connections.values()].map((conn) => ({
      name: conn.config.name,
      connected: conn.connected,
      toolCount: conn.tools.length,
    }));
  }
}
