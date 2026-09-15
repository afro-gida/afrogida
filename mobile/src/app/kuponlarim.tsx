import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchCoupons, type Coupon } from '@/lib/coupons';
import { IconGreen, Spacing, withAlpha } from '@/constants/theme';

const CARD_BG_DARK = 'rgba(0, 0, 0, 0.4)';
const CARD_BG_LIGHT = 'rgba(255, 255, 255, 0.4)';

function formatValidUntil(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('tr-TR');
}

export default function MyCouponsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const cardBg = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;
  const router = useRouter();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchCoupons().then((res) => {
      setCoupons(res.coupons);
      setLoading(false);
    });
  }, []);

  async function handleCopy(c: Coupon) {
    await Clipboard.setStringAsync(c.code);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 1500);
  }

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ThemedText style={styles.backArrow}>←</ThemedText>
        </Pressable>
        <View style={styles.flex}>
          <ThemedText type="subtitle">İndirim Kuponları</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Sadece online ödemelerde geçerlidir</ThemedText>
        </View>
        <View style={[styles.logoBadge, { backgroundColor: withAlpha('#14B67E', 0.2), borderColor: theme.tint }]}>
          <Ionicons name="leaf" size={20} color={IconGreen} />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} color={theme.tint} />
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const personal = !!item.assigned_user_ids?.length;
            return (
              <View style={[styles.ticket, { borderColor: theme.tint, backgroundColor: cardBg }]}>
                <View style={[styles.discountBlock, { backgroundColor: theme.tint }]}>
                  <ThemedText style={styles.discountAmount}>
                    {item.discount_amount ? `₺${item.discount_amount.toFixed(0)}` : `%${item.discount_percent}`}
                  </ThemedText>
                  <ThemedText style={styles.discountLabel}>indirim</ThemedText>
                </View>
                <View style={[styles.infoBlock, { borderColor: theme.border }]}>
                  {personal && (
                    <View style={[styles.personalBadge, { borderColor: theme.tint }]}>
                      <ThemedText themeColor="tint" type="small" style={{ fontWeight: '700' }}>★ Size Özel</ThemedText>
                    </View>
                  )}
                  <ThemedText type="smallBold" style={styles.couponTitle}>{item.title}</ThemedText>
                  {!!item.min_amount && (
                    <View style={styles.rowLine}>
                      <Ionicons name="cart-outline" size={14} color={theme.textSecondary} />
                      <ThemedText themeColor="textSecondary" type="small">
                        En az ₺{item.min_amount.toFixed(0)} alışveriş
                      </ThemedText>
                    </View>
                  )}
                  <Pressable
                    onPress={() => handleCopy(item)}
                    style={[styles.codeBox, { borderColor: theme.border, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.6)' }]}
                  >
                    <ThemedText type="smallBold" style={styles.codeText}>{item.code}</ThemedText>
                    <Ionicons name={copiedId === item.id ? 'checkmark' : 'copy-outline'} size={16} color={theme.tint} />
                  </Pressable>
                  {!!item.valid_until && (
                    <ThemedText themeColor="textSecondary" type="small">
                      Son geçerlilik: {formatValidUntil(item.valid_until)}
                    </ThemedText>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="pricetag-outline" size={36} color={IconGreen} />
              <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
                Kullanılabilir kuponun yok.
              </ThemedText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  logoBadge: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  ticket: { flexDirection: 'row', borderRadius: 16, borderWidth: 1.5, overflow: 'hidden' },
  discountBlock: { width: 90, alignItems: 'center', justifyContent: 'center', padding: Spacing.two },
  discountAmount: { color: '#fff', fontSize: 24, fontWeight: '800' },
  discountLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  infoBlock: { flex: 1, borderLeftWidth: 1.5, borderStyle: 'dashed', padding: Spacing.three, gap: 6 },
  personalBadge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1.5, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  couponTitle: { fontSize: 16 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2,
  },
  codeText: { letterSpacing: 1 },
  emptyBox: {
    borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.two, padding: Spacing.five, marginTop: Spacing.four,
  },
});
