import { Hono } from 'hono';
import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { api } from './api/index.js';
import { securityHeadersMiddleware, corsMiddleware } from './middleware/security.js';
import { requestLogger } from './middleware/request-logger.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { createWebSocketHandler } from './channel/webui.js';
import { createFeishuChannel } from './channel/feishu.js';
import { runnerManager } from './core/runner-manager.js';
import { startScheduler } from './core/scheduler.js';
import { agentManager } from './core/agent-manager.js';
import { startHeartbeat } from './core/heartbeat.js';
import { startBackupSchedule } from './core/backup-schedule.js';
import { db, schema } from './db/index.js';

const app = new Hono();

// 全局中间件
app.use('*', securityHeadersMiddleware);
app.use('*', corsMiddleware);
app.use('*', requestLogger);

// API 路由
app.route('/api', api);

// 健康检查（含依赖状态）
app.get('/health', async (c) => {
  const checks: Record<string, unknown> = {
    status: 'ok' as 'ok' | 'degraded',
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    db: false,
    runners: 0,
  };

  try {
    await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    checks.db = true;
  } catch {
    checks.status = 'degraded';
  }

  checks.runners = runnerManager.getOnlineCount();

  return c.json(checks);
});

// Feishu 渠道（webhook 路由）
const feishuChannel = createFeishuChannel();
if (feishuChannel) {
  app.route('/feishu', feishuChannel);
}

// 生产环境：托管 WebUI 静态文件
if (config.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: '../../dist/web' }));
  // SPA fallback
  app.get('*', serveStatic({ path: '../../dist/web/index.html' }));
}

// 创建 HTTP server（给 Hono 和 WebSocket 共用）
const server = createServer((req, res) => {
  // Hono 处理 HTTP 请求
  Promise.resolve(app.fetch(
    new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([, v]) => v != null).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v!]),
      ),
      body: req.method !== 'GET' && req.method !== 'HEAD' ? (req as any) : undefined,
      // @ts-expect-error duplex needed for streaming request body
      duplex: 'half',
    }),
  )).then(async (response: Response) => {
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  }).catch((err: unknown) => {
    logger.error(err, 'HTTP request handling error');
    res.writeHead(500).end('Internal Server Error');
  });
});

// 挂载 WebSocket（客户端 /ws + Runner /ws/runner）
createWebSocketHandler(server);

// 启动 AgentManager Bus 监听
agentManager.startListening();

// 启动 RunnerManager 清理循环
runnerManager.startCleanupLoop();

// 启动定时任务调度器
startScheduler();

// 启动 Heartbeat 自主唤醒
startHeartbeat({ enabled: !!process.env.HEARTBEAT_ENABLED });

// 启动自动备份（每日凌晨 2 点）+ token_usage 数据清理
startBackupSchedule();

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'CCCLaw server started');
});

export default app;
