// DirectWsClient — 直连 Runner 的 WebSocket 客户端（纯 JSON，JWT 认证）
import { api, getAccessToken, ApiError } from './client';

export type ConnectionState = 'INIT' | 'CONNECTING' | 'DIRECT' | 'TUNNEL' | 'RELAY' | 'DISCONNECTED';

interface DirectWsClientOptions {
  workspaceId: string;
  onStateChange: (state: ConnectionState) => void;
  onMessage: (msg: any) => void;
}

interface RunnerInfo {
  directUrl: string;
  fallback: boolean;
}

const DIRECT_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 15000;
const PING_MISS_LIMIT = 3;
const RECONNECT_INTERVAL_MS = 30000;

export class DirectWsClient {
  private state: ConnectionState = 'INIT';
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

    // 1. 获取 runner 信息
    let info: RunnerInfo;
    try {
      info = await api<RunnerInfo>('/workspaces/' + this.workspaceId + '/runner-info');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        console.log('[DirectWs] Runner not online, triggering ensure-config to start runner...');
        try {
          await api('/workspaces/' + this.workspaceId + '/ensure-config', { method: 'POST' });
          // Runner 启动后重试获取 runner-info
          info = await api<RunnerInfo>('/workspaces/' + this.workspaceId + '/runner-info');
        } catch {
          console.warn('[DirectWs] Runner failed to start, falling back to RELAY');
          this.fallbackToRelay();
          return;
        }
      } else {
        console.warn('[DirectWs] Failed to fetch runner-info, falling back to RELAY', err);
        this.fallbackToRelay();
        return;
      }
    }

    // 2. 尝试直连
    const token = getAccessToken();
    const directOk = await this.tryWebSocket(
      info.directUrl + '?token=' + token,
      'DIRECT',
      DIRECT_TIMEOUT_MS,
    );
    if (directOk) return;

    // 3. 直连失败，尝试隧道
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tunnelUrl = `${protocol}//${location.host}/ws/tunnel?token=${token}&workspaceId=${this.workspaceId}`;
    const tunnelOk = await this.tryWebSocket(tunnelUrl, 'TUNNEL');
    if (tunnelOk) return;

    // 4. 隧道也失败，回退 RELAY
    this.fallbackToRelay();
  }

  async send(msg: unknown): Promise<void> {
    if ((this.state !== 'DIRECT' && this.state !== 'TUNNEL') || !this.ws) {
      throw new Error('DirectWsClient is not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.disposed = true;
    this.cleanup();
    this.setState('DISCONNECTED');
  }

  // ---- WebSocket 连接尝试 ----

  /**
   * 尝试连接指定 URL，成功后设置为 targetState 并挂载消息处理。
   * 返回 true 表示连接成功并已进入目标状态。
   */
  private tryWebSocket(
    url: string,
    targetState: 'DIRECT' | 'TUNNEL',
    timeoutMs?: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.disposed) { resolve(false); return; }

      const ws = new WebSocket(url);
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const fail = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        resolve(false);
      };

      if (timeoutMs) {
        timer = setTimeout(fail, timeoutMs);
      }

      ws.onerror = () => fail();

      ws.onclose = () => fail();

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);

        // 连接成功，挂载到实例
        this.ws = ws;
        this.setState(targetState);
        this.attachHandlers(ws);
        this.startPing();
        resolve(true);
      };
    });
  }

  private attachHandlers(ws: WebSocket): void {
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));

        // 系统 pong 内部处理
        if (msg.channel === 'system' && msg.action === 'pong') {
          this.missedPings = 0;
          return;
        }

        console.log('[DirectWs] 收到消息', msg.channel, msg.action, JSON.stringify(msg.data).slice(0, 100));
        this.onMessage(msg);
      } catch (err) {
        console.error('[DirectWs] Message parse error', err);
      }
    };

    ws.onerror = () => {
      console.warn('[DirectWs] WebSocket error');
    };

    ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      if (!this.disposed) {
        this.setState('DISCONNECTED');
        this.scheduleReconnect();
      }
    };
  }

  // ---- 心跳 ----

  private startPing(): void {
    this.missedPings = 0;
    this.pingTimer = setInterval(() => {
      if (this.state !== 'DIRECT' && this.state !== 'TUNNEL') return;
      this.missedPings++;
      if (this.missedPings > PING_MISS_LIMIT) {
        console.warn('[DirectWs] Too many missed pings, closing');
        this.ws?.close();
        return;
      }
      try {
        this.send({ channel: 'system', action: 'ping', data: {} });
      } catch {
        // send 失败会触发 close
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ---- 状态与生命周期 ----

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
