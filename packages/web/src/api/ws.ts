// WebSocket 客户端 — 与 Server 通信
import { getAccessToken } from './client';

export type WsMessageType =
  | 'auth_ok'
  | 'text_delta'
  | 'tool_use'
  | 'tool_use_start'
  | 'tool_use_delta'
  | 'tool_use_end'
  | 'tool_result'
  | 'thinking_delta'
  | 'consolidation'
  | 'confirm_request'
  | 'done'
  | 'session_done'
  | 'subagent_started'
  | 'subagent_result'
  | 'plan_mode'
  | 'terminal_output'
  | 'terminal_exit'
  | 'error'
  // UX 增强事件
  | 'tool_output_delta'
  | 'diff_preview'
  | 'tool_error_options';

export interface WsIncoming {
  type: WsMessageType;
  sessionId?: string;
  // text_delta
  content?: string;
  text?: string;
  // tool_use (legacy) / tool_use_start / tool_use_delta / tool_use_end / tool_result
  tool?: string;
  input?: unknown;
  toolId?: string;
  name?: string;
  output?: string;
  // confirm_request
  requestId?: string;
  reason?: string;
  // done / session_done
  tokens?: { inputTokens: number; outputTokens: number } | number;
  // consolidation / error
  message?: string;
  // subagent_started / subagent_result
  taskId?: string;
  label?: string;
  // terminal_output / terminal_exit
  data?: string;
  code?: number;
  // UX 增强：diff_preview / tool_error_options
  diff?: string;
  filePath?: string;
  error?: string;
  options?: string[];
  delta?: string;
}

type MessageHandler = (msg: WsIncoming) => void;

let ws: WebSocket | null = null;
let handlers = new Set<MessageHandler>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const terminalOutputCallbacks = new Map<string, (data: string) => void>();
const terminalExitCallbacks = new Map<string, (code: number) => void>();

export function connectWs(): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      // 发送认证
      const token = getAccessToken();
      if (token) {
        ws!.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsIncoming = JSON.parse(e.data);
        if (msg.type === 'auth_ok') {
          resolve();
          return;
        }
        if (msg.type === 'terminal_output' && msg.sessionId && msg.data !== undefined) {
          terminalOutputCallbacks.get(msg.sessionId)?.(msg.data);
          return;
        }
        if (msg.type === 'terminal_exit' && msg.sessionId) {
          terminalExitCallbacks.get(msg.sessionId)?.(msg.code ?? 0);
          return;
        }
        handlers.forEach((h) => h(msg));
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      reject(new Error('WebSocket 连接失败'));
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs().catch(() => { /* retry handled by onclose */ });
  }, 3000);
}

export function sendMessage(workspaceId: string, sessionId: string, content: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'message', workspaceId, sessionId, content }));
  }
}

export function sendConfirmResponse(workspaceId: string, sessionId: string, requestId: string, approved: boolean) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'confirm_response',
      workspaceId,
      sessionId,
      requestId,
      approved,
    }));
  }
}

export function onWsMessage(handler: MessageHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

function send(data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ====== Terminal ======

export function sendTerminalOpen(workspaceId: string, sessionId: string, cols: number, rows: number) {
  send({ type: 'terminal_open', workspaceId, sessionId, cols, rows });
}

export function sendTerminalInput(workspaceId: string, sessionId: string, data: string) {
  send({ type: 'terminal_input', workspaceId, sessionId, data });
}

export function sendTerminalResize(workspaceId: string, sessionId: string, cols: number, rows: number) {
  send({ type: 'terminal_resize', workspaceId, sessionId, cols, rows });
}

export function sendTerminalClose(workspaceId: string, sessionId: string) {
  send({ type: 'terminal_close', workspaceId, sessionId });
}

export function onTerminalOutput(sessionId: string, cb: (data: string) => void) {
  terminalOutputCallbacks.set(sessionId, cb);
}

export function onTerminalExit(sessionId: string, cb: (code: number) => void) {
  terminalExitCallbacks.set(sessionId, cb);
}

export function offTerminal(sessionId: string) {
  terminalOutputCallbacks.delete(sessionId);
  terminalExitCallbacks.delete(sessionId);
}

export function disconnectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}
