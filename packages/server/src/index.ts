import { Hono } from 'hono';
import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { api } from './api/index.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { createWebSocketHandler } from './channel/webui.js';
import { runnerManager } from './core/runner-manager.js';

const app = new Hono();

// 全局中间件
app.use('*', securityHeaders);
app.use('*', corsMiddleware);

// API 路由
app.route('/api', api);

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok' }));

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

// 启动 RunnerManager 清理循环
runnerManager.startCleanupLoop();

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'CCCLaw server started');
});

export default app;
