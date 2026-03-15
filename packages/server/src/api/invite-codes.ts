import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createInviteCodeSchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';
import type { AppEnv } from '../types.js';

export const inviteCodesRouter = new Hono<AppEnv>();

inviteCodesRouter.use('*', authMiddleware, requireRole('admin'));

// GET /api/invite-codes — 邀请码列表
inviteCodesRouter.get('/', async (c) => {
  const rows = await db.select().from(schema.inviteCodes)
    .orderBy(desc(schema.inviteCodes.createdAt));
  return c.json(rows);
});

// POST /api/invite-codes — 生成邀请码
inviteCodesRouter.post('/', async (c) => {
  const body = createInviteCodeSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const userId = c.get('user').sub;
  const codes: string[] = [];

  for (let i = 0; i < (body.data.count ?? 1); i++) {
    const code = randomBytes(6).toString('hex').toUpperCase();
    await db.insert(schema.inviteCodes).values({
      code,
      createdBy: userId,
      expiresAt: body.data.expiresAt ?? null,
    } as any);
    codes.push(code);
  }

  await audit(c, 'invite_code.create', codes.join(','));
  return c.json({ codes }, 201);
});
