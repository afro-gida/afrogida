import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * Başlık çubuklu açılır form sayfaları (Şifremi Unuttum, Şifre Değiştir):
 * üstte yuvarlak ikon + başlık + açıklama, altında form alanları. Kart,
 * giriş ekranıyla aynı zemin (authCard).
 */
export function FormCardScreen({ icon, title, subtitle, children }: { icon: Mci; title: string; subtitle?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[surface.card, surface.shadow, styles.card, { backgroundColor: theme.authCard }]}>
          <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
            <MaterialCommunityIcons name={icon} size={30} color={theme.tint} />
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          {!!subtitle && <ThemedText themeColor="textSecondary" style={styles.subtitle}>{subtitle}</ThemedText>}
          <View style={styles.body}>{children}</View>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Tam genişlik ana düğme (yükleniyor göstergeli). */
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  arrow = true,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  arrow?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [
        surface.primaryBtn,
        { backgroundColor: disabled ? withAlpha(theme.tint, 0.35) : theme.tint, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <ThemedText style={surface.primaryBtnText}>{label}</ThemedText>
          {arrow && <Ionicons name="arrow-forward" size={18} color="#fff" />}
        </>
      )}
    </Pressable>
  );
}

/** Adım göstergesi: "1 Telefon — 2 Yeni şifre". */
export function Steps({ labels, current }: { labels: string[]; current: number }) {
  const theme = useTheme();
  return (
    <View style={styles.steps}>
      {labels.map((l, i) => {
        const done = i < current;
        const active = i === current;
        const on = done || active;
        return (
          <View key={l} style={styles.stepItem}>
            {i > 0 && <View style={[styles.stepLine, { backgroundColor: on ? theme.tint : withAlpha(theme.text, 0.15) }]} />}
            <View style={[styles.stepDot, { backgroundColor: on ? theme.tint : withAlpha(theme.text, 0.12) }]}>
              {done ? (
                <Ionicons name="checkmark" size={13} color="#fff" />
              ) : (
                <ThemedText style={[styles.stepNum, { color: on ? '#fff' : theme.textSecondary }]}>{i + 1}</ThemedText>
              )}
            </View>
            <ThemedText style={[styles.stepLabel, { color: on ? theme.text : theme.textSecondary }]}>{l}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.three, paddingBottom: Spacing.five },
  card: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.four, gap: 4 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.5, marginTop: Spacing.two },
  subtitle: { fontSize: 14, lineHeight: 19 },
  body: { gap: Spacing.three, marginTop: Spacing.three },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepLine: { width: 22, height: 2, borderRadius: 1 },
  stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 12, lineHeight: 14, fontWeight: '900' },
  stepLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: '800' },
});
