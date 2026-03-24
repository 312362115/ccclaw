import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createWorkspaceSchema, updateWorkspaceSchema, slugId } from '@ccclaw/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';
import { initWorkspaceStorage, removeWorkspaceStorage } from '../core/workspace-storage.js';
import { runnerManager } from '../core/runner-manager.js';
import { logger } from '../logger.js';
import type { AppEnv } from '../types.js';

function generateSlug(): string {
  return `ws-${slugId()}`;
}

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

  const slug = body.data.slug || generateSlug();

  const [existing] = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug)).limit(1);
  if (existing) return c.json({ error: 'slug 已存在' }, 409);

  const [workspace] = await db.insert(schema.workspaces).values({
    name: body.data.name,
    slug,
    createdBy: user.sub,
    gitRepo: body.data.gitRepo ?? null,
    settings: body.data.settings ?? {},
  } as any).returning();

  // 初始化工作区存储目录（home, internal, skills, workspace.db 等）
  await initWorkspaceStorage(slug, body.data.gitRepo);

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

  // 先查出 slug，用于后续清理
  const [ws] = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.id, id)).limit(1);
  if (!ws) return c.json({ error: '工作区不存在' }, 404);

  // 1. 删数据库记录（级联删除关联表）— 同步，确保前端立即看到删除
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  await audit(c, 'workspace.delete', id);

  // 2. 后台异步清理：停 Runner + 清磁盘（不阻塞响应）
  const { slug } = ws;
  Promise.resolve().then(async () => {
    try { await runnerManager.stop(slug); } catch (err) {
      logger.warn({ err, slug }, '停止 Runner 失败');
    }
    try { await removeWorkspaceStorage(slug); } catch (err) {
      logger.warn({ err, slug }, '清理工作区文件失败');
    }
    logger.info({ slug }, '工作区资源清理完成');
  }).catch((err) => {
    logger.error({ err, slug }, '工作区资源清理异常');
  });

  return c.json({ ok: true });
});
