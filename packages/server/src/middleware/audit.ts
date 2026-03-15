import type { Context } from 'hono';
import { db, schema } from '../db/index.js';

export async function audit(c: Context, action: string, target: string, detail?: unknown) {
  const user = c.get('user');
  if (!user) return;

  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';

  await db.insert(schema.auditLogs).values({
    userId: user.sub,
    action,
    target,
    detail: detail ?? null,
    ip,
  });
}
