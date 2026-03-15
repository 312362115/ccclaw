import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';
import type { AppEnv } from '../types.js';

export const workspacesRouter = new Hono<AppEnv>();

workspacesRouter.use('*', authMiddleware);

// 列表：返回当前用户创建的所有工作区
workspacesRouter.get('/', async (c) => {
  const user = c.get('user');
  const workspaces = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.createdBy, user.sub));
  return c.json(workspaces);
});

// 创建工作区
workspacesRouter.post('/', async (c) => {
  const user = c.get('user');
  const body = createWorkspaceSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [existing] = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.slug, body.data.slug)).limit(1);
  if (existing) return c.json({ error: 'slug 已存在' }, 409);

  const [workspace] = await db.insert(schema.workspaces).values({
    name: body.data.name,
    slug: body.data.slug,
    createdBy: user.sub,
    gitRepo: body.data.gitRepo ?? null,
  } as any).returning();

  await audit(c, 'workspace.create', workspace.id);
  return c.json(workspace, 201);
});

workspacesRouter.get('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const [workspace] = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.id, id)).limit(1);
  if (!workspace) return c.json({ error: '工作区不存在' }, 404);
  return c.json(workspace);
});

workspacesRouter.patch('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id')!;
  const body = updateWorkspaceSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [updated] = await db.update(schema.workspaces).set(body.data as any)
    .where(eq(schema.workspaces.id, id)).returning();
  if (!updated) return c.json({ error: '工作区不存在' }, 404);
  await audit(c, 'workspace.update', id);
  return c.json(updated);
});

workspacesRouter.delete('/:id', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id')!;
  const [deleted] = await db.delete(schema.workspaces)
    .where(eq(schema.workspaces.id, id)).returning();
  if (!deleted) return c.json({ error: '工作区不存在' }, 404);
  await audit(c, 'workspace.delete', id);
  return c.json({ ok: true });
});
