import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { config } from '../config.js';

export const securityHeaders = secureHeaders();

export const corsMiddleware = cors({
  origin: config.NODE_ENV === 'development' ? '*' : (origin) => origin,
  credentials: true,
});
