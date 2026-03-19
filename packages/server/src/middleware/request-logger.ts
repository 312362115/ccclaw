import type { Context, Next } from 'hono';
import { logger } from '../logger.js';

export async function requestLogger(c: Context, next: Next) {
  const start = performance.now();
  await next();
  const ms = Math.round(performance.now() - start);
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: ms,
  }, 'request');
}
