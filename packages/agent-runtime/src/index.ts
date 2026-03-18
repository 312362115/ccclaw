// @ccclaw/agent-runtime — Runner 进程入口
// 连接 Server 的 WebSocket，接收任务请求，调用 Agent 执行

import { WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import { runAgent } from './agent.js';
import type { AgentDeps } from './agent.js';
import type { ServerMessage, AgentResponse } from './protocol.js';
import { generateECDHKeyPair, deriveSharedKey, publicKeyFromBase64, decrypt as aesDecrypt } from '@ccclaw/shared';
import { DirectServer } from './direct-server.js';
import { FileWatcher } from './file-watcher.js';
import { TreeHandler } from './handlers/tree-handler.js';
import { FileHandler } from './handlers/file-handler.js';
import type { DirectMessage, TreeListData, FileReadData, FileCreateData, FileDeleteData, FileStatData } from '@ccclaw/shared';

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
import { bashTool, fileTool, gitTool, globTool, grepTool, webFetchTool } from './tools/index.js';
import { createMemoryTools } from './tools/memory.js';
import { createTodoTools } from './tools/todo.js';

// ====== 环境变量 ======

const RUNNER_ID = process.env.RUNNER_ID;
const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const INTERNAL_DIR = process.env.INTERNAL_DIR || join(WORKSPACE_DIR, '..', 'internal');
const WORKSPACE_DB = process.env.WORKSPACE_DB || join(INTERNAL_DIR, 'workspace.db');
const ALLOWED_PATHS = (process.env.ALLOWED_PATHS || WORKSPACE_DIR).split(':').map(p => resolve(p));

if (!RUNNER_ID || !SERVER_URL || !AUTH_TOKEN) {
  console.error('缺少必需环境变量: RUNNER_ID, SERVER_URL, AUTH_TOKEN');
  process.exit(1);
}

// ====== ECDH 密钥对 & 直连服务 ======

const registrationKeyPair = generateECDHKeyPair();
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
    toolRegistry.register(fileTool);
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

    console.log(`[runner:${RUNNER_ID}] 模块初始化完成: ${toolRegistry.size} 个工具, ${skillLoader.getSkills().length} 个 Skill`);
  } catch (err) {
    console.error(`[runner:${RUNNER_ID}] 模块初始化失败:`, err);
    // 模块初始化失败时仍可启动（echo 模式）
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

    directServer = new DirectServer({
      keyPair: registrationKeyPair,
      verifyToken: async (token: string) => token === AUTH_TOKEN!,
      onMessage: (clientId: string, msg: DirectMessage) => handleDirectMessage(clientId, msg, treeHandler, fileHandler),
    });

    await directServer.start();
    await fileWatcher.start();

    // Broadcast file events to all direct-connected clients
    fileWatcher.on('events', (events) => {
      directServer?.broadcastToAll({
        channel: 'tree',
        action: 'events',
        data: { events },
      });
    });

    console.log(`[runner:${RUNNER_ID}] 直连服务已启动: ${directServer.directUrl}`);
  } catch (err) {
    console.error(`[runner:${RUNNER_ID}] 直连服务启动失败:`, err);
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

  if (channel === 'tree' && action === 'list') {
    const d = data as TreeListData;
    treeHandler.list(d.path, d.depth).then(sendReply).catch((err) => sendError('TREE_ERROR', String(err)));
    return;
  }

  if (channel === 'chat') {
    if (action === 'message') {
      const d = data as { sessionId: string; message: string };
      if (!cachedProvider) {
        sendError('NO_PROVIDER', 'Provider 未配置');
        return;
      }

      const request: import('./protocol.js').AgentRequest = {
        method: 'run',
        params: { sessionId: d.sessionId, message: d.message },
      };
      const deps: AgentDeps | undefined = sharedDeps
        ? { ...sharedDeps, provider: cachedProvider }
        : undefined;

      const onStream = (event: AgentResponse) => {
        directServer?.sendToClient(clientId, {
          channel: 'chat',
          action: event.type,
          requestId,
          data: event,
        });
      };

      runAgent(request, onStream, deps).catch((err) => {
        directServer?.sendToClient(clientId, {
          channel: 'chat',
          action: 'error',
          requestId,
          data: { type: 'error', message: err instanceof Error ? err.message : String(err) },
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

  console.warn(`[runner:${RUNNER_ID}] 未知直连消息: ${channel}/${action}`);
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
    console.log(`[runner:${RUNNER_ID}] 已连接 Server`);
    reconnectAttempts = 0;
    startHeartbeat();

    // Send ECDH registration with public key and direct URL
    const registerMsg: import('./protocol.js').RunnerMessage = {
      type: 'register',
      publicKey: registrationKeyPair.publicKeyBase64,
      directUrl: directServer?.directUrl ?? '',
    };
    sendToServer(registerMsg);
  });

  ws.on('message', (raw) => {
    try {
      const msg: ServerMessage = JSON.parse(raw.toString());
      handleServerMessage(msg);
    } catch (err) {
      console.error(`[runner:${RUNNER_ID}] 消息解析失败:`, err);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`[runner:${RUNNER_ID}] 连接关闭: ${code} ${reason.toString()}`);
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[runner:${RUNNER_ID}] WebSocket 错误:`, err.message);
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
  console.log(`[runner:${RUNNER_ID}] ${delay}ms 后重连 (第 ${reconnectAttempts} 次)`);
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

function applyConfig(cfg: import('./protocol.js').RuntimeConfig) {
  try {
    cachedProvider = LLMProviderFactory.create({
      type: cfg.providerType || 'claude',
      apiKey: cfg.apiKey,
      apiBase: cfg.apiBase,
      defaultModel: cfg.model,
    });
    console.log(`[runner:${RUNNER_ID}] Provider 已缓存: type=${cfg.providerType}, model=${cfg.model || 'default'}`);
  } catch (err) {
    console.error(`[runner:${RUNNER_ID}] Provider 创建失败:`, err);
    cachedProvider = null;
  }
  cachedSystemPrompt = cfg.systemPrompt;
  cachedSkills = cfg.skills ?? [];
}

// ====== 消息处理 ======

function handleServerMessage(msg: ServerMessage) {
  if (msg.type === 'registered') {
    console.log(`[runner:${RUNNER_ID}] 注册成功`);
    return;
  }

  if (msg.type === 'pong') {
    return;
  }

  // 启动注入 / 变动下发（支持加密 config）
  if (msg.type === 'config') {
    if (msg.encrypted && msg.serverPublicKey) {
      try {
        const serverPub = publicKeyFromBase64(msg.serverPublicKey);
        const sharedKey = deriveSharedKey(registrationKeyPair.privateKey, serverPub);
        const plaintext = aesDecrypt(msg.encrypted, sharedKey.toString('hex'));
        const cfg = JSON.parse(plaintext) as import('./protocol.js').RuntimeConfig;
        applyConfig(cfg);
      } catch (err) {
        console.error(`[runner:${RUNNER_ID}] 加密 config 解密失败:`, err);
      }
    } else if (msg.data) {
      applyConfig(msg.data);
    }
    return;
  }

  if (msg.type === 'request') {
    handleRequest(msg.requestId, msg.data).catch((err) => {
      console.error(`[runner:${RUNNER_ID}] 请求处理失败:`, err);
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
      console.warn(`[runner:${RUNNER_ID}] 未找到 confirm resolver: ${msg.confirmRequestId}`);
    }
    return;
  }

  if (msg.type === 'terminal_open') {
    terminalManager?.open(msg.terminalId, msg.cols, msg.rows);
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

  // 直接使用缓存的 provider，不再每次创建
  const deps: AgentDeps | undefined = sharedDeps
    ? { ...sharedDeps, provider: cachedProvider }
    : undefined;

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
  console.log(`[runner:${RUNNER_ID}] 正在关闭...`);
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

console.log(`[runner:${RUNNER_ID}] 启动，连接 ${SERVER_URL}`);
initModules();
startDirectServer().then(() => connect());
