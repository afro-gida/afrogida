import { useColorScheme } from 'react-native';

/** Tema kuralı: açık = turuncu + krem, koyu = siyah + yeşil. Panel hafif:
 *  gölge / bulanıklık / görsel efekt yok. */
const light = {
  bg: '#f4ead9',
  card: '#fbf5ea',
  cardAlt: '#f1e4cf',
  text: '#2a1d12',
  muted: '#7a6a58',
  border: 'rgba(60,40,20,0.14)',
  tint: '#e0701a',
  tintText: '#ffffff',
  danger: '#c0392b',
  ok: '#2e7d4f',
  warn: '#b7791f',
  input: '#fffaf2',
};

const dark: typeof light = {
  bg: '#0b0f0d',
  card: '#131a16',
  cardAlt: '#1a231e',
  text: '#eef3ef',
  muted: '#9aa8a0',
  border: 'rgba(255,255,255,0.10)',
  tint: '#14b67e',
  tintText: '#04140d',
  danger: '#e5584a',
  ok: '#34c77b',
  warn: '#e0a83a',
  input: '#0f1512',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
