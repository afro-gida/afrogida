import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { formatMoney } from '@/lib/format';
import { fetchOrder } from '@/lib/orders';
import { clearPendingPayment, loadPendingPayment } from '@/lib/pending-payment';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Order } from '@/lib/types';

const POLL_MS = 3000;
// PayTR müşteriyi "başarısız" adresine gönderdiyse ama sunucuya bildirimi
// (callback) bu süre içinde gelmediyse ret kabul edilir.
const FAIL_REDIRECT_GRACE_MS = 15_000;
// Onay bu süreden uzun gecikirse müşteriye seçenek gösterilir (bekleme sürer).
const SLOW_MS = 60_000;

/**
 * Online ödeme bekleme ekranı. PayTR ödeme bitince müşteriyi buraya döndürür
 * (?sonuc=tamam|hata, bkz. backend services/payments.py::payment_return_urls).
 * Ödemenin kesin sonucu PayTR'ın sunucuya gönderdiği imzalı bildirimdir; bu
 * ekran sipariş ödeme durumunu yoklayıp:
 *  - onaylandıysa  -> sepeti temizler, sipariş takip ekranına gider;
 *  - reddedildiyse -> ödeme öncesi saklanan sepeti geri yükler, sepete döner.
 */
export default function PaymentWaitScreen() {
  const { tx, sonuc } = useLocalSearchParams<{ tx: string; sonuc?: string }>();
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { restore, clear } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [slow, setSlow] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (authLoading || !user || !tx) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = Date.now();

    async function goRejected() {
      const p = await loadPendingPayment(tx);
      await clearPendingPayment();
      if (p) {
        restore(p.marketId, p.lines, p.deliveryType);
        router.replace({ pathname: '/pazar/[id]/sepet', params: { id: p.marketId, odeme: 'red' } });
      } else {
        // Sepet yedeği yoksa (başka cihaz / temizlenmiş) takip ekranı sonucu gösterir.
        router.replace({ pathname: '/siparis/[tx]', params: { tx, odeme: 'hata' } });
      }
    }

    async function tick() {
      const res = await fetchOrder(tx);
      if (stopped || done.current) return;
      const o = res.order;
      if (o) {
        setOrder(o);
        if (o.payment_method !== 'online_card' || o.payment_status === 'paid') {
          done.current = true;
          await clearPendingPayment();
          clear();
          router.replace({ pathname: '/siparis/[tx]', params: { tx, odeme: 'tamam' } });
          return;
        }
        if (o.payment_status === 'failed' || (sonuc === 'hata' && Date.now() - start > FAIL_REDIRECT_GRACE_MS)) {
          done.current = true;
          await goRejected();
          return;
        }
      }
      if (Date.now() - start > SLOW_MS) setSlow(true);
      timer = setTimeout(tick, POLL_MS);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, tx, sonuc]);

  const cardBg = isDark ? '#0e1411' : '#f8ebd6';

  return (
    <Screen>
      <View style={styles.center}>
        <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
          <PulseIcon />
          <ThemedText style={styles.title}>{slow ? 'Banka yanıtı gecikiyor' : 'Ödemen kontrol ediliyor'}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.text}>
            {slow
              ? 'Bankadan henüz kesin yanıt gelmedi. Beklemeye devam ediyoruz; sonuç gelince seni otomatik yönlendireceğiz.'
              : 'Bankadan onay bekleniyor. Birkaç saniye sürebilir, lütfen bu ekranı kapatma.'}
          </ThemedText>

          {!!order && (
            <View style={[styles.amountPill, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
              <Ionicons name="card-outline" size={15} color={theme.tint} />
              <ThemedText style={[styles.amountText, { color: theme.tint }]}>{formatMoney(order.amount)} ₺</ThemedText>
            </View>
          )}
          <ThemedText themeColor="textSecondary" style={styles.txText}>Sipariş #{tx}</ThemedText>

          {slow && (
            <Pressable
              onPress={() => router.replace({ pathname: '/siparis/[tx]', params: { tx } })}
              style={({ pressed }) => [styles.btn, { borderColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}
            >
              <ThemedText style={[styles.btnText, { color: theme.tint }]}>Siparişi Görüntüle</ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </Screen>
  );
}

/** Kart ikonu + dışa doğru yayılan halka (bekleme hissi). Hareketi azalt açıksa sabit. */
function PulseIcon() {
  const theme = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={styles.pulseWrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            backgroundColor: withAlpha(theme.tint, 0.25),
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.6] }) }],
          },
        ]}
      />
      <View style={[styles.pulseCore, { backgroundColor: theme.tint }]}>
        <Ionicons name="card" size={30} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: Spacing.three },
  card: { borderRadius: 26, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four, alignItems: 'center', gap: Spacing.two },
  shadow: { shadowColor: '#7a4a1c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 3 },
  pulseWrap: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  pulseRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40 },
  pulseCore: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.4, textAlign: 'center' },
  text: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  amountPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: Spacing.three, height: 34, marginTop: Spacing.two },
  amountText: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  txText: { fontSize: 12, lineHeight: 16 },
  btn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.four, height: 44, justifyContent: 'center', marginTop: Spacing.two },
  btnText: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
});
