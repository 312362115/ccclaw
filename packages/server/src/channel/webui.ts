import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { nanoid } from '@ccclaw/shared';
import { logger } from '../logger.js';
import { runnerManager } from '../core/runner-manager.js';
import { messageBus } from '../bus/instance.js';
import type { OutboundMessage, OutboundHandler } from '../bus/index.js';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
}

interface WsMessage {
  type: 'auth' | 'message' | 'cancel' | 'confirm_response' | 'terminal_open' | 'terminal_input' | 'terminal_resize' | 'terminal_close';
  token?: string;
  workspaceId?: string;
  sessionId?: string;
  content?: string;
  requestId?: string;
  approved?: boolean;
  // terminal fields
  cols?: number;
  rows?: number;
  data?: string;
}

// terminalId → { workspaceSlug, client WebSocket }
const terminalMap = new Map<string, { workspaceSlug: string; ws: WebSocket }>();

// Tunnel: clientId → frontend WebSocket (for encrypted tunnel pipe)
const tunnelClients = new Map<string, WebSocket>();

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
    } else if (url.pathname === '/ws/tunnel') {
      // Tunnel 连接：加密隧道，Server 只做透传
      handleTunnelUpgrade(req, socket, head);
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

      runnerManager.registerRunner(ws, runnerId, undefined, (msg: Record<string, unknown>) => {
        // Forward terminal messages from runner back to client
        const type = msg.type as string;
        if (type === 'terminal_output' || type === 'terminal_exit') {
          const terminalId = msg.terminalId as string;
          const mapping = terminalMap.get(terminalId);
          if (mapping && mapping.ws.readyState === WebSocket.OPEN) {
            const sessionId = terminalId.replace(/_term$/, '');
            if (type === 'terminal_output') {
              mapping.ws.send(JSON.stringify({ type: 'terminal_output', sessionId, data: msg.data }));
            } else {
              mapping.ws.send(JSON.stringify({ type: 'terminal_exit', sessionId, code: msg.code }));
              terminalMap.delete(terminalId);
            }
          }
        }
      }, (msg: { clientId: string; data: string }) => {
        // Forward tunnel frames from runner back to frontend client
        const clientWs = tunnelClients.get(msg.clientId);
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(Buffer.from(msg.data, 'base64'));
        }
      });

      // Handle runner register message (direct URL)
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'register') {
            runnerManager.updateRunnerInfo(runnerId, msg.directUrl);
          }
        } catch {
          // Ignore parse errors — already handled by runnerManager
        }
      });
    });
  }

  // Tunnel WebSocket 升级处理：加密隧道，Server 只做二进制帧透传
  function handleTunnelUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
    const tunnelWss = new WebSocketServer({ noServer: true });
    tunnelWss.handleUpgrade(req, socket, head, async (ws) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const workspaceId = url.searchParams.get('workspaceId');

      if (!token || !workspaceId) {
        ws.close(4001, 'Missing token or workspaceId');
        return;
      }

      // Verify JWT
      try {
        await verifyAccessToken(token);
      } catch {
        ws.close(4001, 'Unauthorized');
        return;
      }

      // Look up workspace to find runner binding
      const [workspace] = await db.select().from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId)).limit(1);
      if (!workspace) {
        ws.close(4004, 'Workspace not found');
        return;
      }

      const clientId = `tunnel-${nanoid()}`;
      tunnelClients.set(clientId, ws);

      logger.info({ clientId, workspaceId, slug: workspace.slug }, 'Tunnel client connected');

      // Forward all client messages to runner as tunnel_frame
      ws.on('message', (raw: Buffer | string) => {
        const data = Buffer.from(raw as ArrayLike<number>).toString('base64');
        runnerManager.sendToRunner(workspace.slug, {
          type: 'tunnel_frame',
          clientId,
          data,
        });
      });

      ws.on('close', () => {
        tunnelClients.delete(clientId);
        // Notify runner to clean up tunnel client session
        runnerManager.sendToRunner(workspace.slug, {
          type: 'tunnel_frame',
          clientId,
          data: '', // empty data signals disconnect
        });
        logger.info({ clientId }, 'Tunnel client disconnected');
      });
    });
  }

  // 客户端 WebSocket 连接处理
  wss.on('connection', (ws: AuthenticatedSocket) => {
    let authenticated = false;

    // 按 sessionId 跟踪当前 socket 的订阅，避免堆积
    const activeSubscriptions = new Map<string, {
      outbound: OutboundHandler;
      cleanup: OutboundHandler;
    }>();

    // socket 关闭时清理所有订阅
    ws.on('close', () => {
      for (const [sessionId, sub] of activeSubscriptions) {
        messageBus.offSessionOutbound(sessionId, sub.outbound);
        messageBus.offSessionOutbound(sessionId, sub.cleanup);
      }
      activeSubscriptions.clear();
    });

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

          const sessionId = msg.sessionId;

          // 幂等订阅：同一 session 已有订阅时先清理再重建
          const existing = activeSubscriptions.get(sessionId);
          if (existing) {
            messageBus.offSessionOutbound(sessionId, existing.outbound);
            messageBus.offSessionOutbound(sessionId, existing.cleanup);
          }

          // 订阅该 session 的出站消息，转发到 WebSocket
          const outboundHandler: OutboundHandler = (out) => {
            safeSend(ws, out);
          };
          messageBus.onSessionOutbound(sessionId, outboundHandler);

          // done/error 后自动取消订阅
          const cleanupHandler: OutboundHandler = (out) => {
            if (out.sessionId === sessionId && (out.type === 'done' || out.type === 'error')) {
              messageBus.offSessionOutbound(sessionId, outboundHandler);
              messageBus.offSessionOutbound(sessionId, cleanupHandler);
              activeSubscriptions.delete(sessionId);
            }
          };
          messageBus.onSessionOutbound(sessionId, cleanupHandler);
          activeSubscriptions.set(sessionId, { outbound: outboundHandler, cleanup: cleanupHandler });

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

        // 终端消息透传：client → runner
        if (msg.type === 'terminal_open' && msg.workspaceId && msg.sessionId) {
          const terminalId = msg.sessionId + '_term';
          terminalMap.set(terminalId, { workspaceSlug: msg.workspaceId, ws });
          runnerManager.sendToRunner(msg.workspaceId, {
            type: 'terminal_open',
            terminalId,
            cols: msg.cols ?? 80,
            rows: msg.rows ?? 24,
          });
        }

        if (msg.type === 'terminal_input' && msg.workspaceId && msg.sessionId) {
          const terminalId = msg.sessionId + '_term';
          runnerManager.sendToRunner(msg.workspaceId, {
            type: 'terminal_input',
            terminalId,
            data: msg.data,
          });
        }

        if (msg.type === 'terminal_resize' && msg.workspaceId && msg.sessionId) {
          const terminalId = msg.sessionId + '_term';
          runnerManager.sendToRunner(msg.workspaceId, {
            type: 'terminal_resize',
            terminalId,
            cols: msg.cols,
            rows: msg.rows,
          });
        }

        if (msg.type === 'terminal_close' && msg.workspaceId && msg.sessionId) {
          const terminalId = msg.sessionId + '_term';
          runnerManager.sendToRunner(msg.workspaceId, {
            type: 'terminal_close',
            terminalId,
          });
          terminalMap.delete(terminalId);
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
