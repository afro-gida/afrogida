import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthToken } from '@/lib/api';

const TOKEN_KEY = 'afro_saha_token';

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
  login: (phone: string, password: string) => Promise<void>;
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

  async function login(phone: string, password: string) {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { phone, password });
    if (res.user.role !== 'esnaf' && res.user.role !== 'supplier' && res.user.role !== 'kurye') {
      throw new ApiError(403, 'Bu hesap tedarikçi veya kurye değil. Bu uygulama sadece tedarikçi/kurye hesapları içindir.');
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
