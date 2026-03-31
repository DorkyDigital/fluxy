import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type UserInfo } from './api';
import { Sentry } from './sentry';
import { getPosthog } from './posthog';

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  onLogin: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const userData = await api.get<UserInfo>('/auth/me');
      setUser(userData);
      Sentry.setUser({ id: userData.id, username: userData.username });
      getPosthog()?.identify(userData.id, { username: userData.username });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(async () => {
    try {
      const { url, state } = await api.get<{ url: string; state: string }>('/auth/login');
      localStorage.setItem('fluxy_oauth_state', state);
      window.location.href = url;
    } catch (err) {
      console.error('Failed to get login URL:', err);
    }
  }, []);

  const onLogin = useCallback(async () => {
    try {
      const userData = await api.get<UserInfo>('/auth/me');
      setUser(userData);
      Sentry.setUser({ id: userData.id, username: userData.username });
      getPosthog()?.identify(userData.id, { username: userData.username });
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    Sentry.setUser(null);
    getPosthog()?.reset();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, onLogin, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
