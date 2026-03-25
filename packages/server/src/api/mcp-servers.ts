/**
 * MCP Server 管理 API
 *
 * CRUD 端点：list / create / update / delete
 * 支持用户级（workspaceId=null）和工作区级配置。
 */

import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and, isNull, or } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const mcpServersRouter = new Hono<AppEnv>();

// GET /api/mcp-servers — 用户的所有 MCP server 配置（含用户级 + 所有工作区级）
mcpServersRouter.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const rows = await db.select().from(schema.mcpServers)
    .where(eq(schema.mcpServers.userId, user.sub));
  return c.json(rows);
});

// GET /api/mcp-servers/workspace/:wid — 指定工作区的 MCP server
mcpServersRouter.get('/workspace/:wid', authMiddleware, async (c) => {
  const user = c.get('user');
  const wid = c.req.param('wid')!;
  const rows = await db.select().from(schema.mcpServers)
    .where(and(
      eq(schema.mcpServers.userId, user.sub),
      or(
        isNull(schema.mcpServers.workspaceId),
        eq(schema.mcpServers.workspaceId, wid),
      ),
    ));
  return c.json(rows);
});

// POST /api/mcp-servers — 创建 MCP server 配置
mcpServersRouter.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  if (!body.name || !body.command) {
    return c.json({ error: '缺少 name 或 command' }, 400);
  }

  const [row] = await db.insert(schema.mcpServers).values({
    userId: user.sub,
    workspaceId: body.workspaceId ?? null,
    name: body.name,
    command: body.command,
    args: body.args ? JSON.stringify(body.args) : '[]',
    env: body.env ? JSON.stringify(body.env) : null,
    enabled: body.enabled ?? true,
  } as any).returning();

  return c.json(row, 201);
});

// PATCH /api/mcp-servers/:id — 更新 MCP server 配置
mcpServersRouter.patch('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const body = await c.req.json();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.command !== undefined) updates.command = body.command;
  if (body.args !== undefined) updates.args = JSON.stringify(body.args);
  if (body.env !== undefined) updates.env = JSON.stringify(body.env);
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  updates.updatedAt = new Date().toISOString();

  if (Object.keys(updates).length === 1) {
    return c.json({ error: '没有要更新的字段' }, 400);
  }

  const [row] = await db.update(schema.mcpServers)
    .set(updates)
    .where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.userId, user.sub)))
    .returning();

  if (!row) return c.json({ error: '未找到' }, 404);
  return c.json(row);
});

// DELETE /api/mcp-servers/:id — 删除 MCP server 配置
mcpServersRouter.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;

  const deleted = await db.delete(schema.mcpServers)
    .where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.userId, user.sub)))
    .returning();

  if (deleted.length === 0) return c.json({ error: '未找到' }, 404);
  return c.json({ ok: true });
});
