# 平台完善改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 5 most impactful gaps: cron scheduling, memory API, global error toasts, session deletion, and frontend error handling.

**Architecture:** Server-side fixes (cron-parser, memory proxy, session delete) + a lightweight toast notification system for the web UI that replaces all silent `catch(() => {})` patterns.

**Tech Stack:** cron-parser (npm), better-sqlite3 (existing), React context + CSS transitions (no new UI lib), Hono (existing)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `packages/server/src/core/scheduler.ts` | Replace stub `getNextCronDate` with cron-parser |
| Modify | `packages/server/package.json` | Add `cron-parser` dependency |
| Modify | `packages/server/src/api/memories.ts` | Implement memory CRUD via workspace.db proxy |
| Modify | `packages/server/src/api/sessions.ts` | Implement session deletion |
| Create | `packages/web/src/components/Toast.tsx` | Global toast notification component + context |
| Modify | `packages/web/src/App.tsx` | Wrap with ToastProvider |
| Modify | `packages/web/src/pages/console/Tasks.tsx` | Replace silent catches with toast notifications |
| Modify | `packages/web/src/stores/chat.ts` | Surface loadMessages errors |
| Create | `packages/server/src/core/scheduler.test.ts` | Tests for cron date calculation |

---

### Task 1: Fix Cron Expression Parsing

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/core/scheduler.ts:131-139`
- Create: `packages/server/src/core/scheduler.test.ts`

- [ ] **Step 1: Install cron-parser**

```bash
cd /Users/renlongyu/workspace/ccclaw && pnpm add -F @ccclaw/server cron-parser
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/core/scheduler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getNextCronDate } from './scheduler.js';

describe('getNextCronDate', () => {
  it('should return next occurrence for "0 9 * * *" (daily 9am)', () => {
    const now = new Date('2026-03-19T08:00:00Z');
    const next = getNextCronDate('0 9 * * *', now);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next > now).toBe(true);
  });

  it('should return next day if time already passed', () => {
    const now = new Date('2026-03-19T10:00:00Z');
    const next = getNextCronDate('0 9 * * *', now);
    expect(next.getUTCDate()).toBe(20);
    expect(next.getUTCHours()).toBe(9);
  });

  it('should handle every-5-minutes expression', () => {
    const now = new Date('2026-03-19T08:02:00Z');
    const next = getNextCronDate('*/5 * * * *', now);
    expect(next.getUTCMinutes()).toBe(5);
  });

  it('should return null for invalid expression', () => {
    const result = getNextCronDate('invalid cron', new Date());
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/server exec vitest run src/core/scheduler.test.ts`
Expected: FAIL — `getNextCronDate` is not exported / doesn't accept `now` param

- [ ] **Step 4: Implement with cron-parser**

Replace the `getNextCronDate` function in `packages/server/src/core/scheduler.ts`:

```typescript
import { CronExpressionParser } from 'cron-parser';

// Export for testing
export function getNextCronDate(cronExpr: string, now?: Date): Date | null {
  try {
    const interval = CronExpressionParser.parseExpression(cronExpr, {
      currentDate: now ?? new Date(),
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
```

Also update `updateNextRunAt` to handle null return:

```typescript
async function updateNextRunAt(task: any) {
  try {
    const nextRun = getNextCronDate(task.cron);
    await db.update(schema.scheduledTasks)
      .set({
        lastRunAt: new Date(),
        nextRunAt: nextRun,
      } as any)
      .where(eq(schema.scheduledTasks.id, task.id));
  } catch (err) {
    logger.error({ taskId: task.id, error: String(err) }, '更新下次执行时间失败');
  }
}
```

Remove the `cron.validate()` call since `getNextCronDate` now handles validation internally.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/server exec vitest run src/core/scheduler.test.ts`
Expected: PASS

- [ ] **Step 6: Add cron validation to task creation API**

In `packages/server/src/api/tasks.ts`, add validation in the POST handler after schema parse:

```typescript
import { CronExpressionParser } from 'cron-parser';

// Inside POST handler, after body.success check:
try {
  CronExpressionParser.parseExpression(body.data.cron);
} catch {
  return c.json({ error: 'Cron 表达式无效' }, 400);
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/core/scheduler.ts packages/server/src/core/scheduler.test.ts packages/server/src/api/tasks.ts packages/server/package.json pnpm-lock.yaml
git commit -m "fix: implement proper cron expression parsing with cron-parser"
```

---

### Task 2: Implement Memory API Proxy

**Files:**
- Modify: `packages/server/src/api/memories.ts`

The memory data lives in each workspace's `workspace.db` (managed by agent-runtime). The Server can read it directly with `better-sqlite3` (readonly), same pattern as `sessions.ts`.

- [ ] **Step 1: Implement memory CRUD endpoints**

Replace `packages/server/src/api/memories.ts`:

```typescript
import { Hono } from 'hono';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { authMiddleware } from '../middleware/auth.js';
import { requireWorkspaceAccess } from '../auth/rbac.js';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createMemorySchema, updateMemorySchema } from '@ccclaw/shared';
import type { AppEnv } from '../types.js';

function openWorkspaceDb(slug: string): Database.Database | null {
  const dbPath = join(config.DATA_DIR, 'workspaces', slug, 'internal', 'workspace.db');
  try {
    return new Database(dbPath);
  } catch {
    return null;
  }
}

async function getSlug(workspaceId: string): Promise<string | null> {
  const [ws] = await db.select({ slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return ws?.slug ?? null;
}

export const memoriesRouter = new Hono<AppEnv>();

memoriesRouter.use('*', authMiddleware);

// GET /api/workspaces/:id/memories
memoriesRouter.get('/:id/memories', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json([]);

  try {
    const type = c.req.query('type');
    const search = c.req.query('q');

    if (search) {
      const pattern = `%${search}%`;
      const rows = wdb.prepare(
        'SELECT id, name, type, content, updated_at FROM memories WHERE content LIKE ? OR name LIKE ? ORDER BY updated_at DESC LIMIT 50',
      ).all(pattern, pattern);
      return c.json(rows);
    }

    if (type) {
      const rows = wdb.prepare(
        'SELECT id, name, type, content, updated_at FROM memories WHERE type = ? ORDER BY updated_at DESC',
      ).all(type);
      return c.json(rows);
    }

    const rows = wdb.prepare(
      'SELECT id, name, type, content, updated_at FROM memories ORDER BY updated_at DESC LIMIT 100',
    ).all();
    return c.json(rows);
  } finally {
    wdb.close();
  }
});

// POST /api/workspaces/:id/memories
memoriesRouter.post('/:id/memories', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const body = createMemorySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 500);

  try {
    const { nanoid } = await import('@ccclaw/shared');
    const memId = nanoid();
    wdb.prepare(`
      INSERT INTO memories (id, name, type, content)
      VALUES (?, ?, ?, ?)
    `).run(memId, body.data.name, body.data.type, body.data.content);
    const row = wdb.prepare('SELECT id, name, type, content, updated_at FROM memories WHERE id = ?').get(memId);
    return c.json(row, 201);
  } finally {
    wdb.close();
  }
});

// PATCH /api/workspaces/:id/memories/:mid
memoriesRouter.patch('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const mid = c.req.param('mid');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const body = updateMemorySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '参数错误', details: body.error.flatten() }, 400);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 500);

  try {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.data.name !== undefined) { fields.push('name = ?'); values.push(body.data.name); }
    if (body.data.type !== undefined) { fields.push('type = ?'); values.push(body.data.type); }
    if (body.data.content !== undefined) { fields.push('content = ?'); values.push(body.data.content); }
    if (fields.length === 0) return c.json({ error: '无更新字段' }, 400);

    fields.push("updated_at = datetime('now')");
    values.push(mid);
    const result = wdb.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) return c.json({ error: '记忆不存在' }, 404);

    const row = wdb.prepare('SELECT id, name, type, content, updated_at FROM memories WHERE id = ?').get(mid);
    return c.json(row);
  } finally {
    wdb.close();
  }
});

// DELETE /api/workspaces/:id/memories/:mid
memoriesRouter.delete('/:id/memories/:mid', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  const mid = c.req.param('mid');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const wdb = openWorkspaceDb(slug);
  if (!wdb) return c.json({ error: '工作区数据库不可用' }, 500);

  try {
    wdb.prepare('DELETE FROM memories WHERE id = ?').run(mid);
    return c.body(null, 204);
  } finally {
    wdb.close();
  }
});
```

- [ ] **Step 2: Verify type compatibility**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/server exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/memories.ts
git commit -m "feat: implement memory CRUD API via workspace.db proxy"
```

---

### Task 3: Implement Session Deletion

**Files:**
- Modify: `packages/server/src/api/sessions.ts:78-81`

- [ ] **Step 1: Implement DELETE endpoint**

Replace the 501 stub in `packages/server/src/api/sessions.ts`:

```typescript
// DELETE /api/workspaces/:id/sessions/:sid
sessionsRouter.delete('/:id/sessions/:sid', requireWorkspaceAccess(), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: '缺少工作区 ID' }, 400);
  const slug = await getSlug(id);
  if (!slug) return c.json({ error: '工作区不存在' }, 404);

  const sid = c.req.param('sid');
  const dbPath = join(config.DATA_DIR, 'workspaces', slug, 'internal', 'workspace.db');
  let wdb: Database.Database;
  try {
    wdb = new Database(dbPath); // writable, not readonly
  } catch {
    return c.json({ error: '工作区数据库不可用' }, 500);
  }

  try {
    // CASCADE will delete messages automatically
    const result = wdb.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    if (result.changes === 0) return c.json({ error: '会话不存在' }, 404);
    return c.body(null, 204);
  } finally {
    wdb.close();
  }
});
```

Note: The `openWorkspaceDb` helper opens with `readonly: true`, so for DELETE we open a writable connection directly.

- [ ] **Step 2: Verify type check**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/server exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/sessions.ts
git commit -m "feat: implement session deletion with cascade message cleanup"
```

---

### Task 4: Global Toast Notification System

**Files:**
- Create: `packages/web/src/components/Toast.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create Toast component and context**

Create `packages/web/src/components/Toast.tsx`:

```tsx
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const toast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4000);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  };

  const colors: Record<ToastType, string> = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
  };

  return (
    <ToastContext value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`${colors[t.type]} text-white text-sm px-4 py-3 rounded-lg shadow-lg cursor-pointer animate-[slideIn_0.2s_ease-out]`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
```

- [ ] **Step 2: Add slideIn animation to CSS**

Add to `packages/web/src/app.css` (at the end):

```css
@keyframes slideIn {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}
```

- [ ] **Step 3: Wrap App with ToastProvider**

In `packages/web/src/App.tsx`, import and wrap:

```tsx
import { ToastProvider } from './components/Toast';

// Wrap the BrowserRouter return:
return (
  <ToastProvider>
    <BrowserRouter>
      {/* ... existing routes ... */}
    </BrowserRouter>
  </ToastProvider>
);
```

- [ ] **Step 4: Verify it renders**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/web exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Toast.tsx packages/web/src/App.tsx packages/web/src/app.css
git commit -m "feat: add global toast notification system"
```

---

### Task 5: Replace Silent Error Catches with Toast Notifications

**Files:**
- Modify: `packages/web/src/pages/console/Tasks.tsx`
- Modify: `packages/web/src/stores/chat.ts`

- [ ] **Step 1: Fix Tasks.tsx error handling**

In `packages/web/src/pages/console/Tasks.tsx`:

Add import:
```tsx
import { useToast } from '../../components/Toast';
```

Inside the component, add:
```tsx
const { toast } = useToast();
```

Replace all silent catches:

1. Line 40: `.catch(() => {})` → `.catch((e) => toast(e.message || '加载工作区失败'))`
2. Line 48: `.catch(() => setTasks([]))` → `.catch((e) => { setTasks([]); toast(e.message || '加载任务失败'); })`
3. Line 86-88: `catch { // 静默处理 }` → `catch (e: any) { toast(e.message || '保存任务失败'); }`
4. Line 96: `.catch(() => {})` → `.catch((e) => toast(e.message || '删除任务失败'))`
5. Line 106: `.catch(() => {})` → `.catch((e) => toast(e.message || '切换状态失败'))`

- [ ] **Step 2: Fix chat store loadMessages**

In `packages/web/src/stores/chat.ts`, line 121:

Replace:
```typescript
} catch { /* 静默失败，新会话没有历史 */ }
```

With:
```typescript
} catch (e) {
  // 404 is expected for new sessions without history
  if (e instanceof Error && 'status' in e && (e as any).status === 404) return;
  console.warn('加载历史消息失败:', e);
}
```

- [ ] **Step 3: Type check**

Run: `cd /Users/renlongyu/workspace/ccclaw && pnpm -F @ccclaw/web exec tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/console/Tasks.tsx packages/web/src/stores/chat.ts
git commit -m "fix: replace silent error catches with toast notifications"
```

---

## Completion Criteria

1. `getNextCronDate('0 9 * * *')` returns the correct next 9am occurrence (not just +1 min)
2. Invalid cron expressions are rejected at task creation time with a 400 error
3. Memory API endpoints return real data from workspace.db (not 501)
4. Session deletion works and cascades to messages
5. Failed API calls in Tasks page show visible error toasts
6. All type checks pass: `pnpm typecheck`
