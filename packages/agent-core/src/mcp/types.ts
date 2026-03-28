// ============================================================
// MCP (Model Context Protocol) 类型定义
// ============================================================

import type { Tool } from '../tools/types.js';

/** MCP Server 连接配置 */
export interface MCPServerConfig {
  /** stdio 模式的命令 */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 传输方式（默认根据 command/url 自动推断） */
  transport?: 'stdio' | 'sse' | 'streamable-http';
  /** HTTP 模式的 URL */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;
  /** 工具白名单（仅暴露指定工具） */
  enabledTools?: string[];
  /** 连接超时（毫秒） */
  timeout?: number;
}

/** MCP 发现的工具信息 */
export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/** MCP Server 连接状态 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
}
