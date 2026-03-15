import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import type { AppEnv } from '../types.js';

// Memories 存储在工作区 workspace.db 中，由 Runner 管理
// Server 通过 RunnerManager 代理查询，Task 9/11 中实现具体代理逻辑

export const memoriesRouter = new Hono<AppEnv>();

memoriesRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/memories
memoriesRouter.get('/:id/memories', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// POST /api/workspaces/:id/memories
memoriesRouter.post('/:id/memories', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// PATCH /api/workspaces/:id/memories/:mid
memoriesRouter.patch('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// DELETE /api/workspaces/:id/memories/:mid
memoriesRouter.delete('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});
