import Docker from 'dockerode';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { nanoid } from '@ccclaw/shared';
import { WebSocket } from 'ws';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getWorkspacePaths, buildSafeEnv } from './workspace-storage.js';
import { WORKSPACE_LABEL, SANDBOX_MEMORY_LIMIT, SANDBOX_CPU_QUOTA } from '@ccclaw/shared';

// 启动注入的配置
export interface RuntimeConfig {
  apiKey: string;
  providerType: string;
  apiBase?: string;
  model?: string;
  systemPrompt?: string;
  skills?: string[];
}

// 聊天请求 — 只传消息
export interface AgentRequest {
  method: 'run';
  params: {
    sessionId: string;
    message: string;
  };
}

export interface AgentResponse {
  type: 'text_delta' | 'tool_use' | 'tool_result' | 'confirm_request' | 'done' | 'error';
  [key: string]: unknown;
}

export type StartMode = 'docker' | 'local' | 'remote';

export interface RuntimeConfig {
  startMode: StartMode;
  runnerId: string;
  memory?: string;
  cpu?: string;
  timeout?: number;
}

interface RunnerInfo {
  ws: WebSocket;
  runnerId: string;
  startMode: StartMode;
  lastPing: number;
  workspaces: Set<string>;
  containerId?: string;
  childProcess?: ChildProcess;
  terminalCallback?: (msg: Record<string, unknown>) => void;
}

interface PendingRequest {
  onMessage: (msg: AgentResponse) => void;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const docker = new Docker();

export class RunnerManager {
  private runners = new Map<string, RunnerInfo>();
  private bindings = new Map<string, string>();
  private pendingRequests = new Map<string, PendingRequest>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // ====== Runner 注册 ======

  registerRunner(ws: WebSocket, runnerId: string, startMode: StartMode = 'remote', terminalCallback?: (msg: Record<string, unknown>) => void) {
    const old = this.runners.get(runnerId);
    if (old?.ws.readyState === WebSocket.OPEN) {
      old.ws.close(1000, '被新连接替代');
    }

    const info: RunnerInfo = { ws, runnerId, startMode, lastPing: Date.now(), workspaces: new Set(), terminalCallback };
    this.runners.set(runnerId, info);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          info.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'response' && msg.requestId) {
          const pending = this.pendingRequests.get(msg.requestId);
          if (pending) {
            pending.onMessage(msg.data as AgentResponse);
            if (msg.data.type === 'done' || msg.data.type === 'session_done' || msg.data.type === 'error') {
              clearTimeout(pending.timer);
              pending.resolve();
              this.pendingRequests.delete(msg.requestId);
            }
          }
        } else if (msg.type === 'terminal_output' || msg.type === 'terminal_exit') {
          info.terminalCallback?.(msg as Record<string, unknown>);
        }
      } catch (err) {
        logger.error({ runnerId, error: String(err) }, 'Runner message parse error');
      }
    });

    ws.on('close', () => {
      logger.info({ runnerId }, 'Runner disconnected');
      this.runners.delete(runnerId);
    });

    ws.send(JSON.stringify({ type: 'registered', runnerId }));
    logger.info({ runnerId, startMode }, 'Runner registered');
  }

  // ====== Runner 启动 ======

  async ensureRunner(workspaceId: string) {
    const wsConfig = await this.getWorkspaceConfig(workspaceId);
    const { slug, runnerId, startMode } = wsConfig;

    this.bindings.set(slug, runnerId);

    const runner = this.runners.get(runnerId);
    if (runner?.ws.readyState === WebSocket.OPEN) {
      runner.workspaces.add(slug);
      return { slug, runnerId };
    }

    if (startMode === 'docker') {
      await this.startDockerRunner(slug, runnerId);
    } else if (startMode === 'local') {
      await this.startLocalRunner(slug, runnerId);
    } else {
      throw new Error(`Runner ${runnerId} 不在线，remote 模式需要手动部署 Runner`);
    }

    await this.waitForRunner(runnerId, 15_000);
    const connected = this.runners.get(runnerId);
    if (connected) connected.workspaces.add(slug);
    return { slug, runnerId };
  }

  private async startDockerRunner(slug: string, runnerId: string) {
    const paths = getWorkspacePaths(slug);
    const serverUrl = `ws://host.docker.internal:${config.PORT}/ws/runner`;

    const container = await docker.createContainer({
      Image: 'ccclaw-runner:latest',
      Labels: { [WORKSPACE_LABEL]: 'true', [`${WORKSPACE_LABEL}.slug`]: slug },
      HostConfig: {
        Memory: SANDBOX_MEMORY_LIMIT,
        CpuQuota: SANDBOX_CPU_QUOTA,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=100m' },
        Binds: [
          `${paths.home}:/workspace`,
          `${paths.internal}:/internal`,
          `${paths.skills}:/skills:ro`,
        ],
        NetworkMode: 'bridge',
        ExtraHosts: ['host.docker.internal:host-gateway'],
      },
      Env: [
        `RUNNER_ID=${runnerId}`,
        `SERVER_URL=${serverUrl}`,
        `AUTH_TOKEN=${config.RUNNER_SECRET}`,
        `WORKSPACE_DIR=/workspace`,
        `INTERNAL_DIR=/internal`,
        `WORKSPACE_DB=/internal/workspace.db`,
        `ALLOWED_PATHS=/workspace:/skills:/internal/workspace.db`,
      ],
    });

    await container.start();
    const info = this.runners.get(runnerId);
    if (info) info.containerId = container.id;
    logger.info({ slug, runnerId, containerId: container.id }, 'Docker Runner started');
  }

  private async startLocalRunner(slug: string, runnerId: string) {
    const paths = getWorkspacePaths(slug);
    const safeEnv = buildSafeEnv(slug);
    const serverUrl = `ws://127.0.0.1:${config.PORT}/ws/runner`;

    const child: ChildProcess = fork(
      join(process.cwd(), '..', 'agent-runtime', 'dist', 'index.js'),
      ['--mode', 'runner'],
      {
        cwd: paths.home,
        env: {
          ...safeEnv,
          RUNNER_ID: runnerId,
          SERVER_URL: serverUrl,
          AUTH_TOKEN: config.RUNNER_SECRET,
        },
      },
    ) as ChildProcess;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (child as any).on('exit', (code: number | null) => {
      logger.warn({ slug, runnerId, code }, 'Local Runner exited');
      this.runners.delete(runnerId);
    });

    const info = this.runners.get(runnerId);
    if (info) info.childProcess = child;
    logger.info({ slug, runnerId, pid: child.pid }, 'Local Runner started');
  }

  private waitForRunner(runnerId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        const runner = this.runners.get(runnerId);
        if (runner?.ws.readyState === WebSocket.OPEN) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 200);
      const timer = setTimeout(() => {
        clearInterval(check);
        reject(new Error(`Runner ${runnerId} 启动超时`));
      }, timeoutMs);
    });
  }

  // ====== 配置注入 ======

  sendConfig(workspaceSlug: string, config: RuntimeConfig) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) return;
    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) return;
    runner.ws.send(JSON.stringify({ type: 'config', data: config }));
    logger.info({ runnerId, providerType: config.providerType, model: config.model }, 'Config pushed to runner');
  }

  // ====== 任务下发 ======

  async send(workspaceSlug: string, request: AgentRequest, onMessage: (msg: AgentResponse) => void) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) throw new Error('工作区未绑定 Runner');

    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Runner ${runnerId} 不在线`);
    }

    const requestId = nanoid();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Runner 响应超时'));
      }, 300_000);

      this.pendingRequests.set(requestId, { onMessage, resolve, reject, timer });
      runner.ws.send(JSON.stringify({ type: 'request', requestId, data: request }));
    });
  }

  // ====== 终端消息透传 ======

  sendToRunner(workspaceSlug: string, msg: Record<string, unknown>) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) {
      logger.warn({ workspaceSlug }, 'sendToRunner: 工作区未绑定 Runner');
      return;
    }
    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ runnerId }, 'sendToRunner: Runner 不在线');
      return;
    }
    runner.ws.send(JSON.stringify(msg));
  }

  // ====== Confirm Response ======

  sendConfirmResponse(workspaceSlug: string, requestId: string, approved: boolean) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) {
      logger.warn({ workspaceSlug }, 'sendConfirmResponse: 工作区未绑定 Runner');
      return;
    }
    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ runnerId }, 'sendConfirmResponse: Runner 不在线');
      return;
    }
    runner.ws.send(JSON.stringify({ type: 'confirm_response', confirmRequestId: requestId, approved }));
  }

  // ====== 状态查询 ======

  getStatus(workspaceSlug: string): 'running' | 'stopped' | 'error' {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) return 'stopped';
    const runner = this.runners.get(runnerId);
    if (!runner || runner.ws.readyState !== WebSocket.OPEN) return 'error';
    return 'running';
  }

  getOnlineRunners() {
    return Array.from(this.runners.entries()).map(([id, info]) => ({
      runnerId: id,
      startMode: info.startMode,
      online: info.ws.readyState === WebSocket.OPEN,
      lastPing: info.lastPing,
      workspaces: Array.from(info.workspaces),
    }));
  }

  // ====== 停止与清理 ======

  async stop(workspaceSlug: string) {
    const runnerId = this.bindings.get(workspaceSlug);
    if (!runnerId) return;
    const runner = this.runners.get(runnerId);
    if (runner) {
      runner.workspaces.delete(workspaceSlug);
      if (runner.workspaces.size === 0 && runner.startMode !== 'remote') {
        if (runner.containerId) {
          const container = docker.getContainer(runner.containerId);
          try { await container.stop({ t: 5 }); } catch { /* ignore */ }
          try { await container.remove(); } catch { /* ignore */ }
        }
        if (runner.childProcess) {
          runner.childProcess.kill('SIGTERM');
        }
        runner.ws.close(1000, '不再需要');
        this.runners.delete(runnerId);
      }
    }
    this.bindings.delete(workspaceSlug);
  }

  startCleanupLoop() {
    this.cleanupInterval = setInterval(() => this.cleanIdle().catch(
      (err) => logger.error(err, '清理空闲 Runner 失败')
    ), 60_000);
    logger.info('RunnerManager cleanup loop started');
  }

  stopCleanupLoop() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  private async cleanIdle() {
    const now = Date.now();
    for (const [runnerId, info] of this.runners) {
      if (now - info.lastPing > 60_000) {
        logger.warn({ runnerId }, 'Runner heartbeat timeout');
        info.ws.close(1001, '心跳超时');
        this.runners.delete(runnerId);
      }
    }
  }

  private async getWorkspaceConfig(workspaceId: string): Promise<RuntimeConfig & { slug: string }> {
    const [ws] = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new Error('工作区不存在');

    const settings = (ws.settings as any) || {};
    const startMode: StartMode = settings.startMode || 'local';
    const runnerId: string = settings.runnerId || `runner-${ws.slug}`;

    return {
      slug: ws.slug,
      startMode,
      runnerId,
      ...(settings.runtimeConfig || {}),
    };
  }
}

export const runnerManager = new RunnerManager();
