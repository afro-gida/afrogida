import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { orderStatusIcon } from '@/components/order-status-art';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { fetchOrders } from '@/lib/orders';
import { formatMoney } from '@/lib/format';
import { CARD_BG, SCRIM, surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Order, OrderStatus } from '@/lib/types';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

const STATUS_LABEL: Record<OrderStatus, string> = {
  talep_alindi: 'Sipariş Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};

// Aktif siparişin ilerlemesi (takip ekranındaki adımlarla aynı sıra).
const STEP_EVE: OrderStatus[] = ['talep_alindi', 'hazirlaniyor', 'hazir', 'yolda', 'teslim_edildi'];
const STEP_GEL_AL: OrderStatus[] = ['talep_alindi', 'hazirlaniyor', 'hazir', 'teslim_edildi'];

function paymentFailed(o: Order) {
  return o.payment_method === 'online_card' && o.payment_status === 'failed';
}

function isActive(o: Order) {
  return !paymentFailed(o) && o.order_status !== 'teslim_edildi' && o.order_status !== 'iptal_edildi';
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function OrdersScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardBg = isDark ? CARD_BG.dark : CARD_BG.light;

  const load = useCallback(async () => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }
    const res = await fetchOrders();
    setOrders(res.orders);
    setError(res.error);
    setLoading(false);
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const sections = useMemo(() => {
    const active = orders.filter(isActive);
    const past = orders.filter((o) => !isActive(o));
    return [
      ...(active.length ? [{ key: 'active', title: 'Aktif siparişler', data: active }] : []),
      ...(past.length ? [{ key: 'past', title: 'Geçmiş', data: past }] : []),
    ];
  }, [orders]);

  const header = (
    <View style={styles.header}>
      <View style={styles.flex}>
        <ThemedText style={surface.title}>Siparişlerim</ThemedText>
        {orders.length > 0 && (
          <ThemedText themeColor="textSecondary" style={surface.subtitle}>{orders.length} sipariş</ThemedText>
        )}
      </View>
      <Image source={isDark ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT} style={styles.logoBadge} resizeMode="contain" />
    </View>
  );

  return (
    <Screen>
      <View style={[styles.flex, { backgroundColor: isDark ? SCRIM.dark : SCRIM.light }]}>
        {!authLoading && !user ? (
          <View style={styles.pad}>
            {header}
            <EmptyCard
              icon="lock-outline"
              title="Giriş yapmalısın"
              text="Siparişlerini görmek ve takip etmek için giriş yap."
              button="Giriş Yap"
              onPress={() => router.push('/giris')}
              cardBg={cardBg}
            />
          </View>
        ) : loading ? (
          <View style={styles.pad}>
            {header}
            <ActivityIndicator style={styles.spinner} color={theme.tint} />
          </View>
        ) : (
          <SectionList
            style={styles.flex}
            sections={sections}
            keyExtractor={(o) => o.tx_id}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            ListHeaderComponent={header}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} />}
            renderSectionHeader={({ section }) => (
              <ThemedText themeColor="textSecondary" style={styles.sectionLabel}>{section.title.toLocaleUpperCase('tr-TR')}</ThemedText>
            )}
            renderItem={({ item }) => (
              <OrderCard order={item} cardBg={cardBg} onPress={() => router.push({ pathname: '/siparis/[tx]', params: { tx: item.tx_id } })} />
            )}
            ListEmptyComponent={
              <EmptyCard
                icon="receipt-text-outline"
                title={error ? 'Siparişler yüklenemedi' : 'Henüz siparişin yok'}
                text={error ?? 'Pazardaki taze ürünlere göz atıp ilk siparişini verebilirsin.'}
                button={error ? 'Tekrar Dene' : 'Alışverişe Başla'}
                onPress={() => (error ? onRefresh() : router.push(`/pazar/${id}`))}
                cardBg={cardBg}
              />
            }
          />
        )}
      </View>
    </Screen>
  );
}

/** Sipariş kartı. Aktif siparişte ilerleme çubuğu, geçmişte sade. */
function OrderCard({ order, cardBg, onPress }: { order: Order; cardBg: string; onPress: () => void }) {
  const theme = useTheme();
  const failed = paymentFailed(order);
  const cancelled = order.order_status === 'iptal_edildi';
  const bad = failed || cancelled;
  const active = isActive(order);
  const color = bad ? theme.danger : theme.tint;
  const steps = order.delivery_type === 'eve_servis' ? STEP_EVE : STEP_GEL_AL;
  const status = order.order_status === 'hazirlik_bekliyor' ? 'talep_alindi' : order.order_status;
  const stepIdx = Math.max(0, steps.indexOf(status));
  // Online ödemesi henüz onaylanmamış sipariş pazara iletilmedi — "Sipariş Alındı" değil.
  const awaitingPayment = order.payment_method === 'online_card' && order.payment_status === 'pending';
  const label = failed
    ? 'Ödeme Alınamadı'
    : awaitingPayment
      ? 'Ödeme Bekleniyor'
      : STATUS_LABEL[order.order_status] ?? order.order_status;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${order.tx_id} siparişini takip et`}
      style={({ pressed }) => [surface.card, surface.shadow, styles.card, { backgroundColor: cardBg, opacity: pressed ? 0.88 : 1 }]}
    >
      <View style={styles.cardTop}>
        <View style={[surface.iconCircle, { backgroundColor: withAlpha(color, 0.14) }]}>
          <MaterialCommunityIcons
            name={failed ? 'credit-card-off-outline' : awaitingPayment ? 'credit-card-clock-outline' : orderStatusIcon(order.order_status, order.delivery_type)}
            size={20}
            color={color}
          />
        </View>
        <View style={styles.flex}>
          <ThemedText style={[styles.status, bad && { color: theme.danger }]}>{label}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.meta}>
            {formatDate(order.created_at)} · {order.delivery_type === 'gel_al' ? 'Gel-Al' : 'Eve Servis'}
          </ThemedText>
        </View>
        <View style={styles.amountCol}>
          <ThemedText style={styles.amount}>{formatMoney(order.amount)} ₺</ThemedText>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </View>
      </View>

      {active && !awaitingPayment && (
        <View style={styles.progressRow}>
          {steps.map((s, i) => (
            <View
              key={s}
              style={[styles.progressSeg, { backgroundColor: i <= stepIdx ? theme.tint : withAlpha(theme.text, 0.12) }]}
            />
          ))}
          <ThemedText style={[styles.progressText, { color: theme.tint }]}>{stepIdx + 1}/{steps.length}</ThemedText>
        </View>
      )}

      {/* Ürün listesi yerine siparişin pazarı (ürünler sipariş detayında) */}
      {!!order.market_name && (
        <View style={styles.marketRow}>
          <Ionicons name="storefront-outline" size={14} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={styles.items} numberOfLines={1}>{order.market_name}</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

function EmptyCard({
  icon,
  title,
  text,
  button,
  onPress,
  cardBg,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  text: string;
  button: string;
  onPress: () => void;
  cardBg: string;
}) {
  const theme = useTheme();
  return (
    <View style={[surface.card, surface.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
      <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
        <MaterialCommunityIcons name={icon} size={30} color={theme.tint} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.emptyText}>{text}</ThemedText>
      <Pressable onPress={onPress} style={({ pressed }) => [surface.primaryBtn, styles.emptyBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.88 : 1 }]}>
        <ThemedText style={surface.primaryBtnText}>{button}</ThemedText>
        <Ionicons name="arrow-forward" size={17} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.one },
  logoBadge: { width: 48, height: 48 },
  spinner: { marginTop: Spacing.five },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six + Spacing.five },
  sectionLabel: { marginTop: Spacing.three, marginBottom: Spacing.two, marginLeft: 4, fontSize: 12, lineHeight: 15, fontWeight: '800', letterSpacing: 0.8 },
  card: { gap: Spacing.two + 2, marginBottom: Spacing.three - 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4 },
  status: { fontSize: 15.5, lineHeight: 19, fontWeight: '900' },
  meta: { fontSize: 12.5, lineHeight: 16, marginTop: 1 },
  amountCol: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  amount: { fontSize: 15.5, lineHeight: 19, fontWeight: '900' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  progressSeg: { flex: 1, height: 5, borderRadius: 3 },
  progressText: { fontSize: 11.5, lineHeight: 14, fontWeight: '900', marginLeft: 4 },
  items: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  marketRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, marginTop: Spacing.three },
  emptyTitle: { fontSize: 19, lineHeight: 23, fontWeight: '900', marginTop: Spacing.two, textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 19, textAlign: 'center', paddingHorizontal: Spacing.two },
  emptyBtn: { marginTop: Spacing.three, height: 48 },
});
