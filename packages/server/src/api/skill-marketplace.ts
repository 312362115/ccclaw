import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { db, schema } from '../db/index.js';
import type { AppEnv } from '../types.js';

export const skillMarketplaceRouter = new Hono<AppEnv>();

// GET /api/marketplace/search — 搜索 skills.sh 市场
skillMarketplaceRouter.get('/search', authMiddleware, async (c) => {
  const query = c.req.query('q') || '';
  const page = parseInt(c.req.query('page') || '1');

  try {
    const res = await fetch(
      `https://api.skills.sh/skills?q=${encodeURIComponent(query)}&page=${page}`,
    );
    if (!res.ok) {
      return c.json({ results: [], total: 0 });
    }
    const data = await res.json();
    return c.json(data);
  } catch {
    // skills.sh API 不可用时返回空结果
    return c.json({ results: [], total: 0 });
  }
});

// GET /api/marketplace/:id — 获取技能详情
skillMarketplaceRouter.get('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');

  try {
    const res = await fetch(`https://api.skills.sh/skills/${id}`);
    if (!res.ok) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json(await res.json());
  } catch {
    return c.json({ error: 'Failed to fetch skill details' }, 502);
  }
});

// POST /api/marketplace/:id/install — 安装技能到工作区
skillMarketplaceRouter.post('/:id/install', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');

  let body: { workspaceId?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  try {
    const res = await fetch(`https://api.skills.sh/skills/${id}/download`);
    if (!res.ok) {
      return c.json({ error: 'Download failed' }, 502);
    }
    const pkg = (await res.json()) as {
      name?: string;
      description?: string;
      content?: string;
    };

    // 保存为本地技能
    const [row] = await db
      .insert(schema.skills)
      .values({
        userId: user.sub,
        workspaceId: body.workspaceId ?? null,
        name: pkg.name || `marketplace-skill-${id}`,
        description: pkg.description || '',
        content: pkg.content || '',
      } as any)
      .returning();

    return c.json({ success: true, skill: row }, 201);
  } catch {
    return c.json({ error: 'Install failed' }, 502);
  }
});
