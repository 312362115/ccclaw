import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { createSkillSchema, updateSkillSchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import type { AppEnv } from '../types.js';

export const skillsRouter = new Hono<AppEnv>();

// GET /api/skills — 用户级技能列表
skillsRouter.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.userId, user.sub), isNull(schema.skills.workspaceId)));
  return c.json(rows);
});

// GET /api/workspaces/:id/skills — 工作区级技能
skillsRouter.get('/workspaces/:id/skills', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id')!;
  const user = c.get('user');
  const rows = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.userId, user.sub), eq(schema.skills.workspaceId, workspaceId)));
  return c.json(rows);
});

// POST /api/skills — 创建技能
skillsRouter.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = createSkillSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [row] = await db.insert(schema.skills).values({
    userId: user.sub,
    workspaceId: body.data.workspaceId ?? null,
    name: body.data.name,
    description: body.data.description,
    content: body.data.content,
  } as any).returning();
  return c.json(row, 201);
});

// PATCH /api/skills/:sid
skillsRouter.patch('/:sid', authMiddleware, async (c) => {
  const user = c.get('user');
  const sid = c.req.param('sid')!;
  const body = updateSkillSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [row] = await db.update(schema.skills)
    .set({ ...body.data, updatedAt: new Date().toISOString() } as any)
    .where(and(eq(schema.skills.id, sid), eq(schema.skills.userId, user.sub)))
    .returning();
  if (!row) return c.json({ error: '技能不存在' }, 404);
  return c.json(row);
});

// DELETE /api/skills/:sid
skillsRouter.delete('/:sid', authMiddleware, async (c) => {
  const user = c.get('user');
  const sid = c.req.param('sid')!;
  await db.delete(schema.skills)
    .where(and(eq(schema.skills.id, sid), eq(schema.skills.userId, user.sub)));
  return c.body(null, 204);
});
