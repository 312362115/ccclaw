// @ccclaw/agent-runtime — Runner 进程入口
// 连接 Server 的 WebSocket，接收任务请求，调用 Agent 执行

import { WebSocket } from 'ws';
import { resolve } from 'node:path';
import { runAgent } from './agent.js';
import type { ServerMessage, AgentResponse } from './protocol.js';

// ====== 环境变量 ======

const RUNNER_ID = process.env.RUNNER_ID;
const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const ALLOWED_PATHS = (process.env.ALLOWED_PATHS || WORKSPACE_DIR).split(':').map(p => resolve(p));

if (!RUNNER_ID || !SERVER_URL || !AUTH_TOKEN) {
  console.error('缺少必需环境变量: RUNNER_ID, SERVER_URL, AUTH_TOKEN');
  process.exit(1);
}

// ====== 路径白名单安全校验 ======

function isPathAllowed(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  return ALLOWED_PATHS.some(base => resolved.startsWith(base));
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
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
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

// ====== 消息处理 ======

function handleServerMessage(msg: ServerMessage) {
  if (msg.type === 'registered') {
    console.log(`[runner:${RUNNER_ID}] 注册成功`);
    return;
  }

  if (msg.type === 'pong') {
    return;
  }

  if (msg.type === 'request' && msg.requestId && msg.data) {
    handleRequest(msg.requestId, msg.data).catch((err) => {
      console.error(`[runner:${RUNNER_ID}] 请求处理失败:`, err);
      sendResponse(msg.requestId!, { type: 'error', message: String(err) });
    });
  }
}

async function handleRequest(requestId: string, request: import('./protocol.js').AgentRequest) {
  // 路径安全检查：workspaceDir 必须在白名单内
  if (!isPathAllowed(WORKSPACE_DIR)) {
    sendResponse(requestId, { type: 'error', message: '工作区路径不在白名单中' });
    return;
  }

  const onStream = (msg: AgentResponse) => {
    sendResponse(requestId, msg);
  };

  await runAgent(request, onStream);
}

function sendResponse(requestId: string, data: AgentResponse) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'response', requestId, data }));
  }
}

// ====== 优雅退出 ======

function shutdown() {
  console.log(`[runner:${RUNNER_ID}] 正在关闭...`);
  stopHeartbeat();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.close(1000, '进程退出');
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ====== 启动 ======

console.log(`[runner:${RUNNER_ID}] 启动，连接 ${SERVER_URL}`);
connect();
