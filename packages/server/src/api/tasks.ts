import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createTaskSchema, updateTaskSchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import type { AppEnv } from '../types.js';

export const tasksRouter = new Hono<AppEnv>();

tasksRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/tasks
tasksRouter.get('/:id/tasks', requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id')!;
  const rows = await db.select().from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.workspaceId, workspaceId));
  return c.json(rows);
});

// POST /api/workspaces/:id/tasks
tasksRouter.post('/:id/tasks', requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id')!;
  const body = createTaskSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [row] = await db.insert(schema.scheduledTasks).values({
    workspaceId,
    name: body.data.name,
    cron: body.data.cron,
    prompt: body.data.prompt,
    enabled: body.data.enabled,
  } as any).returning();
  return c.json(row, 201);
});

// PATCH /api/workspaces/:id/tasks/:tid
tasksRouter.patch('/:id/tasks/:tid', requireWorkspaceAccess(), async (c) => {
  const tid = c.req.param('tid')!;
  const body = updateTaskSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [row] = await db.update(schema.scheduledTasks)
    .set(body.data as any)
    .where(eq(schema.scheduledTasks.id, tid))
    .returning();
  if (!row) return c.json({ error: '任务不存在' }, 404);
  return c.json(row);
});

// DELETE /api/workspaces/:id/tasks/:tid
tasksRouter.delete('/:id/tasks/:tid', requireWorkspaceAccess(), async (c) => {
  const tid = c.req.param('tid')!;
  await db.delete(schema.scheduledTasks).where(eq(schema.scheduledTasks.id, tid));
  return c.body(null, 204);
});
