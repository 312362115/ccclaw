import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../logger.js';
import { runnerManager } from '../core/runner-manager.js';
import { messageBus } from '../bus/instance.js';
import type { OutboundMessage } from '../bus/index.js';

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

          // 订阅该 session 的出站消息，转发到 WebSocket
          const sessionId = msg.sessionId;
          const outboundHandler = (out: OutboundMessage) => {
            safeSend(ws, out);
          };
          messageBus.onSessionOutbound(sessionId, outboundHandler);

          // 监听 done/error 后自动取消订阅
          const cleanupHandler = (out: OutboundMessage) => {
            if (out.sessionId === sessionId && (out.type === 'done' || out.type === 'error')) {
              messageBus.offSessionOutbound(sessionId, outboundHandler);
              messageBus.offSessionOutbound(sessionId, cleanupHandler);
            }
          };
          messageBus.onSessionOutbound(sessionId, cleanupHandler);

          // 发布入站消息到 Bus
          messageBus.publishInbound({
            type: 'user_message',
            workspaceId: msg.workspaceId,
            sessionId,
            userId: ws.userId,
            channelType: 'webui',
            content: msg.content,
          });
        }

        // 确认响应
        if (msg.type === 'confirm_response' && msg.workspaceId && msg.sessionId && msg.requestId !== undefined) {
          messageBus.publishInbound({
            type: 'confirm_response',
            workspaceId: msg.workspaceId,
            sessionId: msg.sessionId,
            requestId: msg.requestId,
            approved: msg.approved ?? false,
          });
        }

        // 取消请求
        if (msg.type === 'cancel' && msg.workspaceId && msg.sessionId) {
          messageBus.publishInbound({
            type: 'cancel',
            workspaceId: msg.workspaceId,
            sessionId: msg.sessionId,
          });
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
