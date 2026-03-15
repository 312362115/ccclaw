// Agent 请求/响应协议 — 与 Server 端 runner-manager.ts 共享类型定义

export interface AgentRequest {
  method: 'run';
  params: {
    sessionId: string;
    message: string;
    apiKey: string;
    context: {
      memories: string[];
      skills: string[];
      history: Array<{ role: string; content: string }>;
      systemPrompt: string;
    };
  };
}

export interface AgentResponse {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'confirm_request' | 'done' | 'error';
  [key: string]: unknown;
}

// Runner → Server 消息
export interface RunnerMessage {
  type: 'ping' | 'response';
  requestId?: string;
  data?: AgentResponse;
}

// Server → Runner 消息
export interface ServerMessage {
  type: 'registered' | 'pong' | 'request';
  runnerId?: string;
  requestId?: string;
  data?: AgentRequest;
}
