// WebSocket 客户端 — 与 Server 通信
import { getAccessToken } from './client';

export type WsMessageType = 'auth_ok' | 'text_delta' | 'tool_use' | 'confirm_request' | 'done' | 'error';

export interface WsIncoming {
  type: WsMessageType;
  sessionId?: string;
  content?: string;
  text?: string;
  tool?: string;
  input?: unknown;
  requestId?: string;
  reason?: string;
  tokens?: number;
  message?: string;
}

type MessageHandler = (msg: WsIncoming) => void;

let ws: WebSocket | null = null;
let handlers = new Set<MessageHandler>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

export function onWsMessage(handler: MessageHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

export function disconnectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}
