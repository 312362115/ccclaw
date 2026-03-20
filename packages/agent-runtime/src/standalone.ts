/**
 * Standalone Agent Service — OpenAI 兼容 API
 *
 * 独立运行的 Agent 服务，不连接 Server。
 * 暴露 /v1/chat/completions 接口，工具调用对外不可见。
 *
 * 启动：node dist/standalone.js --port 8080
 * 环境变量：
 *   STANDALONE_API_KEY     — 调用方 Bearer Token（必须）
 *   STANDALONE_PROVIDER    — LLM Provider 类型（默认 claude）
 *   STANDALONE_PROVIDER_KEY — LLM Provider API Key（必须）
 *   STANDALONE_MODEL       — 默认模型
 *   STANDALONE_API_BASE    — 自定义 API endpoint
 *   STANDALONE_RATE_LIMIT  — 每分钟请求上限（默认 60）
 *   WORKSPACE_DIR          — 工作区目录（默认 /workspace）
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { runAgent, type AgentDeps } from './agent.js';
import { WorkspaceDB } from './workspace-db.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import { Consolidator } from './consolidator.js';
import { LLMProviderFactory } from './llm/index.js';
import type { LLMProvider, AgentStreamEvent } from './llm/types.js';
import { SkillLoader } from './skill-loader.js';
import { MCPManager } from './mcp-manager.js';
import { HookRunner } from './hook-runner.js';
import { bashTool, readTool, writeTool, editTool, gitTool, globTool, grepTool, webFetchTool } from './tools/index.js';
import { createMemoryTools } from './tools/memory.js';
import { createTodoTools } from './tools/todo.js';
import {
  parseOpenAIRequest,
  extractUserMessage,
  sseChunk,
  sseDone,
  nonStreamingResponse,
  shouldEmitToClient,
  nextCompletionId,
} from './openai-compat.js';

// ====== 配置 ======

const API_KEY = process.env.STANDALONE_API_KEY;
const PROVIDER_TYPE = process.env.STANDALONE_PROVIDER || 'claude';
const PROVIDER_KEY = process.env.STANDALONE_PROVIDER_KEY;
const MODEL = process.env.STANDALONE_MODEL;
const API_BASE = process.env.STANDALONE_API_BASE;
const RATE_LIMIT = parseInt(process.env.STANDALONE_RATE_LIMIT || '60', 10);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || resolve('.');
const INTERNAL_DIR = process.env.INTERNAL_DIR || join(WORKSPACE_DIR, '.ccclaw-internal');
const WORKSPACE_DB_PATH = process.env.WORKSPACE_DB || join(INTERNAL_DIR, 'workspace.db');
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '8080', 10);

// ====== 安全校验 ======

if (process.env.SERVER_URL) {
  console.error('错误：检测到 SERVER_URL 环境变量，standalone 模式不能与 Server 同时使用');
  process.exit(1);
}

if (!API_KEY) {
  console.error('错误：必须设置 STANDALONE_API_KEY 环境变量');
  process.exit(1);
}

if (!PROVIDER_KEY) {
  console.error('错误：必须设置 STANDALONE_PROVIDER_KEY 环境变量');
  process.exit(1);
}

// ====== 速率限制 ======

const requestTimestamps: number[] = [];

function checkRateLimit(): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  // 清理过期记录
  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) return false;
  requestTimestamps.push(now);
  return true;
}

// ====== 模块初始化 ======

let provider: LLMProvider;
let sharedDeps: Omit<AgentDeps, 'provider'>;

function initModules(): void {
  // Provider
  provider = LLMProviderFactory.create({
    type: PROVIDER_TYPE,
    apiKey: PROVIDER_KEY!,
    apiBase: API_BASE,
    defaultModel: MODEL,
  });

  // workspace.db（确保目录存在）
  const { mkdirSync } = require('node:fs');
  mkdirSync(INTERNAL_DIR, { recursive: true });
  const db = new WorkspaceDB(WORKSPACE_DB_PATH);

  // ToolRegistry
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(bashTool);
  toolRegistry.register(readTool);
  toolRegistry.register(writeTool);
  toolRegistry.register(editTool);
  toolRegistry.register(gitTool);
  toolRegistry.register(globTool);
  toolRegistry.register(grepTool);
  toolRegistry.register(webFetchTool);
  for (const tool of createMemoryTools(db)) toolRegistry.register(tool);
  for (const tool of createTodoTools(db)) toolRegistry.register(tool);

  // SkillLoader
  const skillsDir = join(INTERNAL_DIR, 'skills');
  const skillLoader = new SkillLoader([skillsDir], toolRegistry, WORKSPACE_DIR);
  try { skillLoader.loadAll(); skillLoader.registerExecutableSkills(); } catch { /* 无 skills 不影响 */ }

  // ContextAssembler
  const assembler = new ContextAssembler(db, skillLoader, toolRegistry, WORKSPACE_DIR);

  // Consolidator
  const consolidator = new Consolidator(db, null);
  const contextWindow = provider.capabilities().contextWindow;
  consolidator.setContextWindow(contextWindow);

  // HookRunner
  const hookRunner = new HookRunner(WORKSPACE_DIR);
  toolRegistry.setHookRunner(hookRunner);

  // MCPManager
  const mcpManager = new MCPManager({}, toolRegistry);

  sharedDeps = { db, assembler, toolRegistry, consolidator, mcpManager };

  console.log(`[standalone] 模块初始化完成 (provider=${PROVIDER_TYPE}, model=${MODEL || 'default'}, tools=${toolRegistry.size})`);
}

// ====== HTTP 请求处理 ======

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}

function errorResponse(res: ServerResponse, status: number, message: string, type = 'invalid_request_error'): void {
  jsonResponse(res, status, {
    error: { message, type, code: status },
  });
}

async function handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 认证
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_KEY) {
    errorResponse(res, 401, 'Invalid API key', 'authentication_error');
    return;
  }

  // 速率限制
  if (!checkRateLimit()) {
    errorResponse(res, 429, `Rate limit exceeded (${RATE_LIMIT}/min)`, 'rate_limit_error');
    return;
  }

  // 解析请求
  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    errorResponse(res, 400, 'Invalid JSON body');
    return;
  }

  const parsed = parseOpenAIRequest(body);
  if ('error' in parsed) {
    errorResponse(res, 400, parsed.error);
    return;
  }

  const { messages, stream, model } = parsed;
  const userMessage = extractUserMessage(messages);
  const completionId = nextCompletionId();
  const modelName = model || MODEL || PROVIDER_TYPE;

  // 构建 AgentRequest
  const sessionId = `standalone-${Date.now()}`;
  const agentRequest = {
    method: 'run' as const,
    params: { sessionId, message: userMessage },
  };

  const deps: AgentDeps = {
    ...sharedDeps,
    provider,
    serverContext: {
      workspaceId: 'standalone',
      workspaceName: 'Standalone Agent',
      userPreferences: {},
    },
  };

  if (stream) {
    // ── SSE 流式响应 ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // 首个 chunk：role
    res.write(sseChunk(completionId, modelName, { role: 'assistant', content: '' }, null));

    const onStream = (event: AgentStreamEvent) => {
      const emit = shouldEmitToClient(event);
      if (!emit) return;

      if (emit.type === 'text') {
        res.write(sseChunk(completionId, modelName, { content: emit.text }, null));
      } else if (emit.type === 'done') {
        res.write(sseChunk(completionId, modelName, {}, 'stop'));
        res.write(sseDone());
        res.end();
      }
    };

    try {
      await runAgent(agentRequest, onStream, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(sseChunk(completionId, modelName, { content: `\n\n[Error: ${msg}]` }, 'stop'));
      res.write(sseDone());
      res.end();
    }
  } else {
    // ── 非流式响应 ──
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const onStream = (event: AgentStreamEvent) => {
      const emit = shouldEmitToClient(event);
      if (!emit) return;
      if (emit.type === 'text') fullContent += emit.text;
      if (emit.type === 'done') { inputTokens = emit.inputTokens; outputTokens = emit.outputTokens; }
    };

    try {
      await runAgent(agentRequest, onStream, deps);
      jsonResponse(res, 200, nonStreamingResponse(completionId, modelName, fullContent, inputTokens, outputTokens));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorResponse(res, 500, msg, 'server_error');
    }
  }
}

// ====== HTTP Server ======

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost`);

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    jsonResponse(res, 200, { status: 'ok', mode: 'standalone' });
    return;
  }

  // Chat completions
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    await handleChatCompletion(req, res);
    return;
  }

  // Models (minimal)
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    jsonResponse(res, 200, {
      data: [{ id: MODEL || PROVIDER_TYPE, object: 'model', owned_by: 'ccclaw' }],
    });
    return;
  }

  errorResponse(res, 404, 'Not found');
});

// ====== 启动 ======

initModules();

server.listen(PORT, () => {
  console.log(`[standalone] Agent 服务已启动 http://0.0.0.0:${PORT}`);
  console.log(`[standalone] POST /v1/chat/completions (Bearer Token 认证, ${RATE_LIMIT}/min 限流)`);
});

// 优雅退出
process.on('SIGTERM', () => { console.log('[standalone] 正在关闭...'); server.close(); process.exit(0); });
process.on('SIGINT', () => { console.log('[standalone] 正在关闭...'); server.close(); process.exit(0); });
