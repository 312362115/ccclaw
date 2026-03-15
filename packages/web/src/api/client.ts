// API 客户端：fetch wrapper + 自动 token 刷新

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    accessToken = data.accessToken;
    if (data.refreshToken) {
      localStorage.setItem('refreshToken', data.refreshToken);
    }
    return accessToken;
  } catch {
    return null;
  }
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(`/api${path}`, { ...options, headers });

  // 401 → 尝试刷新 token 后重试
  if (res.status === 401 && localStorage.getItem('refreshToken')) {
    if (!refreshPromise) {
      refreshPromise = refreshToken().finally(() => { refreshPromise = null; });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(`/api${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText, body);
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
