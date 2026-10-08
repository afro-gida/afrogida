import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api, ApiError, setAuthToken, setDeviceToken, setUnauthorizedHandler } from '@/lib/api';

const TOKEN_KEY = 'afro_sorumlu_token';
const DEVICE_KEY = 'afro_sorumlu_device';

/** Bu uygulama SADECE pazar sorumluları içindir (tedarikçi + kurye ayrı
 *  uygulamada: saha/). Sunucu da her istekte rolü ayrıca denetler. */
const ALLOWED_ROLES = ['pazar_sorumlusu'];

/** Hareketsizlikte otomatik çıkış. Sunucuda oturum ayrıca en fazla 12 saat. */
const IDLE_LOGOUT_MS = 60 * 60 * 1000;

export type AuthUser = {
  user_id: string;
  name: string;
  phone: string;
  role: string;
  managed_markets?: string[];
};

/** Yeni cihazdan girişte SMS kodu bekleniyor. */
export type DeviceChallenge = { challenge_id: string; message?: string };

type LoginResult = { ok: true } | { ok: false; challenge: DeviceChallenge };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  logoutReason: string | null;
  login: (phone: string, password: string, turnstileToken?: string | null) => Promise<LoginResult>;
  verifyDevice: (challengeId: string, code: string, remember: boolean) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const dev = await AsyncStorage.getItem(DEVICE_KEY);
        if (dev) setDeviceToken(dev);
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

  async function startSession(token: string, u: AuthUser) {
    if (!ALLOWED_ROLES.includes(u.role)) {
      // Açılan oturumu sunucuda da kapat
      setAuthToken(token);
      await api.post('/auth/logout').catch(() => {});
      setAuthToken(null);
      throw new ApiError(403, 'Bu hesap pazar sorumlusu değil. Bu uygulama sadece pazar sorumluları içindir.');
    }
    await AsyncStorage.setItem(TOKEN_KEY, token);
    setAuthToken(token);
    setUser(u);
    setLogoutReason(null);
    lastActive.current = Date.now();
  }

  async function login(phone: string, password: string, turnstileToken?: string | null): Promise<LoginResult> {
    const res = await api.post<{ token?: string; user?: AuthUser; requires_device_verification?: boolean; challenge_id?: string; message?: string }>(
      '/auth/login',
      { phone, password, ...(turnstileToken ? { turnstile_token: turnstileToken } : {}) },
    );
    if (res.requires_device_verification && res.challenge_id) {
      return { ok: false, challenge: { challenge_id: res.challenge_id, message: res.message } };
    }
    if (!res.token || !res.user) throw new ApiError(500, 'Beklenmeyen yanıt');
    await startSession(res.token, res.user);
    return { ok: true };
  }

  async function verifyDevice(challengeId: string, code: string, remember: boolean) {
    const res = await api.post<{ token: string; user: AuthUser; device_token?: string | null }>('/auth/device/verify', {
      challenge_id: challengeId,
      code,
      remember,
    });
    if (res.device_token) {
      await AsyncStorage.setItem(DEVICE_KEY, res.device_token);
      setDeviceToken(res.device_token);
    }
    await startSession(res.token, res.user);
  }

  const logout = useCallback(async (reason?: string) => {
    try {
      await api.post('/auth/logout');
    } catch {
      // yerel oturumu yine de temizle
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    setLogoutReason(reason ?? null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout('Oturum sona erdi. Lütfen yeniden giriş yapın.');
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Hareketsizlik denetimi (web: fare/klavye/dokunma; uygulama: dokunma — kök görünüm)
  useEffect(() => {
    if (!user) return;
    const onAct = () => {
      lastActive.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'wheel', 'touchstart'];
    if (Platform.OS === 'web') events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LOGOUT_MS) logout('60 dakika işlem yapılmadığı için güvenlik amacıyla çıkış yapıldı.');
    }, 30_000);
    return () => {
      clearInterval(iv);
      if (Platform.OS === 'web') events.forEach((e) => window.removeEventListener(e, onAct));
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, loading, logoutReason, login, verifyDevice, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}

export { ApiError };
