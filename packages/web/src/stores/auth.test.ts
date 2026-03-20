import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock api client
const mockApi = vi.fn();
const mockSetAccessToken = vi.fn();
vi.mock('../api/client', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
}));

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

import { useAuthStore } from './auth';

describe('auth store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    useAuthStore.setState({ user: null, loading: true });
  });

  describe('login', () => {
    it('should set user and tokens on successful login', async () => {
      mockApi.mockResolvedValue({
        accessToken: 'at-123',
        refreshToken: 'rt-456',
        user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'user' },
      });

      await useAuthStore.getState().login('test@test.com', 'password');

      expect(mockApi).toHaveBeenCalledWith('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com', password: 'password' }),
      });
      expect(mockSetAccessToken).toHaveBeenCalledWith('at-123');
      expect(localStorageMock.getItem('refreshToken')).toBe('rt-456');
      expect(useAuthStore.getState().user?.name).toBe('Test');
    });
  });

  describe('logout', () => {
    it('should clear user and tokens', async () => {
      useAuthStore.setState({ user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'user' } });
      localStorageMock.setItem('refreshToken', 'rt-old');
      mockApi.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(mockSetAccessToken).toHaveBeenCalledWith(null);
      expect(localStorageMock.getItem('refreshToken')).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('should not throw if logout API fails', async () => {
      mockApi.mockRejectedValue(new Error('network error'));

      await expect(useAuthStore.getState().logout()).resolves.not.toThrow();
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('register', () => {
    it('should call register API with correct params', async () => {
      mockApi.mockResolvedValue(undefined);

      await useAuthStore.getState().register('Test', 'test@test.com', 'pass', 'invite-123');

      expect(mockApi).toHaveBeenCalledWith('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'test@test.com', password: 'pass', inviteCode: 'invite-123' }),
      });
    });
  });
});
