import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, count, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const dashboardRouter = new Hono<AppEnv>();

dashboardRouter.use('*', authMiddleware);

// GET /api/dashboard — 当前用户的统计概览
dashboardRouter.get('/', async (c) => {
  const userId = c.get('user').sub;

  const [workspaceCount] = await db.select({ count: count() })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.createdBy, userId));

  const [providerCount] = await db.select({ count: count() })
    .from(schema.providers)
    .where(eq(schema.providers.userId, userId));

  const [skillCount] = await db.select({ count: count() })
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId));

  // token 用量汇总
  const [tokenStats] = await db.select({
    totalInput: sql<number>`COALESCE(SUM(${schema.tokenUsage.inputTokens}), 0)`,
    totalOutput: sql<number>`COALESCE(SUM(${schema.tokenUsage.outputTokens}), 0)`,
  }).from(schema.tokenUsage)
    .where(eq(schema.tokenUsage.userId, userId));

  return c.json({
    workspaces: workspaceCount?.count ?? 0,
    providers: providerCount?.count ?? 0,
    skills: skillCount?.count ?? 0,
    tokens: {
      input: tokenStats?.totalInput ?? 0,
      output: tokenStats?.totalOutput ?? 0,
    },
  });
});
