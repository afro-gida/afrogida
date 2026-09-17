import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { type IoniconName } from '@/components/icon-badge';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { useThemePreference, type ThemePreference } from '@/lib/theme-preference';
import { IconGreen, Spacing } from '@/constants/theme';

// Butonlar dolu yeşil kutu değil, siyah zemin + ince yeşil çerçeve
// (kullanıcı talimatı, bkz. referans görsel).
const BTN_BG_DARK = 'rgba(0, 0, 0, 0.9)';
const BTN_BG_LIGHT = 'rgba(255, 255, 255, 0.9)';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

const ROLE_LABELS: Record<string, string> = {
  musteri: 'Afro Gıda Müşterisi',
  member: 'Afro Gıda Müşterisi',
  esnaf: 'Afro Gıda Esnafı',
  yonetici: 'Afro Gıda Yöneticisi',
  admin: 'Afro Gıda Yöneticisi',
};

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IoniconName }[] = [
  { value: 'light', label: 'Açık Tema', icon: 'sunny-outline' },
  { value: 'dark', label: 'Koyu Tema', icon: 'moon-outline' },
  { value: 'system', label: 'Sistem Teması', icon: 'phone-portrait-outline' },
];

export default function AccountScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const btnBg = scheme === 'dark' ? BTN_BG_DARK : BTN_BG_LIGHT;
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, logout, loading, deleteAccount } = useAuth();
  const { preference, setPreference } = useThemePreference();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteAccount();
    setDeleting(false);
    if (res.error) {
      setDeleteError(res.error);
      return;
    }
    setDeleteConfirmOpen(false);
    router.replace('/');
  }

  const links: { label: string; icon: IoniconName; onPress?: () => void }[] = [
    { label: 'Siparişlerim', icon: 'receipt-outline', onPress: () => router.push(`/pazar/${id}/siparislerim`) },
    { label: 'Adreslerim', icon: 'location-outline', onPress: () => router.push('/adreslerim') },
    { label: 'Kampanyalar', icon: 'megaphone-outline', onPress: () => router.push(`/pazar/${id}/kampanyalar`) },
    { label: 'Kuponlarım', icon: 'pricetag-outline', onPress: () => router.push('/kuponlarim') },
    { label: 'Şikayet ve Öneri', icon: 'chatbubble-ellipses-outline', onPress: () => router.push('/sikayet') },
  ];

  const accountLinks: { label: string; icon: IoniconName; onPress?: () => void; danger?: boolean }[] = [
    { label: 'Şifre Değiştir', icon: 'key-outline', onPress: () => router.push('/sifremi-unuttum') },
    { label: 'Hesabımı Sil', icon: 'trash-outline', onPress: () => setDeleteConfirmOpen(true), danger: true },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.flex}>Profilim</ThemedText>
          <Image
            source={scheme === 'dark' ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT}
            style={styles.logoBadge}
            resizeMode="contain"
          />
        </View>

        {loading ? null : user ? (
          <View style={[styles.profileCard, { backgroundColor: btnBg, borderColor: theme.tint }]}>
            <View style={[styles.avatar, { backgroundColor: theme.textSecondary }]}>
              <ThemedText style={styles.avatarText}>{(user.name || '?').trim().charAt(0).toUpperCase()}</ThemedText>
            </View>
            <View style={styles.flex}>
              <ThemedText type="smallBold" style={styles.profileName}>{user.name}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small" style={styles.profilePhone}>{user.phone}</ThemedText>
              <View style={[styles.roleBadge, { borderColor: theme.tint }]}>
                <ThemedText themeColor="tint" type="small" style={styles.roleBadgeText}>
                  ★ {ROLE_LABELS[user.role] ?? 'Afro Gıda Müşterisi'}
                </ThemedText>
              </View>
            </View>
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

        <View style={[styles.linksWrap, { backgroundColor: btnBg, borderColor: theme.tint }]}>
          {links.map((l, i) => (
            <Pressable
              key={l.label}
              onPress={l.onPress}
              disabled={!l.onPress}
              style={[styles.linkRow, i < links.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}
            >
              <Ionicons name={l.icon} size={22} color={IconGreen} />
              <ThemedText style={styles.flex}>{l.label}</ThemedText>
              {l.onPress && <ThemedText themeColor="textSecondary">›</ThemedText>}
            </Pressable>
          ))}
        </View>

        <ThemedText themeColor="textSecondary" type="small" style={styles.sectionLabel}>
          GÖRÜNÜM AYARLARI
        </ThemedText>
        <View style={[styles.linksWrap, { backgroundColor: btnBg, borderColor: theme.tint }]}>
          {THEME_OPTIONS.map((opt, i) => {
            const active = preference === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setPreference(opt.value)}
                style={[styles.linkRow, i < THEME_OPTIONS.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}
              >
                <Ionicons name={opt.icon} size={20} color={IconGreen} />
                <ThemedText style={styles.flex}>{opt.label}</ThemedText>
                <View style={[styles.radioOuter, { borderColor: active ? theme.tint : theme.border }]}>
                  {active && <View style={[styles.radioInner, { backgroundColor: theme.tint }]} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {user && (
          <>
            <ThemedText themeColor="textSecondary" type="small" style={styles.sectionLabel}>
              HESAP AYARLARI
            </ThemedText>
            <View style={[styles.linksWrap, { backgroundColor: btnBg, borderColor: theme.tint }]}>
              {accountLinks.map((l, i) => (
                <Pressable
                  key={l.label}
                  onPress={l.onPress}
                  style={[styles.linkRow, i < accountLinks.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}
                >
                  <Ionicons name={l.icon} size={22} color={l.danger ? theme.danger : IconGreen} />
                  <ThemedText style={styles.flex} themeColor={l.danger ? 'danger' : undefined}>{l.label}</ThemedText>
                  <ThemedText themeColor={l.danger ? 'danger' : 'textSecondary'}>›</ThemedText>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {user && (
          <Pressable style={[styles.logoutBtn, { borderColor: theme.danger }]} onPress={() => logout()}>
            <ThemedText themeColor="danger" type="smallBold">
              Çıkış Yap
            </ThemedText>
          </Pressable>
        )}

        <ThemedText themeColor="textSecondary" type="small" style={styles.version}>
          Afro Gıda • v1.0.0
        </ThemedText>
      </ScrollView>

      <Modal visible={deleteConfirmOpen} transparent animationType="fade" onRequestClose={() => setDeleteConfirmOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !deleting && setDeleteConfirmOpen(false)} />
        <View style={styles.modalCenterWrap} pointerEvents="box-none">
          <View style={[styles.confirmBox, { backgroundColor: theme.background, borderColor: theme.danger }]}>
            <Ionicons name="warning-outline" size={32} color={theme.danger} />
            <ThemedText type="smallBold" style={{ textAlign: 'center', marginTop: Spacing.one }}>
              Hesabını silmek istediğine emin misin?
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" style={{ textAlign: 'center', marginTop: 4 }}>
              Bu işlem geri alınamaz. Kişisel bilgilerin silinir, yasal olarak saklanması gereken sipariş kayıtları anonimleştirilir.
            </ThemedText>
            {deleteError && (
              <ThemedText themeColor="danger" type="small" style={{ marginTop: Spacing.one, textAlign: 'center' }}>
                {deleteError}
              </ThemedText>
            )}
            <View style={styles.confirmActions}>
              <Pressable style={[styles.confirmBtn, { borderColor: theme.border }]} onPress={() => setDeleteConfirmOpen(false)} disabled={deleting}>
                <ThemedText type="smallBold">Vazgeç</ThemedText>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { backgroundColor: theme.danger }]} onPress={handleDeleteAccount} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : (
                  <ThemedText style={{ color: '#fff' }} type="smallBold">Sil</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: Spacing.six + Spacing.four },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  logoBadge: { width: 60, height: 60 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    marginHorizontal: Spacing.three, borderRadius: 16, borderWidth: 0.75, padding: Spacing.three,
  },
  avatar: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  profileName: { fontSize: 17, lineHeight: 22 },
  profilePhone: { fontSize: 15, lineHeight: 20 },
  roleBadge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1.5, paddingHorizontal: Spacing.two, paddingVertical: 3, marginTop: 6 },
  roleBadgeText: { fontWeight: '700', fontSize: 13 },
  loginCard: { marginHorizontal: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  loginText: { marginBottom: Spacing.one },
  loginBtn: { borderRadius: 999, paddingVertical: Spacing.two + 2, alignItems: 'center', marginTop: Spacing.one },
  linksWrap: {
    marginTop: Spacing.four, marginHorizontal: Spacing.three,
    borderRadius: 16, borderWidth: 0.75, overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingVertical: Spacing.three, paddingHorizontal: Spacing.three,
  },
  sectionLabel: { marginTop: Spacing.four, marginHorizontal: Spacing.three, fontWeight: '700', letterSpacing: 0.5 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  logoutBtn: {
    marginTop: Spacing.four, marginHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1.5,
    paddingVertical: Spacing.three, alignItems: 'center',
  },
  version: { textAlign: 'center', marginTop: Spacing.three },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCenterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  confirmBox: { width: '100%', maxWidth: 340, borderRadius: 18, borderWidth: 1.5, padding: Spacing.four, alignItems: 'center' },
  confirmActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three, width: '100%' },
  confirmBtn: { flex: 1, borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two + 2, alignItems: 'center', justifyContent: 'center' },
});
