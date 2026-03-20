// Agent 协议 — Server 与 Runner 之间的唯一可信类型定义
// 两端都从 @ccclaw/shared 导入，不要在各自包中重复定义

// ====== 内容块（多模态消息） ======

/** 文本内容块 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** 图片内容块（支持 base64 和 URL） */
export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  } | {
    type: 'url';
    url: string;
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

// ====== Runtime 配置（Server → Runner，启动时注入） ======

export interface RuntimeConfig {
  workspaceId: string;          // 主 DB 中的 workspace UUID
  apiKey: string;
  providerType: string;         // 'claude' | 'openai' | 'gemini' | etc
  apiBase?: string;             // 自定义 endpoint
  model?: string;               // 默认模型
  systemPrompt?: string;
  skills?: string[];
  userPreferences?: {
    customInstructions?: string;
    toolConfirmMode?: string;
  };
}

// ====== Agent 请求（Server → Runner，每次对话） ======

export interface AgentRequest {
  method: 'run';
  params: {
    sessionId: string;
    message: string;
    /** 多模态内容块（图片等），与 message 互补 */
    content?: ContentBlock[];
  };
}

// ====== Agent 响应（Runner → Server，流式事件） ======

export interface AgentResponse {
  type: 'text_delta' | 'thinking_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end'
    | 'tool_result' | 'confirm_request' | 'subagent_started' | 'subagent_result'
    | 'consolidation' | 'plan_mode' | 'usage'
    | 'done' | 'session_done' | 'error';
  [key: string]: unknown;
}

// ====== Runner → Server WebSocket 消息 ======

export type RunnerMessage =
  | { type: 'ping' }
  | { type: 'register'; publicKey: string; directUrl: string }
  | { type: 'response'; requestId: string; data: AgentResponse }
  | { type: 'terminal_output'; terminalId: string; data: string }
  | { type: 'terminal_exit'; terminalId: string; code: number }
  | { type: 'tunnel_frame'; clientId: string; data: string };

// ====== Server → Runner WebSocket 消息 ======

export type ServerMessage =
  | { type: 'registered'; runnerId?: string }
  | { type: 'pong' }
  | { type: 'config'; data?: RuntimeConfig; encrypted?: string; serverPublicKey?: string }
  | { type: 'request'; requestId: string; data: AgentRequest }
  | { type: 'confirm_response'; confirmRequestId: string; approved: boolean }
  | { type: 'terminal_open'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal_input'; terminalId: string; data: string }
  | { type: 'terminal_resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal_close'; terminalId: string }
  | { type: 'tunnel_frame'; clientId: string; data: string };
