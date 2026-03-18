import { Hono } from 'hono';
import { runnerManager } from '../core/runner-manager.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const runnerInfoRoute = new Hono();

runnerInfoRoute.get('/workspaces/:id/runner-info', async (c) => {
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

export { runnerInfoRoute };
