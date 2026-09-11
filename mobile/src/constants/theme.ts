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
    tint: '#14B67E',
    tintSoft: '#CCE6D1',
    border: '#cdeee0',
    danger: '#c0392b',
    accentOrange: '#f97316',
    wallpaperBg: '#e2b676',
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
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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
