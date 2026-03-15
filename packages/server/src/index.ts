import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { logger } from './logger.js';
import { api } from './api/index.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';

const app = new Hono();

// 全局中间件
app.use('*', securityHeaders);
app.use('*', corsMiddleware);

// API 路由
app.route('/api', api);

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok' }));

// 启动服务
serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(`CCCLaw server running on port ${info.port}`);
});

export default app;
