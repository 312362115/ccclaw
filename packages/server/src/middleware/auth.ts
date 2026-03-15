import type { Context, Next } from 'hono';
import { verifyAccessToken } from '../auth/jwt.js';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '未认证' }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token);
    c.set('user' as never, payload as never);
    return next();
  } catch {
    return c.json({ error: 'Token 无效或已过期' }, 401);
  }
}
