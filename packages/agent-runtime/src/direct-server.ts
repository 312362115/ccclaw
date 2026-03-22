import { createServer as createHttpServer, type Server, type IncomingMessage } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { nanoid, type DirectMessage } from '@ccclaw/shared';

interface ClientSession {
  ws: WebSocket | null; // null for tunnel clients
}

export interface DirectServerOptions {
  verifyToken: (token: string) => Promise<boolean>;
  onMessage: (clientId: string, msg: DirectMessage) => void;
  host?: string;
  tls?: { cert: string; key: string };
}

export class DirectServer {
  private readonly _host: string;
  private readonly _verifyToken: (token: string) => Promise<boolean>;
  private readonly _onMessage: (clientId: string, msg: DirectMessage) => void;
  private readonly _tls?: { cert: string; key: string };

  private _httpServer: Server | undefined;
  private _wss: WebSocketServer | undefined;
  private readonly _clients = new Map<string, ClientSession>();
  private _tunnelSend?: (clientId: string, data: string) => void;

  constructor(options: DirectServerOptions) {
    this._host = options.host ?? '127.0.0.1';
    this._verifyToken = options.verifyToken;
    this._onMessage = options.onMessage;
    this._tls = options.tls;
  }

  setTunnelSend(send: (clientId: string, data: string) => void): void {
    this._tunnelSend = send;
  }

  get port(): number {
    const addr = this._httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return 0;
  }

  get directUrl(): string {
    const advertiseHost = process.env.DIRECT_SERVER_ADVERTISE_HOST || this._host;
    const protocol = this._tls ? 'wss' : 'ws';
    return `${protocol}://${advertiseHost}:${this.port}`;
  }

  // Alias for backward compatibility
  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    if (this._tls) {
      this._httpServer = createHttpsServer({
        cert: this._tls.cert,
        key: this._tls.key,
      });
    } else {
      this._httpServer = createHttpServer();
    }

    this._wss = new WebSocketServer({ noServer: true });

    this._httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this._handleUpgrade(req, socket, head);
    });

    this._wss.on('connection', (ws: WebSocket) => {
      this._handleConnection(ws);
    });

    const port = parseInt(process.env.DIRECT_SERVER_PORT || '0');
    return new Promise<void>((resolve) => {
      this._httpServer!.listen(port, this._host, () => resolve());
    });
  }

  stop(): void {
    for (const [, session] of this._clients) {
      session.ws?.close();
    }
    this._clients.clear();
    this._wss?.close();
    this._httpServer?.close();
  }

  sendToClient(clientId: string, msg: DirectMessage): void {
    const session = this._clients.get(clientId);
    if (!session) return;

    const json = JSON.stringify(msg);

    if (session.ws) {
      if (session.ws.readyState !== WebSocket.OPEN) return;
      session.ws.send(json);
    } else if (this._tunnelSend) {
      this._tunnelSend(clientId, json);
    }
  }

  broadcastToAll(msg: DirectMessage): void {
    for (const clientId of this._clients.keys()) {
      this.sendToClient(clientId, msg);
    }
  }

  /** Handle a tunnel frame forwarded from Server (plain JSON string). */
  handleTunnelFrame(clientId: string, data: string): void {
    // Empty data signals tunnel client disconnect
    if (!data) {
      this._clients.delete(clientId);
      return;
    }

    // Ensure tunnel client is registered
    if (!this._clients.has(clientId)) {
      this._clients.set(clientId, { ws: null });
    }

    try {
      const msg = JSON.parse(data) as DirectMessage;
      this._onMessage(clientId, msg);
    } catch {
      // 无效 JSON，忽略
    }
  }

  /** Remove a tunnel client session (called when tunnel WS closes). */
  removeTunnelClient(clientId: string): void {
    this._clients.delete(clientId);
  }

  private _handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this._verifyToken(token)
      .then((valid) => {
        if (!valid) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        this._wss!.handleUpgrade(req, socket, head, (ws) => {
          this._wss!.emit('connection', ws, req);
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
  }

  private _handleConnection(ws: WebSocket): void {
    const clientId = nanoid();

    this._clients.set(clientId, { ws });

    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const msg = JSON.parse(text) as DirectMessage;
        this._onMessage(clientId, msg);
      } catch {
        ws.close(4002, 'Invalid JSON');
      }
    });

    ws.on('close', () => {
      this._clients.delete(clientId);
    });
  }
}
