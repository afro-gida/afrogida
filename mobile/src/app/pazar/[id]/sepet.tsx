import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useMarkets } from '@/lib/markets-context';
import { createOrder, type DeliveryType, type PaymentMethod } from '@/lib/orders';
import { fetchSettings, type StoreSettings } from '@/lib/settings';
import { Spacing, withAlpha } from '@/constants/theme';
import type { CartLine } from '@/lib/types';

// Gerçek sitede sabit metin olarak duran Gel-Al saati — DESIGN-BRIEF.md'de
// belirtildiği gibi bu bir ayar değil, sabit bir bilgi metni (bkz. index.tsx
// üründe kullanılan "Gel-Al: 11:00-19:00" satırı ile aynı kaynak).
const GEL_AL_SAATI = '11:00-19:00';

export default function CartScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { lines, setQty, removeItem, clear } = useCart();
  const { markets } = useMarkets();
  const market = markets.find((m) => m.id === id);
  const [settings, setSettings] = useState<StoreSettings>({});
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('gel_al');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pay_at_counter');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  // Eve Servis sadece bu pazar destekliyorsa seçilebilir olsun.
  const eveServisAvailable = !!(market?.delivery_enabled && market?.active_eve_servis);

  useEffect(() => {
    if (deliveryType === 'eve_servis' && !eveServisAvailable) setDeliveryType('gel_al');
  }, [eveServisAvailable, deliveryType]);

  const priceFor = (line: CartLine) =>
    (deliveryType === 'eve_servis' ? line.product.eve_servis_price : line.product.gel_al_price) ?? 0;

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.qty * priceFor(l), 0), [lines, deliveryType]);
  const deliveryFee =
    deliveryType === 'eve_servis' && settings.delivery_fee && !(settings.free_delivery_min_amount && subtotal >= settings.free_delivery_min_amount)
      ? settings.delivery_fee
      : 0;
  const total = subtotal + deliveryFee;

  async function handleCheckout() {
    if (!user) {
      router.push('/giris');
      return;
    }
    if (deliveryType === 'eve_servis' && !address.trim()) {
      setError('Eve servis için adres girmelisin.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await createOrder(
      lines.map((l) => ({ id: l.product.id, qty: l.qty })),
      { deliveryType, paymentMethod, address: deliveryType === 'eve_servis' ? address.trim() : undefined }
    );
    setSubmitting(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if (paymentMethod === 'online_card' && result.payment_url) {
      // Kart bilgisi bizim uygulamadan geçmiyor — PayTR'nin kendi ödeme
      // sayfasına yönlendiriyoruz (bkz. lib/orders.ts açıklaması).
      clear();
      if (Platform.OS === 'web') {
        window.location.href = result.payment_url;
      } else {
        await Linking.openURL(result.payment_url);
        router.push(`/pazar/${id}/siparislerim`);
      }
      return;
    }
    clear();
    router.push(`/pazar/${id}/siparislerim`);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Sepetim</ThemedText>
      </View>

      {lines.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={{ fontSize: 40 }}>🛒</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Sepetin boş. Ürünlere göz atarak alışverişe başlayabilirsin.
          </ThemedText>
        </View>
      ) : (
        <>
          <FlatList
            style={styles.flex}
            data={lines}
            keyExtractor={(l) => l.product.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }: { item: CartLine }) => (
              <View style={[styles.line, { backgroundColor: withAlpha(theme.backgroundElement, 0.72), borderColor: theme.tint }]}>
                <View style={styles.lineInfo}>
                  <ThemedText type="smallBold">{item.product.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {priceFor(item)} ₺ / {item.product.unit}
                  </ThemedText>
                </View>
                <View style={styles.qtyRow}>
                  <Pressable
                    style={[styles.qtyBtn, { borderColor: theme.tint, backgroundColor: withAlpha(theme.tint, 0.12) }]}
                    onPress={() => setQty(item.product.id, item.qty - 1)}
                  >
                    <ThemedText themeColor="tint">−</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.qtyValue}>{item.qty}</ThemedText>
                  <Pressable
                    style={[styles.qtyBtn, { borderColor: theme.tint, backgroundColor: withAlpha(theme.tint, 0.12) }]}
                    onPress={() => setQty(item.product.id, item.qty + 1)}
                  >
                    <ThemedText themeColor="tint">+</ThemedText>
                  </Pressable>
                </View>
                <Pressable onPress={() => removeItem(item.product.id)}>
                  <ThemedText themeColor="danger" type="small">
                    Kaldır
                  </ThemedText>
                </Pressable>
              </View>
            )}
          />

          {/* Teslimat türü */}
          <View style={styles.sectionBlock}>
            <ThemedText type="smallBold" style={styles.sectionLabel}>🚗 Teslimat Türü</ThemedText>
            <View style={styles.toggleRow}>
              <ToggleBtn label="Pazardan Gel-Al" active={deliveryType === 'gel_al'} onPress={() => setDeliveryType('gel_al')} />
              <ToggleBtn
                label="Eve Servis"
                active={deliveryType === 'eve_servis'}
                disabled={!eveServisAvailable}
                onPress={() => eveServisAvailable && setDeliveryType('eve_servis')}
              />
            </View>
            {deliveryType === 'eve_servis' && (
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Adres (mahalle, sokak, kapı no...)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.addressInput, { borderColor: theme.tint, color: theme.text, backgroundColor: withAlpha(theme.backgroundElement, 0.72) }]}
              />
            )}
          </View>

          {/* Ödeme yöntemi */}
          <View style={styles.sectionBlock}>
            <ThemedText type="smallBold" style={styles.sectionLabel}>💳 Ödeme Yöntemi</ThemedText>
            <View style={styles.toggleRow}>
              <ToggleBtn label="Tezgahta Nakit/Pos" active={paymentMethod === 'pay_at_counter'} onPress={() => setPaymentMethod('pay_at_counter')} />
              <ToggleBtn label="Online Kredi Kartı" active={paymentMethod === 'online_card'} onPress={() => setPaymentMethod('online_card')} />
            </View>
          </View>

          {/* Özet kartı: hedef sitedeki "Ara Toplam / Gel-Al Saati / Toplam"
              dökümü — bkz. gönderilen ekran görüntüsü. */}
          <View style={[styles.summaryCard, { borderColor: theme.tint, backgroundColor: withAlpha(theme.backgroundElement, 0.72) }]}>
            <View style={styles.summaryRow}>
              <ThemedText themeColor="textSecondary" type="small">Ara Toplam</ThemedText>
              <ThemedText type="smallBold">{subtotal.toFixed(2)} ₺</ThemedText>
            </View>
            {deliveryType === 'eve_servis' && (
              <View style={styles.summaryRow}>
                <ThemedText themeColor="textSecondary" type="small">Teslimat Ücreti</ThemedText>
                <ThemedText type="smallBold">{deliveryFee > 0 ? `${deliveryFee.toFixed(2)} ₺` : 'Ücretsiz'}</ThemedText>
              </View>
            )}
            <View style={styles.summaryRow}>
              <ThemedText themeColor="textSecondary" type="small">
                {deliveryType === 'eve_servis' ? 'Teslimat Saati' : 'Gel-Al Saati'}
              </ThemedText>
              <ThemedText type="smallBold">{GEL_AL_SAATI}</ThemedText>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: theme.tint }]} />
            <View style={styles.summaryRow}>
              <ThemedText type="subtitle">Toplam</ThemedText>
              <ThemedText type="subtitle" themeColor="tint">{total.toFixed(2)} ₺</ThemedText>
            </View>
          </View>

          {/* Teslim alma bilgisi: sabit/açıklayıcı metin, ayara bağlı değil. */}
          <View style={[styles.infoCard, { borderColor: theme.border, backgroundColor: withAlpha(theme.backgroundElement, 0.72) }]}>
            <ThemedText type="smallBold">
              {deliveryType === 'eve_servis' ? '🚚 Teslimat Bilgisi' : '🏪 Teslim Alma Bilgisi'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" style={{ marginTop: 4 }}>
              {deliveryType === 'eve_servis'
                ? 'Ürünleriniz belirttiğiniz adrese teslim edilecektir.'
                : 'Ürünleriniz Afro Gıda tezgahından teslim alınacaktır. Ödeme teslimat sırasında yapılabilir.'}
            </ThemedText>
          </View>

          <View style={styles.footer}>
            {!user && (
              <ThemedText themeColor="textSecondary" type="small">
                Sipariş verebilmek için giriş yapmalısın.
              </ThemedText>
            )}
            {error && (
              <ThemedText themeColor="danger" type="small">
                {error}
              </ThemedText>
            )}
            <Pressable
              // Hedef sitede "Sipariş Oluştur" butonu temadan bağımsız her
              // zaman yeşil — bkz. DESIGN-BRIEF.md 4. madde.
              style={[styles.checkoutBtn, { backgroundColor: '#14B67E' }]}
              onPress={handleCheckout}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText style={{ color: '#fff' }} type="smallBold">
                  {!user
                    ? 'Giriş Yap ve Devam Et'
                    : paymentMethod === 'online_card'
                      ? 'Siparişi Ver ve Ödemeye Geç'
                      : `Siparişi Ver (${deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} · Tezgahta Ödeme)`}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

function ToggleBtn({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.toggleBtn,
        {
          borderColor: theme.tint,
          backgroundColor: active ? theme.tint : withAlpha(theme.backgroundElement, 0.6),
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  emptyWrap: {
    marginHorizontal: Spacing.three, marginTop: Spacing.five, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five,
  },
  emptyText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.two },
  lineInfo: { flex: 1, gap: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  sectionBlock: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, gap: Spacing.one },
  sectionLabel: { marginBottom: 2 },
  toggleRow: { flexDirection: 'row', gap: Spacing.two },
  toggleBtn: { flex: 1, borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  addressInput: { borderRadius: 12, borderWidth: 1, padding: Spacing.two, marginTop: Spacing.one },
  summaryCard: {
    borderRadius: 16, borderWidth: 1.5, margin: Spacing.three, marginTop: 0,
    padding: Spacing.three, gap: Spacing.two,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryDivider: { height: 1, opacity: 0.3 },
  infoCard: {
    borderRadius: 16, borderWidth: 1, marginHorizontal: Spacing.three, marginBottom: Spacing.two,
    padding: Spacing.three,
  },
  // Sepet ekranı normal akışta durur, yüzen (position: absolute) sekme
  // çubuğunun ARKASINDA kalabileceği için altına o kadar boşluk ekliyoruz.
  footer: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.six + Spacing.three,
    gap: Spacing.two,
  },
  checkoutBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
