import { Hono } from 'hono';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types.js';

function openWorkspaceDb(slug: string): Database.Database | null {
  const dbPath = join(config.DATA_DIR, 'workspaces', slug, 'internal', 'workspace.db');
  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
}

async function getSlug(workspaceId: string): Promise<string | null> {
  const [ws] = await db.select({ slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return ws?.slug ?? null;
}

export const sessionsRouter = new Hono<AppEnv>();

sessionsRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/sessions — 会话列表
sessionsRouter.get('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json([]);

  try {
    const sessions = wdb.prepare(
      'SELECT id, title, status, created_at FROM sessions ORDER BY created_at DESC LIMIT 50',
    ).all();
    return c.json(sessions);
  } finally {
    wdb.close();
  }
});

// GET /api/workspaces/:id/sessions/:sid/messages — 会话消息
sessionsRouter.get('/:id/sessions/:sid/messages', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const sid = c.req.param('sid');
  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json([]);

  try {
    const messages = wdb.prepare(
      'SELECT id, session_id, role, content, tool_calls, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200',
    ).all(sid);
    return c.json(messages);
  } finally {
    wdb.close();
  }
});

// POST /api/workspaces/:id/sessions — 创建会话
sessionsRouter.post('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '会话由 Runner 自动创建' }, 501);
});

// DELETE /api/workspaces/:id/sessions/:sid
sessionsRouter.delete('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '暂未实现' }, 501);
});
