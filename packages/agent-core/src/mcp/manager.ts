/**
 * MCPManager — MCP Server 连接管理（Stub 实现）
 *
 * Phase 3 MVP：接口和类型已就位，实际连接逻辑待后续实现。
 * 当前行为：
 * - ensureConnected() 打印警告
 * - getTools() 返回空数组
 * - disconnect() 无操作
 *
 * TODO: Phase 4 实现完整 MCP 连接：
 * - stdio 传输：spawn 子进程，通过 stdin/stdout JSON-RPC 通信
 * - SSE / streamable-http 传输：HTTP 连接
 * - tools/list 发现工具，动态注册到 ToolRegistry
 * - tools/call 透传调用，带超时和重连
 */

import type { Tool } from '../tools/types.js';
import type { MCPServerConfig, MCPServerStatus } from './types.js';

// ====== MCPManager ======

export class MCPManager {
  private connected = false;

  constructor(private servers: Record<string, MCPServerConfig>) {}

  /** 确保所有 MCP Server 已连接（幂等） */
  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.connected = true;

    const serverNames = Object.keys(this.servers);
    if (serverNames.length > 0) {
      console.warn(
        `[MCPManager] MCP 连接尚未实现（stub）。配置了 ${serverNames.length} 个 server: ${serverNames.join(', ')}`,
      );
    }
  }

  /** 获取所有已发现的 MCP 工具（带 mcp_ 前缀） */
  getTools(): Tool[] {
    // TODO: 连接 MCP server 后，通过 tools/list 发现工具并转换为 Tool 格式
    return [];
  }

  /** 断开所有连接 */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** 获取所有 server 的连接状态 */
  getStatus(): MCPServerStatus[] {
    return Object.keys(this.servers).map((name) => ({
      name,
      connected: false, // stub: 始终未连接
      toolCount: 0,
    }));
  }

  /** 获取 server 配置（用于调试） */
  getServerConfigs(): Record<string, MCPServerConfig> {
    return { ...this.servers };
  }
}
