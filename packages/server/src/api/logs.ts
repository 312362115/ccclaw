import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { z } from 'zod';
import type { AppEnv } from '../types.js';

export const logsRouter = new Hono<AppEnv>();

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// GET /api/logs — 审计日志列表（admin）
logsRouter.get('/', authMiddleware, requireRole('admin'), async (c) => {
  const { page, limit } = querySchema.parse(c.req.query());
  const offset = (page - 1) * limit;

  const rows = await db.select().from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, page, limit });
});
