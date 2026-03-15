import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import type { AppEnv } from '../types.js';

// Sessions 和 Messages 存储在工作区 workspace.db 中，由 Runner 管理
// Server 通过 RunnerManager 代理查询，Task 9/11 中实现具体代理逻辑
// 当前提供路由骨架，返回 501 提示

export const sessionsRouter = new Hono<AppEnv>();

sessionsRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/sessions
sessionsRouter.get('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  // TODO: 通过 RunnerManager 代理 workspace.db 查询
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// POST /api/workspaces/:id/sessions
sessionsRouter.post('/:id/sessions', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// GET /api/workspaces/:id/sessions/:sid
sessionsRouter.get('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});

// DELETE /api/workspaces/:id/sessions/:sid（归档）
sessionsRouter.delete('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  return c.json({ error: '等待 Runner 代理实现' }, 501);
});
