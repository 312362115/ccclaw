import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  generateECDHKeyPair,
  deriveSharedKey,
  publicKeyFromBase64,
  encryptFrame,
  decryptFrame,
  serializeDirectMessage,
  parseDirectMessage,
  type ECDHKeyPair,
  type DirectMessage,
} from '@ccclaw/shared';
import { randomUUID } from 'node:crypto';

interface ClientSession {
  ws: WebSocket;
  sharedKey: Buffer;
  sendCounter: number;
  recvCounter: number;
}

export interface DirectServerOptions {
  keyPair: ECDHKeyPair;
  verifyToken: (token: string) => Promise<boolean>;
  onMessage: (clientId: string, msg: DirectMessage) => void;
  host?: string;
}

export class DirectServer {
  private readonly _host: string;
  private readonly _keyPair: ECDHKeyPair;
  private readonly _verifyToken: (token: string) => Promise<boolean>;
  private _onMessage: (clientId: string, msg: DirectMessage) => void;

  private _httpServer: Server | undefined;
  private _wss: WebSocketServer | undefined;
  private readonly _clients = new Map<string, ClientSession>();

  constructor(options: DirectServerOptions) {
    this._host = options.host ?? '127.0.0.1';
    this._keyPair = options.keyPair;
    this._verifyToken = options.verifyToken;
    this._onMessage = options.onMessage;
  }

  get port(): number {
    const addr = this._httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return 0;
  }

  get directUrl(): string {
    const advertiseHost = process.env.DIRECT_SERVER_ADVERTISE_HOST || this._host;
    return `ws://${advertiseHost}:${this.port}`;
  }

  setMessageHandler(handler: (clientId: string, msg: DirectMessage) => void): void {
    this._onMessage = handler;
  }

  async start(): Promise<void> {
    this._httpServer = createServer();
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
      session.ws.close();
    }
    this._clients.clear();
    this._wss?.close();
    this._httpServer?.close();
  }

  sendToClient(clientId: string, msg: DirectMessage): void {
    const session = this._clients.get(clientId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return;

    const plaintext = serializeDirectMessage(msg);
    const frame = encryptFrame(plaintext, session.sharedKey, session.sendCounter);
    session.sendCounter++;
    session.ws.send(frame);
  }

  broadcastToAll(msg: DirectMessage): void {
    for (const clientId of this._clients.keys()) {
      this.sendToClient(clientId, msg);
    }
  }

  private _handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this._verifyToken(token).then((valid) => {
      if (!valid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this._wss!.handleUpgrade(req, socket, head, (ws) => {
        this._wss!.emit('connection', ws, req);
      });
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  }

  private _handleConnection(ws: WebSocket): void {
    const clientId = randomUUID();
    let handshakeDone = false;
    let session: ClientSession | undefined;

    ws.on('message', (data: Buffer | string) => {
      if (!handshakeDone) {
        // Expect handshake message (JSON text)
        try {
          const msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
          if (msg.type !== 'handshake' || !msg.clientPublicKey) {
            ws.close(4002, 'Invalid handshake');
            return;
          }

          const clientPub = publicKeyFromBase64(msg.clientPublicKey);
          // Per-connection ephemeral keypair for forward secrecy
          const connKp = generateECDHKeyPair();
          const sharedKey = deriveSharedKey(connKp.privateKey, clientPub);

          session = {
            ws,
            sharedKey,
            sendCounter: 0,
            recvCounter: 0,
          };
          this._clients.set(clientId, session);
          handshakeDone = true;

          ws.send(JSON.stringify({
            type: 'handshake_ok',
            runnerPublicKey: connKp.publicKeyBase64,
          }));
        } catch {
          ws.close(4002, 'Invalid handshake');
        }
        return;
      }

      // Post-handshake: binary encrypted frames
      try {
        const frame = Buffer.from(data as ArrayLike<number>);
        const plaintext = decryptFrame(frame, session!.sharedKey, session!.recvCounter);
        session!.recvCounter++;
        const msg = parseDirectMessage(plaintext);
        this._onMessage(clientId, msg);
      } catch (err) {
        ws.close(4003, 'Decryption failed');
      }
    });

    ws.on('close', () => {
      this._clients.delete(clientId);
    });
  }
}
