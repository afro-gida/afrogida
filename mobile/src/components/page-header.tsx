import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { CARD_BG, surface } from '@/constants/surfaces';
import { Spacing } from '@/constants/theme';

/** Başlık çubuğu olmayan alt sayfaların ortak başlığı: yuvarlak geri + büyük başlık (+ sağ öğe). */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        hitSlop={10}
        accessibilityLabel="Geri"
        style={[styles.roundBtn, { backgroundColor: isDark ? CARD_BG.dark : CARD_BG.light }]}
      >
        <Ionicons name="chevron-back" size={22} color={theme.text} />
      </Pressable>
      <View style={styles.flex}>
        <ThemedText style={surface.title} numberOfLines={1}>{title}</ThemedText>
        {!!subtitle && <ThemedText themeColor="textSecondary" style={surface.subtitle}>{subtitle}</ThemedText>}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
