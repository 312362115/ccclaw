// DirectWsClient — 直连 Runner 的加密 WebSocket 客户端
import { api, getAccessToken, ApiError } from './client';

export type ConnectionState = 'INIT' | 'CONNECTING' | 'DIRECT' | 'TUNNEL_CONNECTING' | 'TUNNEL' | 'RELAY' | 'DISCONNECTED';

interface DirectWsClientOptions {
  workspaceId: string;
  onStateChange: (state: ConnectionState) => void;
  onMessage: (msg: any) => void;
}

interface RunnerInfo {
  directUrl: string;
  fallback: boolean;
}

const HANDSHAKE_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 15000;
const PING_MISS_LIMIT = 3; // 45s without pong → disconnect
const RECONNECT_INTERVAL_MS = 30000;

export class DirectWsClient {
  private state: ConnectionState = 'INIT';
  private ws: WebSocket | null = null;
  private aesKey: CryptoKey | null = null;
  private sendCounter = 0;
  private recvCounter = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly workspaceId: string;
  private readonly onStateChange: (state: ConnectionState) => void;
  private readonly onMessage: (msg: any) => void;

  constructor(options: DirectWsClientOptions) {
    this.workspaceId = options.workspaceId;
    this.onStateChange = options.onStateChange;
    this.onMessage = options.onMessage;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    this.cleanup();
    this.setState('CONNECTING');

    let info: RunnerInfo;
    try {
      info = await api<RunnerInfo>('/workspaces/' + this.workspaceId + '/runner-info');
    } catch (err) {
      // 404 means runner not online; any other fetch error also falls back
      if (err instanceof ApiError && err.status === 404) {
        console.warn('[DirectWs] Runner not online (404), falling back to RELAY');
      } else {
        console.warn('[DirectWs] Failed to fetch runner-info, falling back to RELAY', err);
      }
      this.fallbackToRelay();
      return;
    }

    try {
      // Generate ECDH P-256 keypair
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );

      // Export client public key as base64
      const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const base64Pub = btoa(String.fromCharCode(...new Uint8Array(rawPub)));

      // Open WebSocket to Runner
      const token = getAccessToken();
      const ws = new WebSocket(info.directUrl + '?token=' + token);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      // Handshake timeout
      this.handshakeTimer = setTimeout(() => {
        console.warn('[DirectWs] Handshake timeout');
        ws.close();
        this.fallbackToRelay();
      }, HANDSHAKE_TIMEOUT_MS);

      let handshakeDone = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: base64Pub }));
      };

      ws.onmessage = async (e: MessageEvent) => {
        try {
          if (!handshakeDone) {
            // Handshake phase — expect JSON text
            const data = typeof e.data === 'string'
              ? e.data
              : new TextDecoder().decode(e.data as ArrayBuffer);
            const msg = JSON.parse(data);

            if (msg.type === 'handshake_ok' && msg.runnerPublicKey) {
              // Clear handshake timeout
              if (this.handshakeTimer) {
                clearTimeout(this.handshakeTimer);
                this.handshakeTimer = null;
              }

              // Import runner public key
              const runnerPubBytes = Uint8Array.from(atob(msg.runnerPublicKey), c => c.charCodeAt(0));
              const runnerPubKey = await crypto.subtle.importKey(
                'raw',
                runnerPubBytes,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                [],
              );

              // Derive shared AES-256-GCM key
              const sharedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: runnerPubKey },
                keyPair.privateKey,
                256,
              );
              this.aesKey = await crypto.subtle.importKey(
                'raw',
                sharedBits,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
              );

              this.sendCounter = 0;
              this.recvCounter = 0;
              handshakeDone = true;
              this.setState('DIRECT');
              this.startPing();
            }
          } else {
            // Encrypted phase — binary frames
            const arrayBuf: ArrayBuffer = e.data instanceof Blob
              ? await (e.data as Blob).arrayBuffer()
              : e.data as ArrayBuffer;
            const frame = new Uint8Array(arrayBuf);

            const decrypted = await this.decrypt(frame);
            const text = new TextDecoder().decode(decrypted);
            const msg = JSON.parse(text);

            // Handle pong internally
            if (msg.channel === 'system' && msg.action === 'pong') {
              this.missedPings = 0;
              return;
            }

            this.onMessage(msg);
          }
        } catch (err) {
          console.error('[DirectWs] Message handling error', err);
        }
      };

      ws.onerror = () => {
        console.warn('[DirectWs] WebSocket error');
      };

      ws.onclose = () => {
        if (this.handshakeTimer) {
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }
        this.stopPing();
        this.ws = null;
        this.aesKey = null;
        if (!this.disposed) {
          this.tryTunnel();
        }
      };
    } catch (err) {
      console.error('[DirectWs] Connection setup error', err);
      this.tryTunnel();
    }
  }

  async send(msg: any): Promise<void> {
    if ((this.state !== 'DIRECT' && this.state !== 'TUNNEL') || !this.ws || !this.aesKey) {
      throw new Error('DirectWsClient is not in DIRECT or TUNNEL state');
    }
    const data = new TextEncoder().encode(JSON.stringify(msg));
    const frame = await this.encrypt(data);
    this.ws.send(frame);
  }

  /** Try tunnel connection through Server as a transparent encrypted pipe. */
  private async tryTunnel(): Promise<void> {
    if (this.disposed) return;
    this.cleanup();
    this.setState('TUNNEL_CONNECTING');

    try {
      // Generate ECDH P-256 keypair
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );

      const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const base64Pub = btoa(String.fromCharCode(...new Uint8Array(rawPub)));

      // Connect to tunnel endpoint on the Server
      const token = getAccessToken();
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const tunnelUrl = `${protocol}//${location.host}/ws/tunnel?workspaceId=${this.workspaceId}&token=${token}`;
      const ws = new WebSocket(tunnelUrl);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      // Handshake timeout
      this.handshakeTimer = setTimeout(() => {
        console.warn('[DirectWs] Tunnel handshake timeout');
        ws.close();
        this.fallbackToRelay();
      }, HANDSHAKE_TIMEOUT_MS);

      let handshakeDone = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'handshake', clientPublicKey: base64Pub }));
      };

      ws.onmessage = async (e: MessageEvent) => {
        try {
          if (!handshakeDone) {
            // Handshake phase — expect JSON text or binary containing JSON
            const data = typeof e.data === 'string'
              ? e.data
              : new TextDecoder().decode(e.data as ArrayBuffer);
            const msg = JSON.parse(data);

            if (msg.type === 'handshake_ok' && msg.runnerPublicKey) {
              if (this.handshakeTimer) {
                clearTimeout(this.handshakeTimer);
                this.handshakeTimer = null;
              }

              const runnerPubBytes = Uint8Array.from(atob(msg.runnerPublicKey), c => c.charCodeAt(0));
              const runnerPubKey = await crypto.subtle.importKey(
                'raw',
                runnerPubBytes,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                [],
              );

              const sharedBits = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: runnerPubKey },
                keyPair.privateKey,
                256,
              );
              this.aesKey = await crypto.subtle.importKey(
                'raw',
                sharedBits,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
              );

              this.sendCounter = 0;
              this.recvCounter = 0;
              handshakeDone = true;
              this.setState('TUNNEL');
              this.startPing();
            }
          } else {
            // Encrypted phase — binary frames
            const arrayBuf: ArrayBuffer = e.data instanceof Blob
              ? await (e.data as Blob).arrayBuffer()
              : e.data as ArrayBuffer;
            const frame = new Uint8Array(arrayBuf);

            const decrypted = await this.decrypt(frame);
            const text = new TextDecoder().decode(decrypted);
            const msg = JSON.parse(text);

            if (msg.channel === 'system' && msg.action === 'pong') {
              this.missedPings = 0;
              return;
            }

            this.onMessage(msg);
          }
        } catch (err) {
          console.error('[DirectWs] Tunnel message handling error', err);
        }
      };

      ws.onerror = () => {
        console.warn('[DirectWs] Tunnel WebSocket error');
      };

      ws.onclose = () => {
        if (this.handshakeTimer) {
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }
        this.stopPing();
        this.ws = null;
        this.aesKey = null;
        if (!this.disposed) {
          this.fallbackToRelay();
        }
      };
    } catch (err) {
      console.error('[DirectWs] Tunnel connection setup error', err);
      this.fallbackToRelay();
    }
  }

  disconnect(): void {
    this.disposed = true;
    this.cleanup();
    this.setState('DISCONNECTED');
  }

  // ---- Encryption ----

  private counterToNonce(counter: number): Uint8Array<ArrayBuffer> {
    const buf = new ArrayBuffer(12);
    const arr = new Uint8Array(buf);
    const view = new DataView(buf);
    view.setUint32(4, Math.floor(counter / 0x100000000));
    view.setUint32(8, counter >>> 0);
    return arr;
  }

  private async encrypt(plaintext: BufferSource): Promise<Uint8Array> {
    const nonce = this.counterToNonce(this.sendCounter++);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      this.aesKey!,
      plaintext,
    );
    // Frame: [12 nonce][ciphertext+tag]
    const frame = new Uint8Array(12 + ciphertext.byteLength);
    frame.set(nonce, 0);
    frame.set(new Uint8Array(ciphertext), 12);
    return frame;
  }

  private async decrypt(frame: Uint8Array): Promise<Uint8Array> {
    if (frame.length < 12) {
      throw new Error('Frame too short');
    }
    const nonce = frame.slice(0, 12);

    // Verify nonce matches expected recv counter
    const expectedNonce = this.counterToNonce(this.recvCounter++);
    for (let i = 0; i < 12; i++) {
      if (nonce[i] !== expectedNonce[i]) {
        throw new Error('Nonce mismatch — possible replay or reorder');
      }
    }

    const ciphertext = frame.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      this.aesKey!,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  }

  // ---- Heartbeat ----

  private startPing(): void {
    this.missedPings = 0;
    this.pingTimer = setInterval(async () => {
      if (this.state !== 'DIRECT' && this.state !== 'TUNNEL') return;
      this.missedPings++;
      if (this.missedPings > PING_MISS_LIMIT) {
        console.warn('[DirectWs] Too many missed pings, closing');
        this.ws?.close();
        return;
      }
      try {
        await this.send({ channel: 'system', action: 'ping', data: { ts: Date.now() } });
      } catch {
        // send failure will trigger close
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ---- State & lifecycle ----

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  private fallbackToRelay(): void {
    this.cleanup();
    if (this.disposed) return;
    this.setState('RELAY');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) {
        this.connect().catch((err) => {
          console.error('[DirectWs] Reconnect failed', err);
        });
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private cleanup(): void {
    this.stopPing();
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Remove handlers before closing to avoid triggering fallback
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.aesKey = null;
  }
}
