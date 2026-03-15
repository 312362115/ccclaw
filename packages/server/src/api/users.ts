import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createUserSchema, updateUserSchema } from '@ccclaw/shared';
import { hashPassword } from '../auth/password.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../auth/rbac.js';
import { audit } from '../middleware/audit.js';
import type { AppEnv } from '../types.js';

export const usersRouter = new Hono<AppEnv>();

usersRouter.use('*', authMiddleware, requireRole('admin'));

usersRouter.get('/', async (c) => {
  const all = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    role: schema.users.role,
    createdAt: schema.users.createdAt,
  }).from(schema.users);
  return c.json(all);
});

usersRouter.post('/', async (c) => {
  const body = createUserSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [existing] = await db.select().from(schema.users)
    .where(eq(schema.users.email, body.data.email)).limit(1);
  if (existing) return c.json({ error: '邮箱已存在' }, 409);

  const [user] = await db.insert(schema.users).values({
    name: body.data.name,
    email: body.data.email,
    password: await hashPassword(body.data.password),
    role: body.data.role,
  } as any).returning();

  await audit(c, 'user.create', user.id);
  return c.json({ id: user.id, name: user.name, email: user.email, role: user.role }, 201);
});

usersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = updateUserSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const [updated] = await db.update(schema.users).set(body.data as any)
    .where(eq(schema.users.id, id)).returning();

  if (!updated) return c.json({ error: '用户不存在' }, 404);
  await audit(c, 'user.update', id, body.data);
  return c.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role });
});

usersRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  if (id === user.sub) return c.json({ error: '不能删除自己' }, 400);

  const [deleted] = await db.delete(schema.users).where(eq(schema.users.id, id)).returning();
  if (!deleted) return c.json({ error: '用户不存在' }, 404);
  await audit(c, 'user.delete', id);
  return c.json({ ok: true });
});
