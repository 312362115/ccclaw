import { Hono } from 'hono';
import { runnerManager } from '../core/runner-manager.js';
import { agentManager } from '../core/agent-manager.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';

const runnerInfoRoute = new Hono();

runnerInfoRoute.get('/workspaces/:id/runner-info', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const [ws] = await db.select({ slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return c.json({ error: '工作区不存在' }, 404);
  const info = runnerManager.getRunnerInfo(ws.slug);
  if (!info) return c.json({ error: 'Runner 不在线或不支持直连' }, 404);
  return c.json(info);
});

// 确保 Runner 已接收到最新 config（前端直连建立后调用）
runnerInfoRoute.post('/workspaces/:id/ensure-config', authMiddleware, requireWorkspaceAccess(), async (c) => {
  const workspaceId = c.req.param('id');
  const userId = c.get('userId') as string;
  try {
    const runtimeConfig = await agentManager.buildRuntimeConfig(workspaceId, userId);
    const [ws] = await db.select({ slug: schema.workspaces.slug })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return c.json({ error: '工作区不存在' }, 404);
    runnerManager.sendConfig(ws.slug, runtimeConfig);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export { runnerInfoRoute };
