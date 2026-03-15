// 系统角色
export type SystemRole = 'admin' | 'user';

// 记忆类型（工作区 workspace.db 中使用）
export type MemoryType = 'project' | 'reference' | 'decision' | 'feedback' | 'log';

// 会话状态
export type SessionStatus = 'active' | 'archived';

// 定时任务运行状态
export type TaskRunStatus = 'running' | 'success' | 'failed';

// Provider 类型（系统支持的模型服务商）
export type ProviderType = 'claude' | 'openai' | 'deepseek';

// Provider 认证方式
export type ProviderAuthType = 'api_key' | 'oauth';

// WebSocket 消息类型
export interface WsClientMessage {
  type: 'auth' | 'message' | 'cancel' | 'confirm_response';
  token?: string;
  sessionId?: string;
  content?: string;
  requestId?: string;
  approved?: boolean;
}

export interface WsServerMessage {
  type: 'thinking_delta' | 'text_delta' | 'tool_use' | 'tool_result' | 'confirm_request' | 'done' | 'error';
  sessionId?: string;
  content?: string;
  tool?: string;
  input?: string;
  output?: string;
  requestId?: string;
  reason?: string;
  tokens?: number;
  message?: string;
}

// 工具拦截结果
export type ToolGuardResult = 'allow' | 'block' | 'confirm';
