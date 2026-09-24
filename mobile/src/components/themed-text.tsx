import { Platform, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

/**
 * Tipografi eski afrogida.com.tr sitesiyle aynı: cihazın sistem fontu
 * (-apple-system / Segoe UI / Roboto) ama KALIN ağırlıklarla — başlıklar
 * 800, vurgular 800-900, ikincil yazılar bile 600. Ekranlarda tek tek
 * yazılmış fontWeight değerleri de bu ölçeğe bir kademe yukarı taşınır
 * (500→600, 600→700, 700→800, 800→900), böylece her ekranı ayrı ayrı
 * düzeltmek gerekmez.
 */
const WEIGHT_SCALE: Record<string, TextStyle['fontWeight']> = {
  '500': '600',
  '600': '700',
  '700': '800',
  bold: '800',
  '800': '900',
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  const flat = StyleSheet.flatten([
    { color: theme[themeColor ?? 'text'] },
    type === 'default' && styles.default,
    type === 'title' && styles.title,
    type === 'small' && styles.small,
    type === 'smallBold' && styles.smallBold,
    type === 'subtitle' && styles.subtitle,
    type === 'link' && styles.link,
    type === 'linkPrimary' && styles.linkPrimary,
    type === 'code' && styles.code,
    style,
  ]) as TextStyle;

  const w = flat.fontWeight != null ? WEIGHT_SCALE[String(flat.fontWeight)] : undefined;

  return <Text style={w ? { ...flat, fontWeight: w } : flat} {...rest} />;
}

// Ağırlıklar burada ÖLÇEKLENMEDEN önceki değerler (bkz. WEIGHT_SCALE):
// small 500→600, smallBold 700→800, default 500→600, title/subtitle 700→800.
const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 700,
    lineHeight: 52,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: 700,
    letterSpacing: -0.3,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
