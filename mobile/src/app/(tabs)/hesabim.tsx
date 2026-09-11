import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

const LINKS = [
  { label: 'Adreslerim', icon: '📍' },
  { label: 'Kuponlarım', icon: '🎟️' },
  { label: 'KVKK Aydınlatma Metni', icon: '📄' },
  { label: 'Yardım & Destek', icon: '💬' },
];

export default function AccountScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Hesabım</ThemedText>
      </View>

      <View style={[styles.loginCard, { backgroundColor: theme.tintSoft }]}>
        <ThemedText type="smallBold">Giriş yapmadın</ThemedText>
        <ThemedText themeColor="textSecondary" type="small" style={styles.loginText}>
          Siparişlerini takip etmek ve hızlı ödeme yapmak için giriş yap.
        </ThemedText>
        <Pressable style={[styles.loginBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/giris')}>
          <ThemedText style={{ color: '#fff' }} type="smallBold">
            Giriş Yap / Kayıt Ol
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.links}>
        {LINKS.map((l) => (
          <Pressable key={l.label} style={[styles.linkRow, { borderColor: theme.border }]}>
            <ThemedText style={styles.linkIcon}>{l.icon}</ThemedText>
            <ThemedText style={styles.flex}>{l.label}</ThemedText>
            <ThemedText themeColor="textSecondary">›</ThemedText>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  loginCard: { marginHorizontal: Spacing.three, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  loginText: { marginBottom: Spacing.one },
  loginBtn: { borderRadius: 10, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
  links: { marginTop: Spacing.four, paddingHorizontal: Spacing.three },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: 1 },
  linkIcon: { fontSize: 18 },
});
