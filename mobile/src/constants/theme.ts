/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Gerçek afrogida.com.tr sitesinden alınmış marka renkleri
 * (frontend/index.html içindeki buton/tema renkleri).
 */
export const Colors = {
  light: {
    text: '#0d2b1e',
    background: '#ffffff',
    backgroundElement: '#eafff4',
    backgroundSelected: '#cdeee0',
    textSecondary: '#4b6358',
    // Gerçek sitede açık modun aksan rengi TURUNCU'dur (rgb(251,140,60)),
    // koyu modda YEŞİL'dir — bkz. "Duvar Kağıdı Sistemi" dökümanı, madde 3.
    tint: '#fb8c3c',
    tintSoft: '#CCE6D1',
    border: '#cdeee0',
    danger: '#c0392b',
    accentOrange: '#f97316',
    wallpaperBg: '#e2b676',
    // Giriş/kayıt kartı: açık modda ayrı bir "siyah kart" tasarımı yok,
    // normal kart rengiyle aynı kalsın.
    authCard: '#eafff4',
    // Yazı kutuları: uygulamanın geri kalanında (bkz. adreslerim.tsx) zaten
    // kullanılan yarı saydam koyulaştırma - kartın üstüne oturunca hep
    // aynı, tutarlı tonu verir.
    inputBg: 'rgba(255,255,255,0.6)',
  },
  dark: {
    text: '#eafff4',
    background: '#062216',
    backgroundElement: '#0d3325',
    backgroundSelected: '#135f42',
    textSecondary: '#9ccbb8',
    tint: '#14B67E',
    tintSoft: '#154b36',
    border: '#154b36',
    danger: '#f87171',
    accentOrange: '#fb8c3c',
    wallpaperBg: '#0d0d0d',
    // Gerçek sitedeki giriş/kayıt kartı koyu modda YEŞİL değil, neredeyse
    // SİYAH (kullanıcı talimatı) — bkz. Screenshot_20/22 karşılaştırması.
    authCard: '#0d0d0d',
    inputBg: 'rgba(0,0,0,0.25)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Emoji yerine kullanılan çizgi ikonlar için sabit renk — temadan (açık/koyu)
 *  bağımsız olarak her zaman yeşil (kullanıcı talimatı). */
export const IconGreen = '#14B67E';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/** "#rrggbb" rengini verilen saydamlıkta "rgba(...)" stringine çevirir
 *  (buzlu cam kart efekti gibi yarı saydam yüzeyler için). */
export function withAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
