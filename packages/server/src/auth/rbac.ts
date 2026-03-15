import type { Context, Next } from 'hono';
import type { SystemRole } from '@ccclaw/shared';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

// 检查系统角色（admin 才能访问系统管理功能）
export function requireRole(...roles: SystemRole[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user' as never) as { role: string } | undefined;
    if (!user || !roles.includes(user.role as SystemRole)) {
      return c.json({ error: '权限不足' }, 403);
    }
    return next();
  };
}

// 检查工作区归属（workspace.createdBy === user.id）
export function requireWorkspaceAccess() {
  return async (c: Context, next: Next) => {
    const user = c.get('user' as never) as { sub: string } | undefined;
    if (!user) return c.json({ error: '未认证' }, 401);

    const workspaceId = c.req.param('id');
    if (!workspaceId) return c.json({ error: '缺少工作区 ID' }, 400);

    const [workspace] = await db.select({ createdBy: schema.workspaces.createdBy })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);

    if (!workspace || workspace.createdBy !== user.sub) {
      return c.json({ error: '无工作区访问权限' }, 403);
    }

    return next();
  };
}
