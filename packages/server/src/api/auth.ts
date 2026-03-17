import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { loginSchema, registerSchema, REFRESH_TOKEN_EXPIRY_DAYS } from '@ccclaw/shared';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken, createRefreshToken, validateRefreshToken, revokeRefreshToken } from '../auth/jwt.js';
import { checkLoginRateLimit, recordLoginFailure, clearLoginAttempts } from '../auth/rate-limit.js';
import { authMiddleware } from '../middleware/auth.js';
import { setCookie, getCookie } from 'hono/cookie';
import type { AppEnv } from '../types.js';

export const authRouter = new Hono<AppEnv>();

authRouter.post('/login', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'unknown';
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return c.json({ error: `登录过于频繁，请 ${limit.retryAfterSeconds}s 后重试` }, 429);
  }

  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [user] = await db.select().from(schema.users)
    .where(eq(schema.users.email, body.data.email)).limit(1);

  if (!user || !(await verifyPassword(body.data.password, user.password))) {
    recordLoginFailure(ip);
    return c.json({ error: '邮箱或密码错误' }, 401);
  }

  clearLoginAttempts(ip);

  const accessToken = await signAccessToken(user.id, user.role);
  const refreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    path: '/api/auth',
  });

  return c.json({ accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

authRouter.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user');
  await revokeRefreshToken(user.sub);
  setCookie(c, 'refresh_token', '', { maxAge: 0, path: '/api/auth' });
  return c.json({ ok: true });
});

authRouter.post('/refresh', async (c) => {
  // 同时支持 cookie 和 body 两种方式
  let token = getCookie(c, 'refresh_token');
  if (!token) {
    try {
      const body = await c.req.json();
      token = body.refreshToken;
    } catch { /* ignore */ }
  }
  if (!token) return c.json({ error: 'Refresh token 缺失' }, 401);

  const userId = await validateRefreshToken(token);
  if (!userId) return c.json({ error: 'Refresh token 无效或已过期' }, 401);

  const [user] = await db.select().from(schema.users)
    .where(eq(schema.users.id, userId)).limit(1);
  if (!user) return c.json({ error: '用户不存在' }, 401);

  const accessToken = await signAccessToken(user.id, user.role);
  const newRefreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    path: '/api/auth',
  });

  return c.json({ accessToken, refreshToken: newRefreshToken });
});

authRouter.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user');
  const [user] = await db.select().from(schema.users)
    .where(eq(schema.users.id, payload.sub)).limit(1);
  if (!user) return c.json({ error: '用户不存在' }, 404);
  return c.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// 邀请码注册
authRouter.post('/register', async (c) => {
  const body = registerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  // 验证邀请码
  const [invite] = await db.select().from(schema.inviteCodes)
    .where(eq(schema.inviteCodes.code, body.data.inviteCode)).limit(1);
  if (!invite || invite.usedBy) return c.json({ error: '邀请码无效或已使用' }, 400);
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return c.json({ error: '邀请码已过期' }, 400);
  }

  // 检查邮箱是否已存在
  const [existing] = await db.select().from(schema.users)
    .where(eq(schema.users.email, body.data.email)).limit(1);
  if (existing) return c.json({ error: '邮箱已注册' }, 400);

  // 创建用户
  const [user] = await db.insert(schema.users).values({
    name: body.data.name,
    email: body.data.email,
    password: await hashPassword(body.data.password),
    role: 'user',
  } as any).returning();

  // 标记邀请码已使用
  await db.update(schema.inviteCodes)
    .set({ usedBy: user.id, usedAt: new Date().toISOString() } as any)
    .where(eq(schema.inviteCodes.id, invite.id));

  const accessToken = await signAccessToken(user.id, user.role);
  const refreshToken = await createRefreshToken(user.id);

  setCookie(c, 'refresh_token', refreshToken, {
    httpOnly: true, secure: true, sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60, path: '/api/auth',
  });

  return c.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 201);
});
