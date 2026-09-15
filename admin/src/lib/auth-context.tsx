import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getAuthToken, setAuthToken } from './api';
import type { AdminUser } from './types';

interface TwoFaChallenge {
  challenge_id: string;
  message: string;
  expires_in: number;
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  /** 1. adım: kullanıcı adı + parola. 2FA gerekiyorsa challenge döner, giriş tamamlanmışsa null döner. */
  login: (username: string, password: string) => Promise<TwoFaChallenge | null>;
  /** 2. adım: SMS ile gelen kodu doğrular ve oturumu açar. */
  verifyCode: (challengeId: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface LoginResponse {
  requires_2fa?: boolean;
  challenge_id?: string;
  expires_in?: number;
  message?: string;
  token?: string;
  user?: AdminUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(!!getAuthToken());

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/admin', { username, password });
    if (res.requires_2fa && res.challenge_id) {
      return { challenge_id: res.challenge_id, message: res.message ?? '', expires_in: res.expires_in ?? 300 };
    }
    if (res.token && res.user) {
      setAuthToken(res.token);
      setUser(res.user);
      return null;
    }
    throw new ApiError(500, 'Beklenmeyen giriş yanıtı');
  }, []);

  const verifyCode = useCallback(async (challengeId: string, code: string) => {
    const res = await api.post<LoginResponse>('/auth/admin/verify-2fa', { challenge_id: challengeId, code });
    if (!res.token || !res.user) throw new ApiError(500, 'Beklenmeyen doğrulama yanıtı');
    setAuthToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  // Sayfa yenilendiğinde: token varsa /auth/me ile kullanıcıyı geri yükle.
  useMemo(() => {
    const token = getAuthToken();
    if (!token) return;
    api
      .get<AdminUser>('/auth/me')
      .then(setUser)
      .catch(() => setAuthToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, verifyCode, logout }),
    [user, loading, login, verifyCode, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
