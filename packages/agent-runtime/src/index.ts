// @ccclaw/agent-runtime — Runner 进程入口
// 连接 Server 的 WebSocket，接收任务请求，调用 Agent 执行

import { WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import { runAgent } from './agent.js';
import type { AgentDeps } from './agent.js';
import type { ServerMessage, AgentResponse } from './protocol.js';
// ECDH 已移除，加密下沉到传输层（TLS）
import { DirectServer } from './direct-server.js';
import { FileWatcher } from './file-watcher.js';
import { TreeHandler } from './handlers/tree-handler.js';
import { FileHandler } from './handlers/file-handler.js';
import type { DirectMessage, TreeListData, FileReadData, FileCreateData, FileWriteData, FileRenameData, FileDeleteData, FileStatData } from '@ccclaw/shared';

// 模块导入
import { WorkspaceDB } from './workspace-db.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import { Consolidator } from './consolidator.js';
import { LLMProviderFactory } from './llm/index.js';
import { SkillLoader } from './skill-loader.js';
import { MCPManager } from './mcp-manager.js';
import { TerminalManager } from './terminal-manager.js';

// 内置工具
import { bashTool, readTool, writeTool, editTool, gitTool, globTool, grepTool, webFetchTool } from './tools/index.js';
import { createMemoryTools } from './tools/memory.js';
import { createTodoTools } from './tools/todo.js';
import { createSpawnTool } from './tools/spawn.js';
import { SubagentManager } from './subagent-manager.js';
import { HookRunner } from './hook-runner.js';
import { logger } from './logger.js';

// ====== 环境变量 ======

const RUNNER_ID = process.env.RUNNER_ID;
const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const INTERNAL_DIR = process.env.INTERNAL_DIR || join(WORKSPACE_DIR, '..', 'internal');
const WORKSPACE_DB = process.env.WORKSPACE_DB || join(INTERNAL_DIR, 'workspace.db');
const ALLOWED_PATHS = (process.env.ALLOWED_PATHS || WORKSPACE_DIR).split(':').map(p => resolve(p));

if (!RUNNER_ID || !SERVER_URL || !AUTH_TOKEN) {
  logger.fatal('缺少必需环境变量: RUNNER_ID, SERVER_URL, AUTH_TOKEN');
  process.exit(1);
}

// ====== 直连服务 ======

let directServer: DirectServer | null = null;

// ====== 模块初始化 ======

/** Shared modules (provider is per-request, added in handleRequest) */
type SharedDeps = Omit<AgentDeps, 'provider'>;
let sharedDeps: SharedDeps | undefined;
let terminalManager: TerminalManager | undefined;

function initModules(): void {
  try {
    // workspace.db
    const db = new WorkspaceDB(WORKSPACE_DB);

    // ToolRegistry
    const toolRegistry = new ToolRegistry();

    // 注册内置工具
    toolRegistry.register(bashTool);
    toolRegistry.register(readTool);
    toolRegistry.register(writeTool);
    toolRegistry.register(editTool);
    toolRegistry.register(gitTool);
    toolRegistry.register(globTool);
    toolRegistry.register(grepTool);
    toolRegistry.register(webFetchTool);

    // 注册 Memory 和 Todo 工具
    for (const tool of createMemoryTools(db)) toolRegistry.register(tool);
    for (const tool of createTodoTools(db)) toolRegistry.register(tool);

    // SkillLoader
    const skillsDir = join(INTERNAL_DIR, 'skills');
    const skillLoader = new SkillLoader([skillsDir], toolRegistry, WORKSPACE_DIR);
    skillLoader.loadAll();
    skillLoader.registerExecutableSkills();

    // ContextAssembler
    const assembler = new ContextAssembler(db, skillLoader, toolRegistry, WORKSPACE_DIR);

    // Consolidator（LLM callback 由 per-request provider 提供，初始为 null）
    const consolidator = new Consolidator(db, null);

    // HookRunner（工具执行前后触发用户脚本）
    const hookRunner = new HookRunner(WORKSPACE_DIR);
    toolRegistry.setHookRunner(hookRunner);

    // MCP Manager（从环境变量或配置中获取 MCP servers，当前为空）
    const mcpManager = new MCPManager({}, toolRegistry);

    sharedDeps = {
      db,
      assembler,
      toolRegistry,
      consolidator,
      mcpManager,
    };

    // TerminalManager
    terminalManager = new TerminalManager({
      workspaceDir: WORKSPACE_DIR,
      onOutput: (terminalId, data) => {
        sendToServer({ type: 'terminal_output', terminalId, data });
      },
      onExit: (terminalId, code) => {
        sendToServer({ type: 'terminal_exit', terminalId, code });
      },
    });

    logger.info({ tools: toolRegistry.size, skills: skillLoader.getSkills().length }, '模块初始化完成');
  } catch (err) {
    logger.fatal({ err }, '模块初始化失败，Runner 无法正常工作');
    throw err;
  }
}

// ====== 路径白名单安全校验 ======

function isPathAllowed(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  return ALLOWED_PATHS.some(base => resolved.startsWith(base));
}

// ====== 直连服务 ======

async function startDirectServer(): Promise<void> {
  try {
    const treeHandler = new TreeHandler(WORKSPACE_DIR);
    const fileHandler = new FileHandler(WORKSPACE_DIR);
    const fileWatcher = new FileWatcher(WORKSPACE_DIR);

    const DIRECT_HOST = process.env.DIRECT_SERVER_HOST || '127.0.0.1';

    directServer = new DirectServer({
      host: DIRECT_HOST,
      port: parseInt(process.env.DIRECT_SERVER_PORT || '0', 10),
      verifyToken: async (token: string) => {
        // 1. Runner secret (Server → Runner 内部通信)
        if (token === AUTH_TOKEN!) return true;
        // 2. JWT token (浏览器直连，用 JWT_SECRET 验证)
        const jwtSecret = process.env.JWT_SECRET;
        if (jwtSecret && token.includes('.')) {
          try {
            const [, payloadB64] = token.split('.');
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
            // 简单验证：检查 token 未过期且能解码
            // 完整的签名验证需要 jsonwebtoken 库，这里用 HMAC 手动验证
            const { createHmac } = await import('node:crypto');
            const [headerB64, pB64, signature] = token.split('.');
            const expected = createHmac('sha256', jwtSecret)
              .update(`${headerB64}.${pB64}`)
              .digest('base64url');
            if (expected !== signature) return false;
            if (payload.exp && payload.exp * 1000 < Date.now()) return false;
            return true;
          } catch {
            return false;
          }
        }
        return false;
      },
      onMessage: (clientId: string, msg: DirectMessage) => handleDirectMessage(clientId, msg, treeHandler, fileHandler),
    });

    await directServer.start();

    // Set up tunnel send callback — pipe JSON frames back to Server
    directServer.setTunnelSend((clientId: string, data: string) => {
      sendToServer({ type: 'tunnel_frame', clientId, data });
    });

    await fileWatcher.start();

    // Broadcast file events to all direct-connected clients
    fileWatcher.on('events', (events) => {
      directServer?.broadcastToAll({
        channel: 'tree',
        action: 'events',
        data: { events },
      });
    });

    logger.info({ url: directServer.directUrl }, '直连服务已启动');
  } catch (err) {
    logger.error({ err }, '直连服务启动失败');
    directServer = null;
  }
}

function handleDirectMessage(
  clientId: string,
  msg: DirectMessage,
  treeHandler: TreeHandler,
  fileHandler: FileHandler,
): void {
  const { channel, action, requestId, data } = msg;

  const sendReply = (replyData: unknown) => {
    if (!directServer || !requestId) return;
    directServer.sendToClient(clientId, {
      channel,
      action: action + '_result',
      requestId,
      data: replyData,
    });
  };

  const sendError = (code: string, message: string) => {
    if (!directServer || !requestId) return;
    directServer.sendToClient(clientId, {
      channel,
      action: 'error',
      requestId,
      data: { code, message },
    });
  };

  // 处理 system ping → 回复 pong
  if (channel === 'system' && action === 'ping') {
    if (directServer) {
      directServer.sendToClient(clientId, { channel: 'system', action: 'pong', data: {} });
    }
    return;
  }

  if (channel === 'tree' && action === 'list') {
    const d = data as TreeListData;
    treeHandler.list(d.path, d.depth).then(sendReply).catch((err) => sendError('TREE_ERROR', String(err)));
    return;
  }

  if (channel === 'chat') {
    if (action === 'message') {
      const d = data as { sessionId: string; message: string };
      logger.info({ sessionId: d.sessionId, message: d.message?.slice(0, 50), hasProvider: !!cachedProvider, hasSharedDeps: !!sharedDeps }, '收到 chat 消息（直连通道）');
      if (!cachedProvider) {
        sendError('NO_PROVIDER', 'Provider 未配置');
        return;
      }

      const request: import('./protocol.js').AgentRequest = {
        method: 'run',
        params: { sessionId: d.sessionId, message: d.message },
      };
      const deps: AgentDeps | undefined = sharedDeps
        ? {
            ...sharedDeps,
            provider: cachedProvider,
            serverContext: {
              workspaceId: cachedWorkspaceId,
              workspaceName: '',
              userPreferences: cachedUserPreferences,
            },
          }
        : undefined;

      // 注册 spawn 工具
      if (deps && cachedProvider) {
        const subagentManager = new SubagentManager(deps.db, cachedProvider, deps.toolRegistry);
        const spawnTool = createSpawnTool(subagentManager, d.sessionId);
        if (!deps.toolRegistry.getTool('spawn')) {
          deps.toolRegistry.register(spawnTool);
        }
      }

      // 注册 confirm 回调：发 confirm_request 到前端，等待 confirm_response
      if (deps) {
        deps.toolRegistry.setConfirmCallback(async (toolName, input, reason) => {
          const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          directServer?.sendToClient(clientId, {
            channel: 'chat',
            action: 'confirm_request',
            requestId,
            data: {
              sessionId: d.sessionId,
              requestId: confirmId,
              tool: toolName,
              input,
              reason,
            },
          });
          return waitForConfirm(confirmId);
        });
      }

      const onStream = (event: AgentResponse) => {
        directServer?.sendToClient(clientId, {
          channel: 'chat',
          action: event.type,
          requestId,
          data: { ...event, sessionId: d.sessionId },
        });
      };

      logger.info({ sessionId: d.sessionId }, '开始调用 runAgent');
      runAgent(request, onStream, deps).then(() => {
        logger.info({ sessionId: d.sessionId }, 'runAgent 完成');
      }).catch((err) => {
        logger.error({ sessionId: d.sessionId, err: String(err) }, 'runAgent 失败');
        directServer?.sendToClient(clientId, {
          channel: 'chat',
          action: 'error',
          requestId,
          data: { type: 'error', sessionId: d.sessionId, message: err instanceof Error ? err.message : String(err) },
        });
      });
      return;
    }

    if (action === 'confirm_response') {
      const d = data as { requestId: string; approved: boolean };
      const resolver = pendingConfirms.get(d.requestId);
      if (resolver) {
        pendingConfirms.delete(d.requestId);
        resolver(d.approved);
      }
      return;
    }
  }

  if (channel === 'file') {
    if (action === 'read') {
      const d = data as FileReadData;
      fileHandler.read(d.path).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
    if (action === 'create') {
      const d = data as FileCreateData;
      fileHandler.create(d.path, d.type, d.content).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
    if (action === 'write') {
      const d = data as FileWriteData;
      fileHandler.write(d.path, d.content).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
    if (action === 'rename') {
      const d = data as FileRenameData;
      fileHandler.rename(d.oldPath, d.newPath).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
    if (action === 'delete') {
      const d = data as FileDeleteData;
      fileHandler.delete(d.path).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
    if (action === 'stat') {
      const d = data as FileStatData;
      fileHandler.stat(d.path).then(sendReply).catch((err) => sendError('FILE_ERROR', String(err)));
      return;
    }
  }

  logger.warn({ channel, action }, '未知直连消息');
}

// ====== WebSocket 连接 ======

const HEARTBEAT_INTERVAL = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;

function connect() {
  const url = `${SERVER_URL}?runnerId=${RUNNER_ID}&token=${AUTH_TOKEN}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    logger.info('已连接 Server');
    reconnectAttempts = 0;
    startHeartbeat();

    // Send registration with direct URL
    sendToServer({
      type: 'register',
      directUrl: directServer?.directUrl ?? '',
    });
  });

  ws.on('message', (raw) => {
    try {
      const msg: ServerMessage = JSON.parse(raw.toString());
      handleServerMessage(msg);
    } catch (err) {
      logger.error({ err }, '消息解析失败');
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn({ code, reason: reason.toString() }, '连接关闭');
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    logger.error({ err: err.message }, 'WebSocket 错误');
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    sendToServer({ type: 'ping' });
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  logger.info({ delay, attempt: reconnectAttempts }, '准备重连');
  setTimeout(connect, delay);
}

// ====== Pending Confirm Resolvers ======

// Map from confirmId → resolver function (called when server forwards confirm_response)
const pendingConfirms = new Map<string, (approved: boolean) => void>();

export function waitForConfirm(confirmId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirms.set(confirmId, resolve);
  });
}

// ====== 缓存的 Provider（启动时注入，变动时更新）======

let cachedProvider: import('./llm/types.js').LLMProvider | null = null;
let cachedSystemPrompt: string | undefined;
let cachedSkills: string[] = [];
let cachedWorkspaceId: string = '';
let cachedUserPreferences: { customInstructions?: string; toolConfirmMode?: string } = {};

function applyConfig(cfg: import('./protocol.js').RuntimeConfig) {
  try {
    // Docker 容器内 127.0.0.1/localhost 指向容器自身，需替换为宿主机地址
    let apiBase = cfg.apiBase;
    if (apiBase && process.env.DIRECT_SERVER_ADVERTISE_HOST === 'host.docker.internal') {
      apiBase = apiBase.replace(/\/\/(127\.0\.0\.1|localhost)([:\/])/g, '//host.docker.internal$2');
    }

    cachedProvider = LLMProviderFactory.create({
      type: cfg.providerType || 'claude',
      apiKey: cfg.apiKey,
      apiBase,
      defaultModel: cfg.model,
    });
    // 同步 Provider 的上下文窗口和 LLM 回调到 Consolidator
    if (sharedDeps?.consolidator) {
      const contextWindow = cachedProvider.capabilities().contextWindow;
      sharedDeps.consolidator.setContextWindow(contextWindow);
      // 注入 LLM 回调，让 Consolidator 能调用 LLM 做总结/压缩
      const provider = cachedProvider;
      sharedDeps.consolidator.setCallLLM(async (params) => {
        const resp = await provider.chat({
          model: cfg.model || (provider as any).defaultModel || 'default',
          systemPrompt: params.systemPrompt,
          messages: params.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          maxTokens: 2048,
          temperature: 0.1,
        });
        return resp;
      });
      logger.info({ type: cfg.providerType, model: cfg.model || 'default', contextWindow }, 'Provider 已缓存');
    } else {
      logger.info({ type: cfg.providerType, model: cfg.model || 'default' }, 'Provider 已缓存');
    }
  } catch (err) {
    logger.error({ err }, 'Provider 创建失败');
    cachedProvider = null;
  }
  cachedSystemPrompt = cfg.systemPrompt;
  cachedSkills = cfg.skills ?? [];
  cachedWorkspaceId = cfg.workspaceId || '';
  cachedUserPreferences = cfg.userPreferences || {};
}

// ====== 消息处理 ======

function handleServerMessage(msg: ServerMessage) {
  if (msg.type === 'registered') {
    logger.info('注册成功');
    return;
  }

  if (msg.type === 'pong') {
    return;
  }

  // 启动注入 / 变动下发（明文 config）
  if (msg.type === 'config') {
    logger.info({ hasData: !!msg.data, providerType: (msg.data as any)?.providerType }, '收到 config 消息');
    if (msg.data) {
      applyConfig(msg.data);
    }
    return;
  }

  if (msg.type === 'request') {
    handleRequest(msg.requestId, msg.data).catch((err) => {
      logger.error({ err }, '请求处理失败');
      sendResponse(msg.requestId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }

  if (msg.type === 'confirm_response') {
    const resolver = pendingConfirms.get(msg.confirmRequestId);
    if (resolver) {
      pendingConfirms.delete(msg.confirmRequestId);
      resolver(msg.approved);
    } else {
      logger.warn({ confirmRequestId: msg.confirmRequestId }, '未找到 confirm resolver');
    }
    return;
  }

  if (msg.type === 'terminal_open') {
    if (!terminalManager) {
      logger.warn({ terminalId: msg.terminalId }, 'terminal_open: terminalManager 未初始化');
    } else {
      const ok = terminalManager.open(msg.terminalId, msg.cols, msg.rows);
      logger.info({ terminalId: msg.terminalId, ok, active: terminalManager.getActiveCount() }, 'terminal_open 处理完成');
    }
    return;
  }
  if (msg.type === 'terminal_input') {
    terminalManager?.write(msg.terminalId, msg.data);
    return;
  }
  if (msg.type === 'terminal_resize') {
    terminalManager?.resize(msg.terminalId, msg.cols, msg.rows);
    return;
  }
  if (msg.type === 'terminal_close') {
    terminalManager?.close(msg.terminalId);
    return;
  }

  if (msg.type === 'tunnel_frame') {
    directServer?.handleTunnelFrame(msg.clientId, msg.data);
    return;
  }
}

async function handleRequest(requestId: string, request: import('./protocol.js').AgentRequest) {
  if (!isPathAllowed(WORKSPACE_DIR)) {
    sendResponse(requestId, { type: 'error', message: '工作区路径不在白名单中' });
    return;
  }

  if (!cachedProvider) {
    sendResponse(requestId, { type: 'error', message: 'Provider 未配置，请先在工作区设置中绑定 API Key' });
    return;
  }

  const onStream = (msg: AgentResponse) => {
    sendResponse(requestId, msg);
  };

  // 直接使用缓存的 provider 和 serverContext
  const deps: AgentDeps | undefined = sharedDeps
    ? {
        ...sharedDeps,
        provider: cachedProvider,
        serverContext: {
          workspaceId: cachedWorkspaceId,
          workspaceName: '',
          userPreferences: cachedUserPreferences,
        },
      }
    : undefined;

  // 注册 spawn 工具（per-request，需要 provider 和 sessionId）
  if (deps && cachedProvider) {
    const sessionId = request.params.sessionId;
    const subagentManager = new SubagentManager(deps.db, cachedProvider, deps.toolRegistry);
    const spawnTool = createSpawnTool(subagentManager, sessionId);
    if (!deps.toolRegistry.getTool('spawn')) {
      deps.toolRegistry.register(spawnTool);
    }
  }

  // 注册 confirm 回调（RELAY 路径：通过 Server WebSocket 转发）
  if (deps) {
    deps.toolRegistry.setConfirmCallback(async (toolName, input, reason) => {
      const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sendResponse(requestId, {
        type: 'confirm_request',
        requestId: confirmId,
        tool: toolName,
        input,
        reason,
      });
      return waitForConfirm(confirmId);
    });
  }

  await runAgent(request, onStream, deps);
}

function sendToServer(msg: import('./protocol.js').RunnerMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendResponse(requestId: string, data: AgentResponse) {
  sendToServer({ type: 'response', requestId, data });
}

// ====== 优雅退出 ======

function shutdown() {
  logger.info('正在关闭...');
  stopHeartbeat();
  terminalManager?.closeAll();
  if (sharedDeps?.db) {
    sharedDeps.db.close();
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.close(1000, '进程退出');
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ====== 启动 ======

logger.info({ serverUrl: SERVER_URL }, '启动');
initModules();
startDirectServer().then(() => connect());
