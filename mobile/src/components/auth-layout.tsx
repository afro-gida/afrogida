import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, withAlpha } from '@/constants/theme';

const LOGIN_BANNER = require('@/assets/brand/login-banner.jpg');
// Koyu temada ayrı bir giriş görseli yok — siyah + yeşil duvar kağıdı kullanılıyor.
const LOGIN_BANNER_DARK = require('@/assets/brand/wallpaper-dark.jpg');
const LOGO = require('@/assets/brand/logo.png');

/**
 * Giriş / Kayıt ekranlarının ortak düzeni: üstte marka görseli (logo + AFRO
 * GIDA), altta yukarı taşan kart (tema: açıkta krem, koyuda neredeyse siyah —
 * authCard). Sol üstte yuvarlak geri/kapat düğmesi.
 */
export function AuthLayout({
  title,
  subtitle,
  onBack,
  backIcon = 'close',
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backIcon?: 'close' | 'arrow-back';
  children: ReactNode;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Image source={isDark ? LOGIN_BANNER_DARK : LOGIN_BANNER} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.45)']} style={StyleSheet.absoluteFill} />
          <Pressable
            onPress={onBack}
            hitSlop={10}
            accessibilityLabel={backIcon === 'close' ? 'Kapat' : 'Geri'}
            style={[styles.backBtn, { backgroundColor: withAlpha(theme.authCard, 0.9) }]}
          >
            <Ionicons name={backIcon} size={20} color={theme.text} />
          </Pressable>
          <View style={styles.brand}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            <ThemedText style={styles.brandText}>AFRO GIDA</ThemedText>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.authCard }]}>
          <ThemedText style={styles.title}>{title}</ThemedText>
          {!!subtitle && <ThemedText themeColor="textSecondary" style={styles.subtitle}>{subtitle}</ThemedText>}
          <View style={styles.body}>{children}</View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  hero: { height: 230, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingBottom: 24 },
  backBtn: { position: 'absolute', top: Spacing.three, left: Spacing.three, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  brand: { alignItems: 'center', gap: 2 },
  logo: { width: 76, height: 76, borderRadius: 38, marginBottom: 6 },
  brandText: {
    color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '900', letterSpacing: 2.4,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  card: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -26, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.five },
  title: { fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  body: { gap: Spacing.three, marginTop: Spacing.four },
});
