import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/form-card';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { fetchCoupons, type Coupon } from '@/lib/coupons';
import { formatMoney } from '@/lib/format';
import { CARD_BG, SCRIM, surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';

/** "2026-10-31" -> "31 Ekim 2026 (30 gün)" — kupon o günün sonuna kadar geçerli. */
function formatValidUntil(iso: string) {
  const day = iso.slice(0, 10);
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const label = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const left = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return `${label} (${left <= 0 ? 'bugün son gün' : `${left} gün`})`;
}

export default function MyCouponsScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const cardBg = isDark ? CARD_BG.dark : CARD_BG.light;
  const scrim = isDark ? SCRIM.dark : SCRIM.light;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Oturum geri yüklenmeden istenirse üyeye özel kuponlar gelmiyordu -> oturumu bekle.
  useEffect(() => {
    if (authLoading) return;
    fetchCoupons().then((res) => {
      setCoupons(res.coupons);
      setLoading(false);
    });
  }, [authLoading, user]);

  async function handleCopy(c: Coupon) {
    await Clipboard.setStringAsync(c.code);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 1500);
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={[styles.flex, { backgroundColor: scrim }]}>
        <PageHeader title="Kuponlarım" subtitle="Sadece online ödemelerde geçerlidir" />
        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} color={theme.tint} />
        ) : (
          <FlatList
            data={coupons}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <CouponTicket coupon={item} cardBg={cardBg} notchBg={theme.background} copied={copiedId === item.id} onCopy={() => handleCopy(item)} />
            )}
            ListEmptyComponent={
              <View style={[surface.card, surface.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
                <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name="ticket-percent-outline" size={30} color={theme.tint} />
                </View>
                <ThemedText style={styles.emptyTitle}>Kullanılabilir kuponun yok</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.emptyText}>
                  {user ? 'Yeni kuponlar tanımlandığında burada göreceksin.' : 'Üyelere özel kuponları görmek için giriş yap.'}
                </ThemedText>
                {!user && <PrimaryButton label="Giriş Yap" onPress={() => router.push('/giris')} />}
              </View>
            }
          />
        )}
      </View>
    </Screen>
  );
}

/** Bilet görünümlü kupon: solda indirim bölümü, kesikli ayraç ve yanlarda bilet kesikleri. */
function CouponTicket({
  coupon,
  cardBg,
  notchBg,
  copied,
  onCopy,
}: {
  coupon: Coupon;
  cardBg: string;
  notchBg: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const theme = useTheme();
  const personal = !!coupon.assigned_user_ids?.length;
  const amount = coupon.discount_amount ? `₺${coupon.discount_amount.toFixed(0)}` : `%${coupon.discount_percent}`;

  return (
    <View style={[styles.ticket, surface.shadow, { backgroundColor: cardBg }]}>
      <View style={[styles.stub, { backgroundColor: theme.tint }]}>
        <ThemedText style={styles.stubAmount}>{amount}</ThemedText>
        <ThemedText style={styles.stubLabel}>İNDİRİM</ThemedText>
      </View>
      {/* Bilet kesikleri + kesikli ayraç */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchTop, { backgroundColor: notchBg }]} />
        <View style={[styles.dash, { borderColor: withAlpha(theme.text, 0.2) }]} />
        <View style={[styles.notch, styles.notchBottom, { backgroundColor: notchBg }]} />
      </View>

      <View style={styles.info}>
        {personal && (
          <View style={[styles.personalPill, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
            <MaterialCommunityIcons name="star-circle" size={13} color={theme.tint} />
            <ThemedText style={[styles.personalText, { color: theme.tint }]}>Sana özel</ThemedText>
          </View>
        )}
        <ThemedText style={styles.title} numberOfLines={2}>{coupon.title}</ThemedText>
        {!!coupon.description && (
          <ThemedText themeColor="textSecondary" style={styles.meta} numberOfLines={2}>{coupon.description}</ThemedText>
        )}
        {!!coupon.min_amount && (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="cart-outline" size={14} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.meta}>En az ₺{formatMoney(coupon.min_amount)} alışveriş</ThemedText>
          </View>
        )}
        {!!coupon.valid_until && (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.meta}>Son kullanma: {formatValidUntil(coupon.valid_until)}</ThemedText>
          </View>
        )}
        <Pressable
          onPress={onCopy}
          accessibilityLabel={`${coupon.code} kodunu kopyala`}
          style={({ pressed }) => [
            styles.codeBox,
            { borderColor: withAlpha(theme.tint, 0.6), backgroundColor: withAlpha(theme.tint, copied ? 0.16 : 0.06), opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <ThemedText style={[styles.codeText, { color: theme.text }]}>{coupon.code}</ThemedText>
          <View style={styles.copyRow}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={theme.tint} />
            <ThemedText style={[styles.copyText, { color: theme.tint }]}>{copied ? 'Kopyalandı' : 'Kopyala'}</ThemedText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.three },
  emptyCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five },
  emptyTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900', marginTop: Spacing.two, textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 19, textAlign: 'center', paddingHorizontal: Spacing.two, marginBottom: Spacing.two },
  ticket: { flexDirection: 'row', borderRadius: 22 },
  stub: { width: 96, alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: 22, borderBottomLeftRadius: 22, paddingVertical: Spacing.three },
  stubAmount: { color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -0.5 },
  stubLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 10.5, lineHeight: 13, fontWeight: '900', letterSpacing: 1.2 },
  perforation: { width: 16, alignItems: 'center', marginLeft: -8, zIndex: 1 },
  notch: { position: 'absolute', width: 16, height: 16, borderRadius: 8 },
  notchTop: { top: -8 },
  notchBottom: { bottom: -8 },
  dash: { flex: 1, width: 0, borderLeftWidth: 1.5, borderStyle: 'dashed', marginVertical: 12 },
  info: { flex: 1, padding: Spacing.three, paddingLeft: Spacing.two, gap: 5 },
  personalPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  personalText: { fontSize: 11.5, lineHeight: 14, fontWeight: '900' },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 12.5, lineHeight: 17 },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingHorizontal: Spacing.two + 2, height: 40, marginTop: 4,
  },
  codeText: { fontSize: 14, lineHeight: 18, fontWeight: '900', letterSpacing: 1.2 },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { fontSize: 12, lineHeight: 15, fontWeight: '900' },
});
