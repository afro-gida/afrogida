import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthToken } from '@/lib/api';

const TOKEN_KEY = 'afro_sorumlu_token';

/** Bu uygulama SADECE pazar sorumluları içindir (tedarikçi + kurye ayrı
 *  uygulamada: saha/). Sunucu da her istekte rolü ayrıca denetler. */
const ALLOWED_ROLES = ['pazar_sorumlusu'];

export type AuthUser = {
  user_id: string;
  name: string;
  phone: string;
  role: string;
  managed_markets?: string[];
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (stored) {
          setAuthToken(stored);
          const me = await api.get<AuthUser>('/auth/me');
          // Rolü sorumluluktan alınmışsa kayıtlı oturumla içeri girmesin
          if (!ALLOWED_ROLES.includes(me.role)) throw new Error('role');
          setUser(me);
        }
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(phone: string, password: string) {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { phone, password });
    if (!ALLOWED_ROLES.includes(res.user.role)) {
      // Açılan oturumu sunucuda da kapat
      setAuthToken(res.token);
      await api.post('/auth/logout').catch(() => {});
      setAuthToken(null);
      throw new ApiError(403, 'Bu hesap pazar sorumlusu değil. Bu uygulama sadece pazar sorumluları içindir.');
    }
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser(res.user);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // yerel oturumu yine de temizle
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}

export { ApiError };
