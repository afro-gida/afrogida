import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api, setToken, setUnauthorizedHandler } from '@/lib/api';

/** Hareketsizlikte otomatik çıkış (kullanıcı isteğiyle 60 dk). */
export const IDLE_LOGOUT_MS = 60 * 60 * 1000;

export type AdminUser = {
  user_id: string;
  name?: string;
  role?: string;
  totp_enabled?: boolean;
  backup_codes_left?: number;
};

type Session = {
  ready: boolean;
  token: string | null;
  user: AdminUser | null;
  signIn: (token: string, user: AdminUser) => void;
  signOut: (reason?: string) => void;
  refreshStatus: () => Promise<void>;
  lastLogoutReason: string | null;
  touch: () => void;
};

const Ctx = createContext<Session | null>(null);

// Web: sessionStorage — pencere kapanınca oturum da biter (localStorage değil).
// iPhone/iPad/Mac: sadece bellekte — uygulama her açılışta yeniden giriş ister.
const KEY = 'afro_admin_session';
function load(): { token: string; user: AdminUser } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save(v: { token: string; user: AdminUser } | null) {
  if (Platform.OS !== 'web') return;
  try {
    if (v) window.sessionStorage.setItem(KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // yok say
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setTok] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [lastLogoutReason, setReason] = useState<string | null>(null);
  const lastActive = useRef(Date.now());

  const signOut = useCallback((reason?: string) => {
    // Sunucudaki oturumu da sil (istek başlığı bu satırda, token silinmeden kurulur)
    if (token) api.post('/auth/logout').catch(() => {});
    setToken(null);
    setTok(null);
    setUser(null);
    save(null);
    setReason(reason ?? null);
  }, [token]);

  const signIn = useCallback((t: string, u: AdminUser) => {
    setToken(t);
    setTok(t);
    setUser(u);
    save({ token: t, user: u });
    setReason(null);
    lastActive.current = Date.now();
  }, []);

  const refreshStatus = useCallback(async () => {
    const s = await api.get<{ totp_enabled: boolean; backup_codes_left: number }>('/admin/2fa/status');
    setUser((u) => {
      const next = u ? { ...u, ...s } : u;
      if (next && token) save({ token, user: next });
      return next;
    });
  }, [token]);

  useEffect(() => {
    const s = load();
    if (s) {
      setToken(s.token);
      setTok(s.token);
      setUser(s.user);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut('Oturum sona erdi. Lütfen yeniden giriş yapın.'));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Hareketsizlik denetimi
  const touch = useCallback(() => {
    lastActive.current = Date.now();
  }, []);
  useEffect(() => {
    if (!token) return;
    const onAct = () => touch();
    if (Platform.OS === 'web') {
      for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, onAct, { passive: true });
    }
    const iv = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LOGOUT_MS) signOut('60 dakika işlem yapılmadığı için güvenlik amacıyla çıkış yapıldı.');
    }, 20_000);
    return () => {
      clearInterval(iv);
      if (Platform.OS === 'web') {
        for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(ev, onAct);
      }
    };
  }, [token, signOut, touch]);

  const value = useMemo(
    () => ({ ready, token, user, signIn, signOut, refreshStatus, lastLogoutReason, touch }),
    [ready, token, user, signIn, signOut, refreshStatus, lastLogoutReason, touch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider eksik');
  return s;
}
