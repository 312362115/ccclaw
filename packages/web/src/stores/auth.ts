import { create } from 'zustand';
import { api, setAccessToken } from '../api/client';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  register: (name: string, email: string, password: string, inviteCode: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const data = await api<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    setAccessToken(data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    set({ user: data.user });
  },

  logout: async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    setAccessToken(null);
    localStorage.removeItem('refreshToken');
    set({ user: null });
  },

  fetchMe: async () => {
    try {
      // 先尝试用 refreshToken 获取 accessToken
      const rt = localStorage.getItem('refreshToken');
      if (rt) {
        const refresh = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (refresh.ok) {
          const tokens = await refresh.json();
          setAccessToken(tokens.accessToken);
          if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
        }
      }
      const user = await api<User>('/auth/me');
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  register: async (name, email, password, inviteCode) => {
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, inviteCode }),
    });
  },
}));
