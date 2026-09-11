import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthToken } from '@/lib/api';

const TOKEN_KEY = 'afro_token';

export type AuthUser = {
  user_id: string;
  name: string;
  phone: string;
  role: string;
  marketing_consent?: { accepted: boolean };
};

type PendingContract = {
  document_code: string;
  name: string;
  version: string;
  pdf_url?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  pendingContracts: PendingContract[];
  sendOtp: (phone: string, purpose: 'registration' | 'password_reset') => Promise<{ sms_sent: boolean }>;
  register: (data: {
    phone: string;
    name: string;
    password: string;
    otp_code: string;
    marketing_consent: boolean;
  }) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  resetPassword: (phone: string, otpCode: string, newPassword: string) => Promise<void>;
  acceptContract: (documentCode: string, documentVersion: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingContracts, setPendingContracts] = useState<PendingContract[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (stored) {
          setAuthToken(stored);
          const me = await api.get<AuthUser>('/auth/me');
          setToken(stored);
          setUser(me);
          await checkPendingContracts();
        }
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function checkPendingContracts() {
    try {
      const res = await api.get<{ pending_contracts: PendingContract[] }>('/contracts/pending');
      setPendingContracts(res.pending_contracts ?? []);
    } catch {
      // sözleşme kontrolü başarısız olsa da girişi engelleme
    }
  }

  async function applySession(newToken: string, newUser: AuthUser) {
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
    await checkPendingContracts();
  }

  async function sendOtp(phone: string, purpose: 'registration' | 'password_reset') {
    return api.post<{ success: boolean; sms_sent: boolean }>('/auth/send-phone-otp', { phone, purpose });
  }

  async function register(data: {
    phone: string;
    name: string;
    password: string;
    otp_code: string;
    marketing_consent: boolean;
  }) {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/register', data);
    await applySession(res.token, res.user);
  }

  async function login(phone: string, password: string) {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { phone, password });
    await applySession(res.token, res.user);
  }

  async function resetPassword(phone: string, otpCode: string, newPassword: string) {
    await api.post('/auth/reset-password', { phone, otp_code: otpCode, new_password: newPassword });
  }

  async function acceptContract(documentCode: string, documentVersion: string) {
    await api.post('/contracts/accept', { document_code: documentCode, document_version: documentVersion });
    setPendingContracts((prev) => prev.filter((c) => c.document_code !== documentCode));
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // yerel oturumu yine de temizle
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setPendingContracts([]);
  }

  return (
    <AuthContext.Provider
      value={{ user, token, loading, pendingContracts, sendOtp, register, login, resetPassword, acceptContract, logout }}
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
