import { Hono } from 'hono';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createMemorySchema, updateMemorySchema, nanoid } from '@ccclaw/shared';
import type { AppEnv } from '../types.js';

// Memories 存储在工作区 workspace.db 中，由 Runner 管理
// Server 通过直接读写 workspace.db 实现 CRUD

function openWorkspaceDb(slug: string, readonly = false): Database.Database | null {
  const dbPath = join(config.DATA_DIR, 'workspaces', slug, 'internal', 'workspace.db');
  try {
    return new Database(dbPath, readonly ? { readonly: true } : undefined);
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

export const memoriesRouter = new Hono<AppEnv>();

memoriesRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/memories
memoriesRouter.get('/:id/memories', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);

  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const wdb = openWorkspaceDb(slug, true);
  if (!wdb) return c.json([]);

  try {
    const type = c.req.query('type');
    const q = c.req.query('q');

    let sql = 'SELECT id, name, type, content, updated_at FROM memories';
    const params: string[] = [];
    const conditions: string[] = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (q) {
      conditions.push('(name LIKE ? OR content LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY updated_at DESC LIMIT 100';

    const memories = wdb.prepare(sql).all(...params);
    return c.json(memories);
  } finally {
    wdb.close();
  }
});

// POST /api/workspaces/:id/memories
memoriesRouter.post('/:id/memories', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);

  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const body = await c.req.json();
  const parsed = createMemorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: '参数错误', details: parsed.error.flatten() }, 400);
  }

  const { name, type, content } = parsed.data;
  const memoryId = nanoid();

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 503);

  try {
    wdb.prepare(
      'INSERT INTO memories (id, name, type, content) VALUES (?, ?, ?, ?)',
    ).run(memoryId, name, type, content);

    const memory = wdb.prepare(
      'SELECT id, name, type, content, updated_at FROM memories WHERE id = ?',
    ).get(memoryId);

    return c.json(memory, 201);
  } finally {
    wdb.close();
  }
});

// PATCH /api/workspaces/:id/memories/:mid
memoriesRouter.patch('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const mid = c.req.param('mid');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  if (!mid) return c.json({ error: '缺少记忆 ID' }, 400);

  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const body = await c.req.json();
  const parsed = updateMemorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: '参数错误', details: parsed.error.flatten() }, 400);
  }

  const updates = parsed.data;
  const fields = Object.keys(updates) as (keyof typeof updates)[];
  if (fields.length === 0) {
    return c.json({ error: '没有可更新的字段' }, 400);
  }

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 503);

  try {
    const existing = wdb.prepare('SELECT id FROM memories WHERE id = ?').get(mid);
    if (!existing) {
      return c.json({ error: '记忆不存在' }, 404);
    }

    const setClauses = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => updates[f]);

    wdb.prepare(
      `UPDATE memories SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
    ).run(...values, mid);

    const memory = wdb.prepare(
      'SELECT id, name, type, content, updated_at FROM memories WHERE id = ?',
    ).get(mid);

    return c.json(memory);
  } finally {
    wdb.close();
  }
});

// DELETE /api/workspaces/:id/memories/:mid
memoriesRouter.delete('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const mid = c.req.param('mid');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  if (!mid) return c.json({ error: '缺少记忆 ID' }, 400);

  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 503);

  try {
    const existing = wdb.prepare('SELECT id FROM memories WHERE id = ?').get(mid);
    if (!existing) {
      return c.json({ error: '记忆不存在' }, 404);
    }

    wdb.prepare('DELETE FROM memories WHERE id = ?').run(mid);
    return c.json({ success: true });
  } finally {
    wdb.close();
  }
});
