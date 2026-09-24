/**
 * Afro Gıda marka renkleri - mobile/src/constants/theme.ts ile aynı palet
 * (tutarlılık için; bu app'te ayrı bir "wallpaper" sistemi yok).
 */
import { Platform } from 'react-native';

export const Colors = {
  // Tema kuralı (kullanıcı talimatı): AÇIK tema = turuncu + krem tonları,
  // KOYU tema = siyah + yeşil. Açık temada nane yeşili yüzey/yeşil yazı yok.
  light: {
    text: '#2e1d0e',
    background: '#fffaf2',
    backgroundElement: '#fdf0dc',
    backgroundSelected: '#f8dcb4',
    textSecondary: '#7a5a3c',
    tint: '#fb8c3c',
    tintSoft: '#fde2c8',
    border: '#f1d6b0',
    danger: '#c0392b',
    authCard: '#fdf0dc',
    inputBg: 'rgba(255,255,255,0.6)',
  },
  dark: {
    // Kullanıcı isteğiyle (2026-09-18): yeşilimsi yüzeyler yerine nötr
    // siyah - sayfa zemini tam siyah (#050505), kartlar bir tık açık
    // (#0d0d0d) ki sınırları görünsün, mobile/'deki authCard ile aynı fikir.
    text: '#eafff4',
    background: '#050505',
    backgroundElement: '#0d0d0d',
    backgroundSelected: '#1a1a1a',
    textSecondary: '#9ccbb8',
    tint: '#14B67E',
    tintSoft: '#154b36',
    border: '#232323',
    danger: '#f87171',
    authCard: '#0d0d0d',
    inputBg: 'rgba(0,0,0,0.4)',
  },
} as const;

/** Menü ikonları — mobile/ ile aynı: temadan bağımsız her zaman yeşil. */
export const IconGreen = '#14B67E';

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded' },
  default: { sans: 'normal', rounded: 'normal' },
  web: { sans: 'system-ui', rounded: 'system-ui' },
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
