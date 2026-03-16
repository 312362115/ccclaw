import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt, decrypt } from '@ccclaw/shared';
import { config } from '../config.js';
import { createProviderSchema, updateProviderSchema } from '@ccclaw/shared';
import type { AppEnv } from '../types.js';

export const providersRouter = new Hono<AppEnv>();

providersRouter.use('*', authMiddleware);

// GET /api/providers — 当前用户的 Provider 列表（不返回加密的 config）
providersRouter.get('/', async (c) => {
  const userId = c.get('user').sub;
  const rows = await db.select({
    id: schema.providers.id,
    name: schema.providers.name,
    type: schema.providers.type,
    authType: schema.providers.authType,
    isDefault: schema.providers.isDefault,
    createdAt: schema.providers.createdAt,
  }).from(schema.providers)
    .where(eq(schema.providers.userId, userId));
  return c.json(rows);
});

// POST /api/providers — 创建 Provider
providersRouter.post('/', async (c) => {
  const body = createProviderSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const userId = c.get('user').sub;

  // 如果设为默认，先取消该用户已有默认
  if (body.data.isDefault) {
    await db.update(schema.providers)
      .set({ isDefault: false } as any)
      .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true)));
  }

  const [row] = await db.insert(schema.providers).values({
    userId,
    name: body.data.name,
    type: body.data.type,
    authType: body.data.authType,
    config: encrypt(JSON.stringify(body.data.config), config.ENCRYPTION_KEY),
    isDefault: body.data.isDefault,
  } as any).returning();

  return c.json({ id: row.id, name: row.name, type: row.type, authType: row.authType, isDefault: row.isDefault }, 201);
});

// GET /api/providers/:id — 单个 Provider 详情（API Key 脱敏）
providersRouter.get('/:id', async (c) => {
  const id = c.req.param('id')!;
  const userId = c.get('user').sub;
  const [provider] = await db.select().from(schema.providers)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)))
    .limit(1);
  if (!provider) return c.json({ error: 'Provider 不存在' }, 404);

  let safeConfig: Record<string, unknown> = {};
  try {
    const cfg = JSON.parse(decrypt(provider.config as string, config.ENCRYPTION_KEY));
    // API Key 脱敏：只显示前 4 位和后 4 位
    const key = typeof cfg.key === 'string' ? cfg.key : '';
    const maskedKey = key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : '****';
    safeConfig = {
      maskedKey,
      baseURL: cfg.baseURL ?? '',
      models: Array.isArray(cfg.models) ? cfg.models : [],
    };
  } catch { /* ignore */ }

  return c.json({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    authType: provider.authType,
    isDefault: provider.isDefault,
    createdAt: provider.createdAt,
    config: safeConfig,
  });
});

// PATCH /api/providers/:id
providersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')!;
  const userId = c.get('user').sub;
  const body = updateProviderSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  if (body.data.isDefault) {
    await db.update(schema.providers)
      .set({ isDefault: false } as any)
      .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true)));
  }

  const updates: Record<string, unknown> = {};
  if (body.data.name) updates.name = body.data.name;
  if (body.data.config) {
    // 合并新旧 config，避免部分更新丢失已有字段（如只更新 models 不丢 key）
    const [existing] = await db.select().from(schema.providers)
      .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)))
      .limit(1);
    if (!existing) return c.json({ error: 'Provider 不存在' }, 404);
    let oldCfg: Record<string, unknown> = {};
    try { oldCfg = JSON.parse(decrypt(existing.config as string, config.ENCRYPTION_KEY)); } catch { /* ignore */ }
    const merged = { ...oldCfg, ...body.data.config };
    updates.config = encrypt(JSON.stringify(merged), config.ENCRYPTION_KEY);
  }
  if (body.data.isDefault !== undefined) updates.isDefault = body.data.isDefault;

  await db.update(schema.providers).set(updates as any)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)));

  return c.json({ ok: true });
});

// GET /api/providers/:id/models — 返回该 Provider 配置的模型列表
providersRouter.get('/:id/models', async (c) => {
  const id = c.req.param('id')!;
  const userId = c.get('user').sub;
  const [provider] = await db.select().from(schema.providers)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)))
    .limit(1);
  if (!provider) return c.json({ error: 'Provider 不存在' }, 404);

  try {
    const cfg = JSON.parse(decrypt(provider.config as string, config.ENCRYPTION_KEY));
    return c.json({ models: Array.isArray(cfg.models) ? cfg.models : [] });
  } catch {
    return c.json({ models: [] });
  }
});

// DELETE /api/providers/:id
providersRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')!;
  const userId = c.get('user').sub;
  await db.delete(schema.providers)
    .where(and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)));
  return c.body(null, 204);
});
