import { Hono } from 'hono';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { updatePreferencesSchema } from '@ccclaw/shared';
import type { AppEnv } from '../types.js';

export const preferencesRouter = new Hono<AppEnv>();

preferencesRouter.use('*', authMiddleware);

// GET /api/settings/preferences — 读取当前用户偏好
preferencesRouter.get('/', async (c) => {
  const userId = c.get('user').sub;
  const [row] = await db.select().from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId)).limit(1);

  if (!row) {
    return c.json({
      language: null,
      style: null,
      customRules: null,
      agentModel: null,
      maxTokens: null,
      contextWindowTokens: null,
      temperature: null,
      reasoningEffort: null,
      toolConfirmMode: null,
    });
  }

  return c.json({
    language: row.language,
    style: row.style,
    customRules: row.customRules,
    agentModel: row.agentModel,
    maxTokens: row.maxTokens,
    contextWindowTokens: row.contextWindowTokens,
    temperature: row.temperature,
    reasoningEffort: row.reasoningEffort,
    toolConfirmMode: row.toolConfirmMode,
  });
});

// PUT /api/settings/preferences — 更新偏好（upsert）
preferencesRouter.put('/', async (c) => {
  const body = updatePreferencesSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const userId = c.get('user').sub;
  const [existing] = await db.select({ id: schema.userPreferences.id })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId)).limit(1);

  const data = {
    ...body.data,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db.update(schema.userPreferences)
      .set(data as any)
      .where(eq(schema.userPreferences.id, existing.id));
  } else {
    await db.insert(schema.userPreferences).values({
      userId,
      ...data,
    } as any);
  }

  return c.json({ ok: true });
});
