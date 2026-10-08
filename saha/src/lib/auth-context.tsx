import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthToken } from '@/lib/api';

const TOKEN_KEY = 'afro_saha_token';

/** Bu uygulama tedarikçi (esnaf) ve kuryeler içindir; pazar sorumlusunun
 *  ayrı uygulaması var (sorumlu/). Sunucu da her istekte rolü denetler. */
const ALLOWED_ROLES = ['esnaf', 'supplier', 'kurye'];

export type AuthUser = {
  user_id: string;
  name: string;
  phone: string;
  role: string; // 'esnaf' | 'supplier' | 'kurye'
  supplier_group?: string;
};

export type SupplierContract = {
  contract: { url?: string; version?: string; title?: string };
  current_version?: string;
  accepted: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string, turnstileToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  supplierContract: SupplierContract | null;
  refreshSupplierContract: () => Promise<void>;
  acceptSupplierContract: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [supplierContract, setSupplierContract] = useState<SupplierContract | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (stored) {
          setAuthToken(stored);
          const me = await api.get<AuthUser>('/auth/me');
          // Rolü değişmişse (ör. sorumlu yapılmış) kayıtlı oturumla girmesin
          if (!ALLOWED_ROLES.includes(me.role)) throw new Error('role');
          setUser(me);
          if (me.role === 'esnaf' || me.role === 'supplier') {
            await loadSupplierContract();
          }
        }
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loadSupplierContract() {
    try {
      const c = await api.get<SupplierContract>('/supplier/contract-status');
      setSupplierContract(c);
    } catch {
      // sözleşme durumu alınamazsa girişi engelleme, sadece kapı gösterilmez
    }
  }

  async function login(phone: string, password: string, turnstileToken?: string | null) {
    const res = await api.post<{ token?: string; user?: AuthUser }>('/auth/login', {
      phone,
      password,
      app: 'saha',
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    });
    if (!res.token || !res.user) {
      // Sorumlunun yeni cihaz SMS adımı: bu uygulamada yok
      throw new ApiError(403, 'Pazar sorumlusu hesabı bu uygulamada kullanılmaz. Lütfen Sorumlu uygulamasını açın: sorumlu.afrogida.com.tr');
    }
    if (!ALLOWED_ROLES.includes(res.user.role)) {
      // Açılan oturumu sunucuda da kapat
      setAuthToken(res.token);
      await api.post('/auth/logout').catch(() => {});
      setAuthToken(null);
      throw new ApiError(
        403,
        res.user.role === 'pazar_sorumlusu'
          ? 'Pazar sorumlusu hesabı bu uygulamada kullanılmaz. Lütfen Sorumlu uygulamasını açın.'
          : 'Bu hesap tedarikçi veya kurye değil. Bu uygulama sadece bu hesaplar içindir.',
      );
    }
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser(res.user);
    if (res.user.role === 'esnaf' || res.user.role === 'supplier') {
      await loadSupplierContract();
    }
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
    setSupplierContract(null);
  }

  async function acceptSupplierContract() {
    await api.post('/supplier/accept-contract');
    await loadSupplierContract();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        supplierContract,
        refreshSupplierContract: loadSupplierContract,
        acceptSupplierContract,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}

export { ApiError };
