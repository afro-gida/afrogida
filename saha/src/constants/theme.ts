/**
 * Afro Gıda marka renkleri - mobile/src/constants/theme.ts ile aynı palet
 * (tutarlılık için; bu app'te ayrı bir "wallpaper" sistemi yok).
 */
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0d2b1e',
    background: '#ffffff',
    backgroundElement: '#eafff4',
    backgroundSelected: '#cdeee0',
    textSecondary: '#4b6358',
    tint: '#fb8c3c',
    tintSoft: '#CCE6D1',
    border: '#cdeee0',
    danger: '#c0392b',
    authCard: '#eafff4',
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
    authCard: '#0d0d0d',
    inputBg: 'rgba(0,0,0,0.25)',
  },
} as const;

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
