import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { desc, count } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { z } from 'zod';
import type { AppEnv } from '../types.js';

export const adminRouter = new Hono<AppEnv>();

adminRouter.use('*', authMiddleware);
adminRouter.use('*', requireRole('admin'));

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// GET /api/admin/stats — 管理后台概览数据
adminRouter.get('/stats', async (c) => {
  const [userResult] = await db.select({ value: count() }).from(schema.users);
  const [wsResult] = await db.select({ value: count() }).from(schema.workspaces);

  return c.json({
    userCount: userResult?.value ?? 0,
    workspaceCount: wsResult?.value ?? 0,
    sessionCount: 0, // sessions 在 workspace.db 中，暂不统计
  });
});

// GET /api/admin/logs — 管理员操作日志
adminRouter.get('/logs', async (c) => {
  const { page, limit } = querySchema.parse(c.req.query());
  const offset = (page - 1) * limit;

  const rows = await db.select().from(schema.adminLogs)
    .orderBy(desc(schema.adminLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});
