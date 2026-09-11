import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
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
  const { user, logout, loading } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Hesabım</ThemedText>
        </View>

        {loading ? null : user ? (
          <View style={[styles.loginCard, { backgroundColor: theme.tintSoft }]}>
            <ThemedText type="smallBold">{user.name}</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              {user.phone}
            </ThemedText>
            <Pressable style={[styles.logoutBtn, { borderColor: theme.tint }]} onPress={() => logout()}>
              <ThemedText themeColor="tint" type="smallBold">
                Çıkış Yap
              </ThemedText>
            </Pressable>
          </View>
        ) : (
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
        )}

        <View style={[styles.links, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {LINKS.map((l, i) => (
            <Pressable
              key={l.label}
              style={[styles.linkRow, i < LINKS.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}
            >
              <ThemedText style={styles.linkIcon}>{l.icon}</ThemedText>
              <ThemedText style={styles.flex}>{l.label}</ThemedText>
              <ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: Spacing.five },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  loginCard: { marginHorizontal: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  loginText: { marginBottom: Spacing.one },
  loginBtn: { borderRadius: 999, paddingVertical: Spacing.two + 2, alignItems: 'center', marginTop: Spacing.one },
  logoutBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
  links: { marginTop: Spacing.four, marginHorizontal: Spacing.three, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three },
  linkIcon: { fontSize: 18 },
});
