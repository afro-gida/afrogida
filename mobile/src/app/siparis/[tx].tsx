import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { OrderStatusArt, orderStatusIcon } from '@/components/order-status-art';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchOrder } from '@/lib/orders';
import { formatMoney } from '@/lib/format';
import { formatQty, formatUnit } from '@/lib/units';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Order, OrderStatus } from '@/lib/types';

// Sipariş bitmediyse ekran açıkken durumu bu aralıkla yeniler.
const POLL_MS = 20_000;

type Step = { status: OrderStatus; label: string };

const STEPS_EVE: Step[] = [
  { status: 'talep_alindi', label: 'Sipariş Alındı' },
  { status: 'hazirlaniyor', label: 'Hazırlanıyor' },
  { status: 'hazir', label: 'Hazır' },
  { status: 'yolda', label: 'Yolda' },
  { status: 'teslim_edildi', label: 'Teslim Edildi' },
];
const STEPS_GEL_AL: Step[] = [
  { status: 'talep_alindi', label: 'Sipariş Alındı' },
  { status: 'hazirlaniyor', label: 'Hazırlanıyor' },
  { status: 'hazir', label: 'Teslim Almaya Hazır' },
  { status: 'teslim_edildi', label: 'Teslim Alındı' },
];

function stepIndex(steps: Step[], status: OrderStatus) {
  // "Hazırlık bekliyor" hâlâ ilk adımdadır.
  const s = status === 'hazirlik_bekliyor' ? 'talep_alindi' : status;
  return Math.max(0, steps.findIndex((x) => x.status === s));
}

function headline(o: Order): { title: string; text: string } {
  const eve = o.delivery_type === 'eve_servis';
  switch (o.order_status) {
    case 'talep_alindi':
      return { title: 'Sipariş Alındı', text: 'Siparişin bize ulaştı, pazardaki tezgahlara iletiliyor.' };
    case 'hazirlik_bekliyor':
      return { title: 'Hazırlık Bekliyor', text: 'Siparişin hazırlık sırasında, birazdan hazırlanmaya başlanacak.' };
    case 'hazirlaniyor':
      return { title: 'Hazırlanıyor', text: 'Ürünlerin tezgahlardan tek tek seçilip poşetleniyor.' };
    case 'hazir':
      return eve
        ? { title: 'Hazır', text: 'Poşetlerin paketlendi, kuryemize teslim ediliyor.' }
        : { title: 'Teslim Almaya Hazır', text: `Siparişin hazır! Pazardan teslim alabilirsin${o.pickup_time ? ` (${o.pickup_time})` : ''}.` };
    case 'yolda':
      return { title: 'Yolda', text: 'Kuryemiz yola çıktı. Kapıda SMS ile gelen teslimat kodunu kuryeye söylemeyi unutma.' };
    case 'teslim_edildi':
      return { title: eve ? 'Teslim Edildi' : 'Teslim Alındı', text: 'Afiyet olsun! Bizi tercih ettiğin için teşekkürler.' };
    default:
      return { title: 'İptal Edildi', text: o.cancel_reason ? `Sebep: ${o.cancel_reason}` : 'Bu sipariş iptal edildi.' };
  }
}

const PAYMENT_LABEL: Record<string, string> = {
  online_card: 'Online kart',
  pay_at_counter: 'Tezgahta ödeme',
  cash_on_delivery: 'Kapıda nakit',
};

/** "Online kart ile ödendi" sadece ödeme gerçekten alındıysa yazılır. */
function paymentLabel(o: Order) {
  const base = PAYMENT_LABEL[o.payment_method ?? ''] ?? o.payment_method ?? '';
  if (o.payment_method !== 'online_card') return base;
  if (o.payment_status === 'paid') return 'Online kart ile ödendi';
  if (o.payment_status === 'failed') return 'Online kart · ödeme alınamadı';
  return 'Online kart · ödeme bekleniyor';
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/**
 * Sipariş takip ekranı — Siparişlerim listesinde bir siparişe basınca ya da
 * sipariş verilince açılır. Üstte o anki durumun hareketli çizimi ve açıklaması,
 * altında adım adım durum çizgisi, en altta sipariş özeti.
 */
export default function OrderTrackingScreen() {
  // odeme: online ödemeden dönüşte PayTR'ın eklediği sonuç ("tamam" | "hata"),
  // bkz. backend services/payments.py::payment_return_urls.
  const { tx, odeme } = useLocalSearchParams<{ tx: string; odeme?: string }>();
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sayfa doğrudan açılınca (yenileme / bağlantı) oturum geri yüklenmeden
  // istek atılırsa "Yetkilendirme gerekli" dönüyordu -> oturumu bekle.
  const { user, loading: authLoading } = useAuth();

  const load = useCallback(async () => {
    if (!user) return null;
    const res = await fetchOrder(tx);
    if (res.order) setOrder(res.order);
    setError(res.error);
    setLoading(false);
    return res.order;
  }, [tx, user]);

  // Ekran açıkken, sipariş bitene kadar (teslim/iptal) düzenli yenile.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().then((o) => {
        if (!active || !o || o.order_status === 'teslim_edildi' || o.order_status === 'iptal_edildi') return;
        timer.current = setInterval(async () => {
          const next = await load();
          if (next && (next.order_status === 'teslim_edildi' || next.order_status === 'iptal_edildi') && timer.current) {
            clearInterval(timer.current);
          }
        }, POLL_MS);
      });
      return () => {
        active = false;
        if (timer.current) clearInterval(timer.current);
      };
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const cardBg = isDark ? '#0e1411' : '#f8ebd6';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}
          accessibilityLabel="Geri"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <View style={styles.flex}>
          <ThemedText style={styles.headerTitle}>Sipariş Takibi</ThemedText>
          {!!order && (
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
              #{order.tx_id}
            </ThemedText>
          )}
        </View>
      </View>

      {!authLoading && !user ? (
        <View style={[styles.card, styles.emptyCard, { backgroundColor: cardBg }]}>
          <Ionicons name="lock-closed-outline" size={36} color={theme.tint} />
          <ThemedText themeColor="textSecondary" style={styles.centerText}>Siparişini görmek için giriş yapmalısın.</ThemedText>
          <Pressable style={[styles.loginBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/giris')}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">Giriş Yap</ThemedText>
          </Pressable>
        </View>
      ) : loading ? (
        <ActivityIndicator style={styles.spinner} color={theme.tint} />
      ) : !order ? (
        <View style={[styles.card, styles.emptyCard, { backgroundColor: cardBg }]}>
          <Ionicons name="alert-circle-outline" size={36} color={theme.tint} />
          <ThemedText themeColor="textSecondary" style={styles.centerText}>{error ?? 'Sipariş bulunamadı.'}</ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} />}
        >
          <PaymentBanner order={order} returned={odeme} />
          {/* Ödemesi alınamayan sipariş işleme alınmaz: animasyon/durum çizgisi gösterilmez. */}
          {!paymentFailed(order, odeme) && <Hero order={order} cardBg={cardBg} />}
          {order.order_status !== 'iptal_edildi' && !paymentFailed(order, odeme) && <Timeline order={order} cardBg={cardBg} />}
          <Summary order={order} cardBg={cardBg} />
        </ScrollView>
      )}
    </Screen>
  );
}

/**
 * Online ödeme sonucu: PayTR'dan dönüşte (?odeme=tamam|hata) ya da sipariş
 * online ödemeli olup henüz ödenmemiş/ödenememişse gösterilir. Ödemenin kesin
 * sonucuna sunucuya gelen PayTR bildirimi karar verir; dönüşte bildirim birkaç
 * saniye gecikebilir -> "onaylanıyor" durumu, ekran kendini yeniledikçe güncellenir.
 */
function paymentFailed(order: Order, returned?: string) {
  return (
    order.payment_method === 'online_card' &&
    (order.payment_status === 'failed' || (returned === 'hata' && order.payment_status !== 'paid'))
  );
}

function PaymentBanner({ order, returned }: { order: Order; returned?: string }) {
  const theme = useTheme();
  const router = useRouter();
  if (order.payment_method !== 'online_card') return null;
  const status = order.payment_status;
  let tone: 'ok' | 'wait' | 'fail' | null = null;
  let title = '';
  let text = '';
  if (paymentFailed(order, returned)) {
    tone = 'fail';
    title = 'Ödeme tamamlanamadı';
    text = 'Ödeme alınamadığı için bu sipariş işleme alınmadı. Ürünleri tekrar sepete ekleyip yeniden deneyebilirsin.';
  } else if (status === 'paid') {
    if (returned !== 'tamam') return null;
    tone = 'ok';
    title = 'Ödemen alındı';
    text = 'Teşekkürler! Siparişin pazara iletildi, buradan adım adım takip edebilirsin.';
  } else {
    tone = 'wait';
    title = returned === 'tamam' ? 'Ödemen onaylanıyor' : 'Ödeme bekleniyor';
    text = returned === 'tamam'
      ? 'Bankadan onay bekleniyor, birkaç saniye içinde güncellenecek.'
      : 'Bu siparişin online ödemesi henüz tamamlanmadı.';
  }
  const color = tone === 'fail' ? theme.danger : theme.tint;
  const icon: keyof typeof Ionicons.glyphMap =
    tone === 'ok' ? 'checkmark-circle' : tone === 'fail' ? 'close-circle' : 'time';
  return (
    <View style={[styles.payBanner, { backgroundColor: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.35) }]}>
      <Ionicons name={icon} size={24} color={color} />
      <View style={[styles.flex, styles.payBannerBody]}>
        <ThemedText style={[styles.payBannerTitle, { color }]}>{title}</ThemedText>
        <ThemedText style={styles.payBannerText}>{text}</ThemedText>
        {tone === 'fail' && (
          <Pressable
            onPress={() => router.replace('/')}
            style={({ pressed }) => [styles.payBannerBtn, { backgroundColor: color, opacity: pressed ? 0.85 : 1 }]}
          >
            <ThemedText style={styles.payBannerBtnText}>Alışverişe Dön</ThemedText>
            <Ionicons name="arrow-forward" size={15} color="#fff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Üst kart: hareketli durum çizimi + yanında durum başlığı ve açıklaması. */
function Hero({ order, cardBg }: { order: Order; cardBg: string }) {
  const theme = useTheme();
  const { title, text } = headline(order);
  const cancelled = order.order_status === 'iptal_edildi';
  return (
    <View style={[styles.card, styles.shadow, styles.hero, { backgroundColor: cardBg }]}>
      <View style={[styles.heroArt, { backgroundColor: withAlpha(cancelled ? theme.danger : theme.tint, 0.1) }]}>
        <OrderStatusArt status={order.order_status} deliveryType={order.delivery_type} size={112} />
      </View>
      <View style={styles.heroText}>
        <ThemedText style={[styles.heroTitle, { color: cancelled ? theme.danger : theme.text }]}>{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.heroBody}>{text}</ThemedText>
        <View style={[styles.typePill, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
          <Ionicons name={order.delivery_type === 'eve_servis' ? 'bicycle-outline' : 'bag-handle-outline'} size={13} color={theme.tint} />
          <ThemedText style={[styles.typePillText, { color: theme.tint }]}>
            {order.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

/** Adım adım durum çizgisi: geçmiş adımlar ✓, şimdiki adım vurgulu, gelecek soluk. */
function Timeline({ order, cardBg }: { order: Order; cardBg: string }) {
  const theme = useTheme();
  const steps = order.delivery_type === 'eve_servis' ? STEPS_EVE : STEPS_GEL_AL;
  const current = stepIndex(steps, order.order_status);
  const done = order.order_status === 'teslim_edildi';

  return (
    <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
      {steps.map((s, i) => {
        const past = i < current || (done && i === current);
        const now = i === current && !done;
        const future = i > current;
        const color = future ? withAlpha(theme.text, 0.3) : theme.tint;
        const time = i === 0 ? formatDateTime(order.created_at) : s.status === 'teslim_edildi' && done ? formatDateTime(order.delivered_at) : '';
        return (
          <View key={s.status} style={styles.stepRow}>
            <View style={styles.stepRail}>
              <View
                style={[
                  styles.stepIcon,
                  {
                    backgroundColor: now ? theme.tint : past ? withAlpha(theme.tint, 0.16) : 'transparent',
                    borderColor: color,
                  },
                ]}
              >
                <MaterialCommunityIcons name={orderStatusIcon(s.status, order.delivery_type)} size={20} color={now ? '#fff' : color} />
                {past && (
                  <View style={[styles.stepCheck, { backgroundColor: theme.tint, borderColor: cardBg }]}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
              </View>
              {i < steps.length - 1 && (
                <View style={[styles.stepLine, { backgroundColor: i < current ? theme.tint : withAlpha(theme.text, 0.15) }]} />
              )}
            </View>
            <View style={styles.stepText}>
              <ThemedText style={[styles.stepLabel, { color: future ? withAlpha(theme.text, 0.4) : theme.text }]}>{s.label}</ThemedText>
              {now && <ThemedText style={[styles.stepNow, { color: theme.tint }]}>Şu an</ThemedText>}
              {!!time && <ThemedText themeColor="textSecondary" style={styles.stepTime}>{time}</ThemedText>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Sipariş özeti: ürünler, tutar dökümü, ödeme ve teslimat bilgisi. */
function Summary({ order, cardBg }: { order: Order; cardBg: string }) {
  const theme = useTheme();
  const slot =
    order.delivery_type === 'eve_servis'
      ? order.delivery_slot_start && order.delivery_slot_end
        ? `${order.delivery_slot_start}-${order.delivery_slot_end}`
        : 'En kısa sürede'
      : order.pickup_time || 'En kısa sürede';
  const addressLine = order.delivery_type === 'eve_servis' ? (order.address ?? '').split('\n')[0] : '';

  return (
    <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
      <ThemedText style={styles.sectionTitle}>Sipariş Özeti</ThemedText>

      {order.items.map((it, i) => (
        <View key={i} style={styles.itemRow}>
          <View style={[styles.itemQty, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
            <ThemedText style={[styles.itemQtyText, { color: theme.tint }]}>
              {formatQty(it.qty, it.unit)} {formatUnit(it.unit).toLowerCase()}
            </ThemedText>
          </View>
          <View style={styles.flex}>
            <ThemedText style={styles.itemName} numberOfLines={2}>{it.name}</ThemedText>
            {!!it.selected_options?.length && (
              <ThemedText themeColor="textSecondary" style={styles.itemOpts} numberOfLines={2}>
                {it.selected_options.map((o) => `${o.title}: ${o.label}`).join(' · ')}
              </ThemedText>
            )}
          </View>
          {it.line_total != null && <ThemedText style={styles.itemPrice}>{formatMoney(it.line_total)} ₺</ThemedText>}
        </View>
      ))}

      <View style={[styles.divider, { backgroundColor: withAlpha(theme.text, 0.1) }]} />

      {order.subtotal != null && <MoneyRow label="Ara toplam" value={order.subtotal} />}
      {order.delivery_type === 'eve_servis' && order.delivery_fee != null && (
        <MoneyRow label="Teslimat" value={order.delivery_fee} free={order.delivery_fee === 0} />
      )}
      {!!order.discount && <MoneyRow label="Kupon indirimi" value={-order.discount} accent />}
      <View style={styles.totalRow}>
        <ThemedText style={styles.totalLabel}>Toplam</ThemedText>
        <ThemedText style={[styles.totalValue, { color: theme.tint }]}>{formatMoney(order.amount)} ₺</ThemedText>
      </View>

      <View style={[styles.divider, { backgroundColor: withAlpha(theme.text, 0.1) }]} />

      {!!order.market_name && <InfoRow icon="storefront-outline" text={order.market_name} />}
      <InfoRow icon="time-outline" text={`${order.delivery_type === 'eve_servis' ? 'Teslimat' : 'Teslim alma'}: ${slot}`} />
      {!!addressLine && <InfoRow icon="location-outline" text={addressLine} />}
      {!!order.payment_method && <InfoRow icon="card-outline" text={paymentLabel(order)} />}
    </View>
  );
}

function MoneyRow({ label, value, free, accent }: { label: string; value: number; free?: boolean; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.moneyRow}>
      <ThemedText themeColor="textSecondary" style={styles.moneyLabel}>{label}</ThemedText>
      <ThemedText style={[styles.moneyValue, (free || accent) && { color: theme.tint }]}>
        {free ? 'Ücretsiz' : `${value < 0 ? '−' : ''}${formatMoney(Math.abs(value))} ₺`}
      </ThemedText>
    </View>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={theme.tint} />
      <ThemedText style={styles.infoText} numberOfLines={2}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  backBtn: { padding: Spacing.one },
  headerTitle: { fontSize: 21, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3 },
  spinner: { marginTop: Spacing.five },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  card: { borderRadius: 22, padding: Spacing.three },
  shadow: { shadowColor: '#7a4a1c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 3 },
  emptyCard: { margin: Spacing.three, alignItems: 'center', gap: Spacing.two },
  centerText: { textAlign: 'center' },
  loginBtn: { borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, marginTop: Spacing.one },
  // Ödeme sonucu bandı
  payBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, borderRadius: 18, borderWidth: 1, padding: Spacing.three - 2 },
  payBannerTitle: { fontSize: 15, lineHeight: 19, fontWeight: '900' },
  payBannerText: { fontSize: 13, lineHeight: 17 },
  payBannerBody: { gap: 2 },
  payBannerBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: Spacing.three, height: 36, marginTop: Spacing.two,
  },
  payBannerBtnText: { color: '#fff', fontSize: 13, lineHeight: 16, fontWeight: '800' },
  // Üst kart
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroArt: { borderRadius: 20, padding: 4, overflow: 'hidden' },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.4 },
  heroBody: { fontSize: 13, lineHeight: 18 },
  typePill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3, marginTop: 4,
  },
  typePillText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  // Durum çizgisi
  stepRow: { flexDirection: 'row', gap: Spacing.three },
  stepRail: { alignItems: 'center', width: 40 },
  stepIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepCheck: {
    position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 8, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  stepLine: { width: 2, flex: 1, minHeight: 18, marginVertical: 3, borderRadius: 1 },
  stepText: { flex: 1, paddingTop: 2, paddingBottom: Spacing.three },
  stepLabel: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  stepNow: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  stepTime: { fontSize: 12, lineHeight: 15 },
  // Özet
  sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800', marginBottom: Spacing.two },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: 6 },
  itemQty: { minWidth: 58, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, alignItems: 'center' },
  itemQtyText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  itemName: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  itemOpts: { fontSize: 12, lineHeight: 15 },
  itemPrice: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  divider: { height: 1, marginVertical: Spacing.two },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  moneyLabel: { fontSize: 14, lineHeight: 18 },
  moneyValue: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
  totalLabel: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  totalValue: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.3 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 3 },
  infoText: { flex: 1, fontSize: 13, lineHeight: 17 },
});
