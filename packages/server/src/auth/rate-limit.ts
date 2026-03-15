import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES } from '@ccclaw/shared';
import type { Context, Next } from 'hono';

// ========== 登录限流（基于 IP） ==========

interface Attempt {
  count: number;
  lockedUntil?: number;
}

const loginAttempts = new Map<string, Attempt>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil) {
    if (Date.now() < record.lockedUntil) {
      return { allowed: false, retryAfterSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000) };
    }
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordLoginFailure(ip: string): void {
  const record = loginAttempts.get(ip) ?? { count: 0 };
  record.count++;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
  }
  loginAttempts.set(ip, record);
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// ========== 通用 API 限流（基于用户 ID，滑动窗口） ==========

interface RateWindow {
  timestamps: number[];
}

const apiWindows = new Map<string, RateWindow>();
const API_RATE_LIMIT = 100; // 每分钟请求数
const API_RATE_WINDOW_MS = 60_000;

export function apiRateLimitMiddleware(maxRequests = API_RATE_LIMIT) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) return next(); // 未认证请求由 auth 中间件拦截

    const key = user.sub;
    const now = Date.now();
    const window = apiWindows.get(key) ?? { timestamps: [] };

    // 清理窗口外的记录
    window.timestamps = window.timestamps.filter((t) => now - t < API_RATE_WINDOW_MS);

    if (window.timestamps.length >= maxRequests) {
      return c.json({ error: '请求频率超限，请稍后再试' }, 429);
    }

    window.timestamps.push(now);
    apiWindows.set(key, window);
    return next();
  };
}

// 定时清理过期窗口（防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of apiWindows.entries()) {
    window.timestamps = window.timestamps.filter((t) => now - t < API_RATE_WINDOW_MS);
    if (window.timestamps.length === 0) apiWindows.delete(key);
  }
}, API_RATE_WINDOW_MS);
