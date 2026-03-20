import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { config } from '../config.js';

export const securityHeadersMiddleware = secureHeaders(
  config.NODE_ENV === 'production'
    ? {
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      }
    : undefined, // 开发环境不启用 CSP（Vite HMR 需要宽松策略）
);

export const corsMiddleware = cors({
  origin: config.NODE_ENV === 'development' ? '*' : (origin) => origin,
  credentials: true,
});
