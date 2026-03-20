import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setAccessToken, getAccessToken, ApiError } from './client';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    setAccessToken(null);
  });

  describe('api()', () => {
    it('should make GET request with auth header', async () => {
      setAccessToken('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'hello' }),
      });

      const result = await api('/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/test');
      expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
      expect(result).toEqual({ data: 'hello' });
    });

    it('should set Content-Type for POST with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api('/test', { method: 'POST', body: JSON.stringify({ key: 'val' }) });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.get('Content-Type')).toBe('application/json');
    });

    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: '资源不存在' }),
      });

      await expect(api('/test')).rejects.toThrow(ApiError);
      try {
        await api('/test');
      } catch (e) {
        expect((e as ApiError).status).toBe(404);
        expect((e as ApiError).message).toBe('资源不存在');
      }
    });
  });

  describe('token management', () => {
    it('should store and retrieve access token', () => {
      expect(getAccessToken()).toBeNull();
      setAccessToken('abc');
      expect(getAccessToken()).toBe('abc');
    });

    it('should attempt refresh on 401', async () => {
      localStorageMock.setItem('refreshToken', 'rt-old');

      // First call: 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'expired' }),
      });

      // Refresh call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accessToken: 'new-token', refreshToken: 'new-rt' }),
      });

      // Retry call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
      });

      const result = await api('/protected');
      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(localStorageMock.getItem('refreshToken')).toBe('new-rt');
    });
  });
});
