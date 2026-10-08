import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Robot doğrulaması (Cloudflare Turnstile). Site anahtarı herkese açıktır
 * (sayfada zaten görünür); gizli anahtar sadece sunucuda (TURNSTILE_SECRET_KEY).
 * Anahtar boşsa kutu hiç çıkmaz ve sunucu da doğrulama istemez.
 */
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';
export const TURNSTILE_ON = Platform.OS === 'web' && !!TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

let loader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => {
      loader = null;
      s.remove();
      reject(new Error('network'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

/**
 * Doğrulama kutusu. Geçilince onToken(token) çağrılır; süresi dolunca / hata
 * olunca onToken(null). Token tek kullanımlıktır: her gönderimden sonra
 * resetKey'i değiştirip kutuyu yenileyin.
 */
export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const host = useRef<View>(null);
  const isDark = useColorScheme() === 'dark';
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_ON) return;
    let cancelled = false;
    let widgetId: string | null = null;
    cb.current(null);
    loadTurnstile()
      .then((ts) => {
        const el = host.current as unknown as HTMLElement | null;
        if (cancelled || !el) return;
        widgetId = ts.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'tr',
          theme: isDark ? 'dark' : 'light',
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (widgetId) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(widgetId);
    };
  }, [resetKey, isDark]);

  if (!TURNSTILE_ON) return null;
  return <View ref={host} style={styles.box} />;
}

const styles = StyleSheet.create({
  box: { minHeight: 65, alignItems: 'center', justifyContent: 'center' },
});
