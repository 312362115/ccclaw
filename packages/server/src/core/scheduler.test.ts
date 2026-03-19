import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies before importing scheduler
vi.mock('../db/index.js', () => ({ db: {}, schema: {} }));
vi.mock('../config.js', () => ({
  config: {
    SCHEDULER_CONCURRENCY: 1,
    JWT_SECRET: 'test',
    ENCRYPTION_KEY: 'test',
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./agent-manager.js', () => ({ agentManager: {} }));
vi.mock('@ccclaw/shared', () => ({ nanoid: () => 'test-id' }));

import { getNextCronDate } from './scheduler.js';

describe('getNextCronDate', () => {
  it('should return next occurrence for "0 9 * * *" (daily 9am)', () => {
    const now = new Date('2026-03-19T08:00:00Z');
    const next = getNextCronDate('0 9 * * *', now);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
    expect(next! > now).toBe(true);
  });

  it('should return next day if time already passed', () => {
    const now = new Date('2026-03-19T10:00:00Z');
    const next = getNextCronDate('0 9 * * *', now);
    expect(next).not.toBeNull();
    expect(next!.getUTCDate()).toBe(20);
    expect(next!.getUTCHours()).toBe(9);
  });

  it('should handle every-5-minutes expression', () => {
    const now = new Date('2026-03-19T08:02:00Z');
    const next = getNextCronDate('*/5 * * * *', now);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(5);
  });

  it('should return null for invalid expression', () => {
    const result = getNextCronDate('invalid cron', new Date());
    expect(result).toBeNull();
  });
});
