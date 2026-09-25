import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { useThemePreference, type ThemePreference } from '@/lib/theme-preference';
import { Spacing, withAlpha } from '@/constants/theme';

// Premium tasarım (sepet / takip ekranlarıyla aynı dil): çerçevesiz dolu
// kartlar + sıcak hafif gölge; duvar kağıdının üstünde hafif perde.
const CARD_BG_DARK = '#0e1411';
const CARD_BG_LIGHT = '#f8ebd6';
const LIST_SCRIM_DARK = 'rgba(0, 0, 0, 0.55)';
const LIST_SCRIM_LIGHT = 'rgba(232, 201, 158, 0.32)';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

const ROLE_LABELS: Record<string, string> = {
  musteri: 'Afro Gıda Müşterisi',
  member: 'Afro Gıda Müşterisi',
  esnaf: 'Afro Gıda Esnafı',
  yonetici: 'Afro Gıda Yöneticisi',
  admin: 'Afro Gıda Yöneticisi',
};

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { value: 'light', label: 'Açık', icon: 'white-balance-sunny' },
  { value: 'dark', label: 'Koyu', icon: 'weather-night' },
  { value: 'system', label: 'Sistem', icon: 'cellphone' },
];

export default function AccountScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
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

  const isDark = scheme === 'dark';
  const cardBg = isDark ? CARD_BG_DARK : CARD_BG_LIGHT;

  const tiles: { label: string; icon: Mci; onPress: () => void }[] = [
    { label: 'Siparişlerim', icon: 'receipt-text-outline', onPress: () => router.push(`/pazar/${id}/siparislerim`) },
    { label: 'Adreslerim', icon: 'map-marker-outline', onPress: () => router.push('/adreslerim') },
    { label: 'Kuponlarım', icon: 'ticket-percent-outline', onPress: () => router.push('/kuponlarim') },
    { label: 'Şikayet ve Öneri', icon: 'message-text-outline', onPress: () => router.push('/sikayet') },
  ];

  return (
    <Screen>
      <View style={[styles.flex, { backgroundColor: isDark ? LIST_SCRIM_DARK : LIST_SCRIM_LIGHT }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <ThemedText style={[styles.title, styles.flex]}>Profilim</ThemedText>
            <Image source={isDark ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT} style={styles.logoBadge} resizeMode="contain" />
          </View>

          {loading ? null : user ? (
            <View style={[styles.card, styles.shadow, styles.profileCard, { backgroundColor: cardBg }]}>
              <View style={[styles.avatar, { backgroundColor: theme.tint }]}>
                <ThemedText style={styles.avatarText}>{(user.name || '?').trim().charAt(0).toLocaleUpperCase('tr-TR')}</ThemedText>
              </View>
              <View style={styles.flex}>
                <ThemedText style={styles.profileName} numberOfLines={1}>{user.name}</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.profilePhone}>{formatPhone(user.phone)}</ThemedText>
                <View style={[styles.rolePill, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name="star-circle" size={14} color={theme.tint} />
                  <ThemedText style={[styles.roleText, { color: theme.tint }]}>{ROLE_LABELS[user.role] ?? 'Afro Gıda Müşterisi'}</ThemedText>
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.card, styles.shadow, styles.loginCard, { backgroundColor: cardBg }]}>
              <View style={[styles.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                <MaterialCommunityIcons name="account-outline" size={30} color={theme.tint} />
              </View>
              <ThemedText style={styles.loginTitle}>Giriş yapmadın</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.loginText}>
                Siparişlerini takip etmek ve hızlı ödeme yapmak için giriş yap.
              </ThemedText>
              <Pressable style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.88 : 1 }]} onPress={() => router.push('/giris')}>
                <ThemedText style={styles.primaryBtnText}>Giriş Yap / Kayıt Ol</ThemedText>
              </Pressable>
            </View>
          )}

          {/* Kısayollar */}
          <View style={styles.tiles}>
            {tiles.map((t) => (
              <Pressable
                key={t.label}
                onPress={t.onPress}
                style={({ pressed }) => [styles.tile, styles.shadow, { backgroundColor: cardBg, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={[styles.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name={t.icon} size={20} color={theme.tint} />
                </View>
                <ThemedText style={styles.tileText}>{t.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText themeColor="textSecondary" style={styles.sectionLabel}>GÖRÜNÜM</ThemedText>
          <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
            <View style={[styles.segment, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
              {THEME_OPTIONS.map((opt) => {
                const active = preference === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setPreference(opt.value)}
                    style={[styles.segmentBtn, active && [styles.segmentActive, { backgroundColor: theme.tint }]]}
                  >
                    <MaterialCommunityIcons name={opt.icon} size={16} color={active ? '#fff' : theme.textSecondary} />
                    <ThemedText numberOfLines={1} style={[styles.segmentText, { color: active ? '#fff' : theme.text }]}>{opt.label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {user && (
            <>
              <ThemedText themeColor="textSecondary" style={styles.sectionLabel}>HESAP</ThemedText>
              <View style={[styles.card, styles.shadow, styles.listCard, { backgroundColor: cardBg }]}>
                <Row icon="key-outline" label="Şifre Değiştir" onPress={() => router.push('/sifre-degistir')} />
                <Row icon="trash-can-outline" label="Hesabımı Sil" onPress={() => setDeleteConfirmOpen(true)} danger last />
              </View>

              {/* Çıkış: en altta oturum kartı — kimin hesabından çıkıldığı görünür,
                  sağda dolu kırmızı "Çıkış" düğmesi. */}
              <View style={[styles.card, styles.shadow, styles.sessionCard, { backgroundColor: cardBg }]}>
                <View style={[styles.sessionAvatar, { backgroundColor: withAlpha(theme.tint, 0.16) }]}>
                  <ThemedText style={[styles.sessionAvatarText, { color: theme.tint }]}>
                    {(user.name || '?').trim().charAt(0).toLocaleUpperCase('tr-TR')}
                  </ThemedText>
                  <View style={[styles.sessionDot, { borderColor: cardBg }]} />
                </View>
                <View style={styles.flex}>
                  <ThemedText themeColor="textSecondary" style={styles.sessionLabel}>Oturum açık</ThemedText>
                  <ThemedText style={styles.sessionName} numberOfLines={1}>{user.name}</ThemedText>
                </View>
                <Pressable
                  onPress={() => logout()}
                  accessibilityLabel="Çıkış Yap"
                  style={({ pressed }) => [styles.sessionBtn, { backgroundColor: theme.danger, opacity: pressed ? 0.85 : 1 }]}
                >
                  <MaterialCommunityIcons name="logout" size={16} color="#fff" />
                  <ThemedText style={styles.sessionBtnText}>Çıkış</ThemedText>
                </Pressable>
              </View>
            </>
          )}

          <ThemedText themeColor="textSecondary" style={styles.version}>Afro Gıda • v1.0.0</ThemedText>
        </ScrollView>
      </View>

      <Modal visible={deleteConfirmOpen} transparent animationType="fade" onRequestClose={() => setDeleteConfirmOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !deleting && setDeleteConfirmOpen(false)} />
        <View style={styles.modalCenterWrap} pointerEvents="box-none">
          <View style={[styles.confirmBox, styles.shadow, { backgroundColor: isDark ? '#0a0f0c' : theme.background }]}>
            <View style={[styles.iconCircleLg, { backgroundColor: withAlpha(theme.danger, 0.14) }]}>
              <MaterialCommunityIcons name="alert-outline" size={28} color={theme.danger} />
            </View>
            <ThemedText style={styles.confirmTitle}>Hesabını silmek istediğine emin misin?</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.confirmText}>
              Bu işlem geri alınamaz. Kişisel bilgilerin silinir, yasal olarak saklanması gereken sipariş kayıtları anonimleştirilir.
            </ThemedText>
            {deleteError && <ThemedText style={[styles.confirmText, { color: theme.danger }]}>{deleteError}</ThemedText>}
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmBtn, { backgroundColor: withAlpha(theme.text, 0.08) }]}
                onPress={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
              >
                <ThemedText style={styles.confirmBtnText}>Vazgeç</ThemedText>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { backgroundColor: theme.danger }]} onPress={handleDeleteAccount} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : <ThemedText style={[styles.confirmBtnText, { color: '#fff' }]}>Sil</ThemedText>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

/** Liste satırı: yuvarlak ikon + başlık + ok; satırlar arasında ince ayraç. */
function Row({ icon, label, onPress, danger, last }: { icon: Mci; label: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.tint;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: withAlpha(theme.text, 0.15) },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: withAlpha(color, 0.14) }]}>
        <MaterialCommunityIcons name={icon} size={19} color={color} />
      </View>
      <ThemedText style={[styles.rowText, danger && { color: theme.danger }]}>{label}</ThemedText>
      <Ionicons name="chevron-forward" size={18} color={danger ? theme.danger : theme.textSecondary} />
    </Pressable>
  );
}

/** "05001234567" -> "0500 123 45 67" (okunaklı); farklı biçimse olduğu gibi. */
function formatPhone(p?: string) {
  const d = (p ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  return p ?? '';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six + Spacing.five },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.two },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  logoBadge: { width: 48, height: 48 },
  card: { borderRadius: 22, padding: Spacing.three },
  shadow: { shadowColor: '#7a4a1c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 3 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '900' },
  profileName: { fontSize: 19, lineHeight: 23, fontWeight: '900', letterSpacing: -0.3 },
  profilePhone: { fontSize: 14, lineHeight: 18, fontWeight: '600', marginTop: 1 },
  rolePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 4, marginTop: 6 },
  roleText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  loginCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.four },
  iconCircleLg: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  loginTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900' },
  loginText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  primaryBtn: { alignSelf: 'stretch', borderRadius: 999, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  primaryBtnText: { color: '#fff', fontSize: 15, lineHeight: 19, fontWeight: '900' },
  // Kısayollar (2x2)
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two + 4, marginTop: Spacing.three },
  tile: { flexBasis: '47%', flexGrow: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.two + 2 },
  tileText: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { marginTop: Spacing.four, marginBottom: Spacing.two, marginLeft: 4, fontSize: 12, lineHeight: 15, fontWeight: '800', letterSpacing: 0.8 },
  listCard: { paddingVertical: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, paddingVertical: Spacing.two + 2 },
  rowText: { flex: 1, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  // Tema seçici
  segment: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 42, borderRadius: 12, paddingHorizontal: 4 },
  segmentActive: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 2 },
  segmentText: { fontSize: 13, lineHeight: 16, fontWeight: '800', flexShrink: 1 },
  sessionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, marginTop: Spacing.four, paddingVertical: Spacing.two + 4 },
  sessionAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sessionAvatarText: { fontSize: 18, lineHeight: 22, fontWeight: '900' },
  sessionDot: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, backgroundColor: '#22c55e' },
  sessionLabel: { fontSize: 11.5, lineHeight: 14, fontWeight: '800', letterSpacing: 0.4 },
  sessionName: { fontSize: 15.5, lineHeight: 20, fontWeight: '900' },
  sessionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, height: 40, paddingHorizontal: Spacing.three },
  sessionBtnText: { color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '900' },
  version: { textAlign: 'center', marginTop: Spacing.four, fontSize: 12, lineHeight: 15 },
  // Hesap silme onayı
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCenterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  confirmBox: { width: '100%', maxWidth: 360, borderRadius: 26, padding: Spacing.four, alignItems: 'center', gap: Spacing.one },
  confirmTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  confirmText: { fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three, alignSelf: 'stretch' },
  confirmBtn: { flex: 1, borderRadius: 999, height: 46, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
});
