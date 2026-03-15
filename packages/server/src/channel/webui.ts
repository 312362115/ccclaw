import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { agentManager } from '../core/agent-manager.js';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../logger.js';
import { runnerManager } from '../core/runner-manager.js';
import type { ChannelAdapter } from './adapter.js';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
}

interface WsMessage {
  type: 'auth' | 'message' | 'cancel' | 'confirm_response';
  token?: string;
  workspaceId?: string;
  sessionId?: string;
  content?: string;
  requestId?: string;
  approved?: boolean;
}

export function createWebSocketHandler(server: import('node:http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  // HTTP Upgrade 处理：/ws 为客户端，/ws/runner 为 Runner
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (url.pathname === '/ws/runner') {
      // Runner 连接：验证 token，注册到 RunnerManager
      handleRunnerUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  // Runner WebSocket 升级处理
  function handleRunnerUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
    const runnerWss = new WebSocketServer({ noServer: true });
    runnerWss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const runnerId = url.searchParams.get('runnerId');
      const token = url.searchParams.get('token');

      if (!runnerId || token !== (process.env.RUNNER_SECRET || '')) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      runnerManager.registerRunner(ws, runnerId);
    });
  }

  // 客户端 WebSocket 连接处理
  wss.on('connection', (ws: AuthenticatedSocket) => {
    let authenticated = false;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;

        // 认证消息
        if (msg.type === 'auth') {
          try {
            const payload = await verifyAccessToken(msg.token!);
            ws.userId = payload.sub;
            authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: '认证失败' }));
            ws.close();
          }
          return;
        }

        if (!authenticated || !ws.userId) {
          ws.send(JSON.stringify({ type: 'error', message: '未认证' }));
          return;
        }

        // 对话消息：需要 workspaceId + sessionId + content
        if (msg.type === 'message' && msg.workspaceId && msg.sessionId && msg.content) {
          // 验证用户对工作区的访问权限
          const [workspace] = await db.select().from(schema.workspaces)
            .where(and(
              eq(schema.workspaces.id, msg.workspaceId),
              eq(schema.workspaces.createdBy, ws.userId),
            )).limit(1);

          if (!workspace) {
            ws.send(JSON.stringify({ type: 'error', message: '工作区不存在或无权限' }));
            return;
          }

          const adapter: ChannelAdapter = {
            sendDelta: (sid, content) => safeSend(ws, { type: 'text_delta', sessionId: sid, content }),
            sendToolUse: (sid, tool, input) => safeSend(ws, { type: 'tool_use', sessionId: sid, tool, input }),
            sendConfirmRequest: (rid, sid, tool, input, reason) => safeSend(ws, { type: 'confirm_request', requestId: rid, sessionId: sid, tool, input, reason }),
            sendDone: (sid, tokens) => safeSend(ws, { type: 'done', sessionId: sid, tokens }),
            sendError: (sid, message) => safeSend(ws, { type: 'error', sessionId: sid, message }),
          };

          try {
            await agentManager.chat(
              msg.workspaceId,
              ws.userId,
              msg.sessionId,
              msg.content,
              {
                onDelta: (m) => adapter.sendDelta(msg.sessionId!, String(m.text ?? m.content ?? '')),
                onDone: (m) => adapter.sendDone(msg.sessionId!, (m.tokens as number) ?? 0),
                onError: (m) => adapter.sendError(msg.sessionId!, String(m.message ?? '未知错误')),
              },
            );
          } catch (err) {
            adapter.sendError(msg.sessionId, String(err));
          }
        }
      } catch (err) {
        logger.error(err, 'WebSocket 消息处理失败');
        safeSend(ws, { type: 'error', message: '消息处理失败' });
      }
    });
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
