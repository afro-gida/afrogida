import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Robot doğrulaması (Cloudflare Turnstile). Site anahtarı herkese açıktır
 * (sayfada zaten görünür); gizli anahtar sadece sunucuda (TURNSTILE_SECRET_KEY).
 * Anahtar boşsa kutu hiç çıkmaz ve sunucu da doğrulama istemez.
 */
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAAFRccwRy7A6yrpZW';
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
  // Cloudflare tarayıcıyı doğrulayamazsa hata kodu gösterilir (neden bilinsin) + yeniden dene
  const [errCode, setErrCode] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!TURNSTILE_ON) return;
    let cancelled = false;
    let widgetId: string | null = null;
    cb.current(null);
    setErrCode(null);
    loadTurnstile()
      .then((ts) => {
        const el = host.current as unknown as HTMLElement | null;
        if (cancelled || !el) return;
        widgetId = ts.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'tr',
          theme: isDark ? 'dark' : 'light',
          callback: (t: string) => {
            setErrCode(null);
            cb.current(t);
          },
          'expired-callback': () => cb.current(null),
          'error-callback': (code: string | number) => {
            cb.current(null);
            setErrCode(String(code ?? ''));
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) setErrCode('yuklenemedi');
      });
    return () => {
      cancelled = true;
      if (widgetId) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(widgetId);
    };
  }, [resetKey, isDark, retry]);

  if (!TURNSTILE_ON) return null;
  return (
    <View>
      <View ref={host} style={styles.box} />
      {!!errCode && (
        <View style={styles.err}>
          <Text style={styles.errText}>
            Robot doğrulaması bu tarayıcıda yapılamadı (kod: {errCode}). Reklam engelleyici veya VPN açıksa kapatıp tekrar dene.
          </Text>
          <Pressable onPress={() => setRetry((r) => r + 1)} hitSlop={8}>
            <Text style={styles.errBtn}>Tekrar dene</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 65, alignItems: 'center', justifyContent: 'center' },
  err: { alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 8 },
  errText: { color: '#C62828', fontSize: 12.5, lineHeight: 17, textAlign: 'center' },
  errBtn: { color: '#C62828', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
