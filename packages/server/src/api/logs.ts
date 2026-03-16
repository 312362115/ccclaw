import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { desc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { z } from 'zod';
import type { AppEnv } from '../types.js';

export const logsRouter = new Hono<AppEnv>();

logsRouter.use('*', authMiddleware);

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// GET /api/logs/mine — 当前用户的个人操作日志
logsRouter.get('/mine', async (c) => {
  const userId = c.get('user').sub;
  const { page, limit } = querySchema.parse(c.req.query());
  const offset = (page - 1) * limit;

  const rows = await db.select().from(schema.auditLogs)
    .where(eq(schema.auditLogs.userId, userId))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});
