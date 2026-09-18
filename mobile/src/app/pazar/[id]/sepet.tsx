import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CheckboxRow } from '@/components/checkbox-row';
import { ProductOptionsModal } from '@/components/product-options-modal';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useMarkets } from '@/lib/markets-context';
import { createOrder, type PaymentMethod } from '@/lib/orders';
import { fetchSettings, type StoreSettings } from '@/lib/settings';
import { fetchAddresses, addressServesMarket, type Address } from '@/lib/addresses';
import { fetchCoupons, validateCoupon, type Coupon, type CouponValidation } from '@/lib/coupons';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { IconGreen, Spacing, withAlpha } from '@/constants/theme';
import type { CartLine } from '@/lib/types';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

type TimeSlot = { start: string; end: string };

/** "11:00-19:00" gibi bir çalışma saati aralığını 1 saatlik dilimlere böler
 *  (Yemeksepeti/Getir tarzı "Planla" listesi için — kullanıcı talimatı). */
function generateTimeSlots(range: string | undefined, stepMinutes = 60): TimeSlot[] {
  const m = (range ?? '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return [];
  const toMinutes = (h: string, mm: string) => Number(h) * 60 + Number(mm);
  const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startM = toMinutes(m[1], m[2]);
  const endM = toMinutes(m[3], m[4]);
  const slots: TimeSlot[] = [];
  for (let t = startM; t + stepMinutes <= endM; t += stepMinutes) {
    slots.push({ start: toHHMM(t), end: toHHMM(t + stepMinutes) });
  }
  return slots;
}

function formatAddressLine(a: Address) {
  const parts = [
    [a.neighborhood, a.street].filter(Boolean).join(' '),
    a.building_no ? `No:${a.building_no}` : '',
    a.floor ? `K:${a.floor}` : '',
    a.apartment_no ? `D:${a.apartment_no}` : '',
  ].filter(Boolean);
  return `${parts.join(' ')}, ${[a.district, a.city].filter(Boolean).join('/')}`.trim();
}

// Kartlar dolu yeşil kutu değil, ŞEFFAF — sadece ince yeşil çerçeve
// (kullanıcı talimatı, bkz. referans görsel). Nötr, çok hafif bir karartma/
// aydınlatma dışında zemin neredeyse tamamen saydam.
const CARD_BG_DARK = 'rgba(0, 0, 0, 0.18)';
const CARD_BG_LIGHT = 'rgba(255, 255, 255, 0.35)';

export default function CartScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const cardBg = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { lines, setQty, updateLine, removeItem, clear, deliveryType, setDeliveryType } = useCart();
  // Bir sepet satırına basılınca (ürünün özelleştirmesi varsa) seçim ekranı
  // mevcut seçimle önceden doldurulmuş şekilde açılır (kullanıcı talimatı).
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const { markets } = useMarkets();
  const market = markets.find((m) => m.id === id);
  const [settings, setSettings] = useState<StoreSettings>({});
  // Ürün listesi açılışta gizli — "Ürünleri Göster" ile açılıyor.
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pay_at_counter');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponModalOpen, setCouponModalOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidation | null>(null);
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [noRing, setNoRing] = useState(false);
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sözleşme onayı ve teslimat tercihleri, teslimat türü değişince sıfırlanır.
  useEffect(() => {
    setAgreementAccepted(false);
  }, [deliveryType]);

  // "Kapıya bırak" sadece online ödemede geçerli — ödeme yöntemi değişince tutarsız kalmasın.
  useEffect(() => {
    if (paymentMethod !== 'online_card') setLeaveAtDoor(false);
  }, [paymentMethod]);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  // useEffect DEĞİL useFocusEffect: kullanıcı /adreslerim'de yeni adres
  // ekleyip sepete geri döndüğünde bu ekran yeniden mount olmuyor (sekme
  // navigasyonu) — sadece [user]'a bağlı bir useEffect bu durumda YENİ
  // adresi hiç çekmiyordu (kullanıcı talimatıyla bulunan hata).
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      fetchAddresses().then((res) => {
        setAddresses(res.addresses);
        setSelectedAddressId((prev) => {
          if (prev && res.addresses.some((a) => a.id === prev)) return prev;
          const def = res.addresses.find((a) => a.is_default) ?? res.addresses[0];
          return def ? def.id : null;
        });
      });
    }, [user])
  );

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null;

  // Eve Servis sadece bu pazar destekliyorsa seçilebilir olsun.
  const eveServisAvailable = !!(market?.delivery_enabled && market?.active_eve_servis);

  useEffect(() => {
    if (deliveryType === 'eve_servis' && !eveServisAvailable) setDeliveryType('gel_al');
  }, [eveServisAvailable, deliveryType]);

  const hoursRange = deliveryType === 'eve_servis' ? settings.delivery_order_hours : settings.pickup_order_hours;
  const timeSlots = useMemo(() => generateTimeSlots(hoursRange ?? '11:00-19:00'), [hoursRange]);

  // Teslimat türü değişince o türe ait saat aralığı farklı olabileceğinden
  // seçili dilimi sıfırlıyoruz — "Şimdi"ye dönüyor.
  useEffect(() => {
    setSelectedSlot(null);
    setScheduleOpen(false);
  }, [deliveryType]);

  // Tek fiyat sistemi: Gel-Al/Eve Servis ayrımı yok, aynı fiyat her ikisinde
  // de geçerli (kullanıcı talimatı).
  const priceFor = (line: CartLine) => {
    const base = line.product.gel_al_price ?? 0;
    const delta = (line.selectedOptions ?? []).reduce((sum, o) => sum + (o.price_delta || 0), 0);
    return base + delta;
  };

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.qty * priceFor(l), 0), [lines, deliveryType]);
  const deliveryFee =
    deliveryType === 'eve_servis' && settings.delivery_fee && !(settings.free_delivery_min_amount && subtotal >= settings.free_delivery_min_amount)
      ? settings.delivery_fee
      : 0;
  const couponDiscount = appliedCoupon?.discount ?? 0;
  const total = Math.max(0, subtotal + deliveryFee - couponDiscount);

  // Sepet tutarı, uygulanan kuponun minimum tutarının altına düşerse kuponu
  // otomatik kaldır (sunucu zaten reddeder, burada önceden bildiriyoruz).
  useEffect(() => {
    if (appliedCoupon && subtotal < appliedCoupon.min_amount) {
      setAppliedCoupon(null);
      setCouponError('Sepet tutarı azaldığı için kupon kaldırıldı.');
    }
  }, [subtotal, appliedCoupon]);

  async function openCouponPicker() {
    setCouponError(null);
    setCouponModalOpen(true);
    if (coupons.length === 0) {
      setCouponsLoading(true);
      const res = await fetchCoupons();
      setCoupons(res.coupons);
      setCouponsLoading(false);
    }
  }

  async function applyCoupon(c: Coupon) {
    setCouponModalOpen(false);
    setCouponError(null);
    setCouponApplying(true);
    const res = await validateCoupon(c.code, subtotal, paymentMethod);
    setCouponApplying(false);
    if ('error' in res) {
      setCouponError(res.error);
      return;
    }
    setAppliedCoupon(res.result);
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponError(null);
  }

  // Minimum sepet tutarı: Gel-Al ve Eve Servis'in ayrı ayrı ayarları var.
  const minAmount = deliveryType === 'eve_servis' ? settings.min_delivery_amount : settings.min_pickup_amount;
  const belowMinimum = !!(minAmount && subtotal < minAmount);
  const remainingForMinimum = belowMinimum ? minAmount! - subtotal : 0;

  // Ücretsiz teslimata kaç TL kaldığı (sadece Eve Servis'te, halihazırda
  // teslimat ücreti alınıyorsa anlamlı).
  const remainingForFreeDelivery =
    deliveryType === 'eve_servis' && deliveryFee > 0 && settings.free_delivery_min_amount && subtotal < settings.free_delivery_min_amount
      ? settings.free_delivery_min_amount - subtotal
      : 0;

  // Panelden ayarlanan tutarın üzerinde nakit/tezgah ödemesi kapalı, sadece
  // online ödeme kabul ediliyor (bkz. backend/services/orders.py) — backend
  // zaten bunu reddediyor, burada önceden gösterip ödeme yöntemini online'a
  // kilitliyoruz.
  const cashLimitExceeded = !!(settings.cash_payment_limit_enabled && settings.cash_payment_max_amount && total > settings.cash_payment_max_amount);

  useEffect(() => {
    if (cashLimitExceeded && paymentMethod === 'pay_at_counter') setPaymentMethod('online_card');
  }, [cashLimitExceeded, paymentMethod]);

  // Koşullar tamamlanmadıysa "Sipariş Oluştur" butonu sönük/pasif görünür
  // (kullanıcı talimatı) — giriş yapılmamışsa bu kural işlemiyor, buton
  // her zaman aktif kalıp /giris'e yönlendiriyor.
  const canSubmit =
    !user ||
    (!submitting &&
      !belowMinimum &&
      agreementAccepted &&
      (deliveryType !== 'eve_servis' || (!!selectedAddress && addressServesMarket(selectedAddress, market?.delivery_neighborhoods))));

  async function handleCheckout() {
    if (!user) {
      router.push('/giris');
      return;
    }
    if (deliveryType === 'eve_servis') {
      if (!selectedAddress) {
        setError('Önce bir teslimat adresi seç veya ekle.');
        return;
      }
      if (!addressServesMarket(selectedAddress, market?.delivery_neighborhoods)) {
        setError('Bu pazar, seçtiğin adresin mahallesine eve servis vermiyor. Başka bir adres seç.');
        return;
      }
    }
    if (belowMinimum) {
      setError(`Minimum sepet tutarına ulaşman için sepetine ${remainingForMinimum.toFixed(2)} ₺ daha eklemen gerekiyor.`);
      return;
    }
    if (!agreementAccepted) {
      setError('Devam etmek için mesafeli satış sözleşmesini kabul etmelisin.');
      return;
    }
    setError(null);
    setSubmitting(true);
    let address: string | undefined;
    if (deliveryType === 'eve_servis' && selectedAddress) {
      const prefLines = [
        noRing ? 'Kurye zili çalmasın' : '',
        leaveAtDoor && paymentMethod === 'online_card' ? 'Kapıya bırakılsın' : '',
        deliveryNote.trim() ? `Not: ${deliveryNote.trim()}` : '',
      ].filter(Boolean);
      address = [formatAddressLine(selectedAddress), ...prefLines].join('\n');
    }
    const result = await createOrder(
      lines.map((l) => ({
        id: l.product.id,
        qty: l.qty,
        selected_options: l.selectedOptions?.map((o) => ({ title: o.title, label: o.label })),
      })),
      {
        deliveryType,
        paymentMethod,
        address,
        pickupTime: deliveryType === 'gel_al' && selectedSlot ? `${selectedSlot.start}-${selectedSlot.end}` : undefined,
        deliverySlotStart: deliveryType === 'eve_servis' && selectedSlot ? selectedSlot.start : undefined,
        deliverySlotEnd: deliveryType === 'eve_servis' && selectedSlot ? selectedSlot.end : undefined,
        couponCode: appliedCoupon?.code,
        agreementsAccepted: agreementAccepted,
        legalDocumentType: deliveryType === 'eve_servis' ? 'home_delivery' : 'pickup',
      }
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
        <ThemedText type="subtitle" style={styles.flex}>Sepetim</ThemedText>
        {lines.length > 0 && (
          <Pressable
            onPress={clear}
            style={[styles.resetBtn, { borderColor: theme.danger, backgroundColor: withAlpha(theme.danger, 0.12) }]}
          >
            <Ionicons name="trash-outline" size={16} color={theme.danger} />
            <ThemedText themeColor="danger" type="small" style={styles.resetBtnText}>
              Sıfırla
            </ThemedText>
          </Pressable>
        )}
        <Image
          source={scheme === 'dark' ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT}
          style={styles.logoBadge}
          resizeMode="contain"
        />
      </View>

      {lines.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="cart-outline" size={60} color={IconGreen} />
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Sepetin boş. Ürünlere göz atarak alışverişe başlayabilirsin.
          </ThemedText>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
          {/* Ürün listesi kartı — açılışta gizli, "Ürünleri Göster" ile açılır. */}
          <View style={[styles.productsCard, { borderColor: theme.tint, backgroundColor: cardBg }]}>
            <View style={styles.productsSummaryRow}>
              <View>
                <ThemedText type="smallBold">Sepetim</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  {lines.length} çeşit ürün · {subtotal.toFixed(2)} ₺
                </ThemedText>
              </View>
              <Pressable onPress={() => setProductsExpanded((v) => !v)} style={styles.toggleProductsBtn}>
                <ThemedText themeColor="tint" type="small" style={styles.toggleProductsText}>
                  {productsExpanded ? 'Ürünleri Gizle' : 'Ürünleri Göster'}
                </ThemedText>
                <Ionicons name={productsExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tint} />
              </Pressable>
            </View>

            {productsExpanded && (
              <View style={styles.productsList}>
                {lines.map((item) => (
                  <View key={item.lineId} style={[styles.line, { borderColor: theme.border }]}>
                    <Pressable
                      style={styles.lineInfo}
                      disabled={!item.product.customization_options?.length}
                      onPress={() => setEditingLine(item)}
                    >
                      <ThemedText type="smallBold">{item.product.name}</ThemedText>
                      {!!item.selectedOptions?.length && (
                        <ThemedText themeColor="tint" type="small">
                          Seçili: {item.selectedOptions.map((o) => o.label).join(', ')}
                        </ThemedText>
                      )}
                      <ThemedText themeColor="textSecondary" type="small">
                        {formatQty(item.qty, item.product.unit)} {formatUnit(item.product.unit)} x {priceFor(item).toFixed(2)} ₺
                      </ThemedText>
                    </Pressable>
                    <View style={styles.qtyRow}>
                      <Pressable
                        style={[styles.qtyBtn, { borderColor: theme.tint, backgroundColor: withAlpha(theme.tint, 0.12) }]}
                        onPress={() => setQty(item.lineId, item.qty - qtyStep(item.product.unit))}
                      >
                        <ThemedText themeColor="tint">−</ThemedText>
                      </Pressable>
                      <ThemedText style={styles.qtyValue}>{formatQty(item.qty, item.product.unit)}</ThemedText>
                      <Pressable
                        style={[styles.qtyBtn, { borderColor: theme.tint, backgroundColor: withAlpha(theme.tint, 0.12) }]}
                        onPress={() => setQty(item.lineId, item.qty + qtyStep(item.product.unit))}
                      >
                        <ThemedText themeColor="tint">+</ThemedText>
                      </Pressable>
                    </View>
                    <ThemedText type="smallBold" themeColor="tint" style={styles.lineTotal}>
                      {(item.qty * priceFor(item)).toFixed(2)} ₺
                    </ThemedText>
                    <Pressable onPress={() => removeItem(item.lineId)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={theme.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Teslimat türü */}
          <View style={styles.sectionBlock}>
            <View style={styles.labelRow}>
              <Ionicons name="car-outline" size={23} color={IconGreen} />
              <ThemedText type="smallBold">Teslimat Türü</ThemedText>
            </View>
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
              <View style={{ marginTop: Spacing.one }}>
                <View style={styles.addressHeaderRow}>
                  <View style={styles.labelRow}>
                    <Ionicons name="location-outline" size={21} color={IconGreen} />
                    <ThemedText type="small" themeColor="textSecondary">Teslimat Adresi</ThemedText>
                  </View>
                  <Pressable onPress={() => router.push('/adreslerim')}>
                    <ThemedText themeColor="tint" type="small" style={{ fontWeight: '700' }}>
                      Yönet
                    </ThemedText>
                  </Pressable>
                </View>

                {addresses.length === 0 ? (
                  <Pressable
                    onPress={() => router.push('/adreslerim')}
                    style={[styles.addAddressBtn, { borderColor: theme.tint }]}
                  >
                    <Ionicons name="add" size={16} color={theme.tint} />
                    <ThemedText themeColor="tint" type="small" style={{ fontWeight: '700' }}>
                      Adres Ekle
                    </ThemedText>
                  </Pressable>
                ) : (
                  <>
                    <View style={styles.addressChipsRow}>
                      {addresses.map((a) => {
                        const active = a.id === selectedAddressId;
                        const served = addressServesMarket(a, market?.delivery_neighborhoods);
                        return (
                          <Pressable
                            key={a.id}
                            onPress={() => setSelectedAddressId(a.id)}
                            style={[
                              styles.addressChip,
                              { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint : cardBg },
                            ]}
                          >
                            <Ionicons name="home-outline" size={14} color={active ? '#fff' : theme.text} />
                            <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                              {a.title}
                            </ThemedText>
                            {!served && (
                              <ThemedText themeColor="danger" type="small" style={{ fontWeight: '700' }}>
                                Servis yok
                              </ThemedText>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                    {selectedAddress && (
                      <ThemedText themeColor="textSecondary" type="small" style={{ marginTop: 4 }}>
                        {formatAddressLine(selectedAddress)}
                      </ThemedText>
                    )}
                  </>
                )}

                {!!market?.delivery_neighborhoods?.length && (
                  <View style={[styles.neighborhoodsBox, { borderColor: theme.tint, backgroundColor: cardBg }]}>
                    <View style={styles.labelRow}>
                      <Ionicons name="location-outline" size={16} color={IconGreen} />
                      <ThemedText type="small" themeColor="tint" style={{ fontWeight: '700' }}>
                        Eve servis verilen mahalleler
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 2 }}>
                      {market.delivery_neighborhoods.join(', ')}
                    </ThemedText>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Ödeme yöntemi */}
          <View style={styles.sectionBlock}>
            <View style={styles.labelRow}>
              <Ionicons name="card-outline" size={23} color={IconGreen} />
              <ThemedText type="smallBold">Ödeme Yöntemi</ThemedText>
            </View>
            <View style={styles.toggleRow}>
              <ToggleBtn
                label={deliveryType === 'eve_servis' ? 'Kapıda Ödeme' : 'Tezgahta Nakit/Pos'}
                active={paymentMethod === 'pay_at_counter'}
                disabled={cashLimitExceeded}
                onPress={() => setPaymentMethod('pay_at_counter')}
              />
              <ToggleBtn label="Online Kredi Kartı" active={paymentMethod === 'online_card'} onPress={() => setPaymentMethod('online_card')} />
            </View>
            {cashLimitExceeded ? (
              <ThemedText type="small" themeColor="tint" style={{ marginTop: 4, fontWeight: '700' }}>
                Kapıda Nakit / Tezgahta Nakit/Pos Limiti{'\n'}
                <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '400' }}>
                  {settings.cash_payment_max_amount?.toFixed(0)} TL ve üzeri alışverişlerde sadece online ödeme geçerlidir.
                </ThemedText>
              </ThemedText>
            ) : (
              deliveryType === 'eve_servis' &&
              paymentMethod === 'pay_at_counter' && (
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 4 }}>
                  Kapıda sadece nakit geçerlidir.
                </ThemedText>
              )
            )}
          </View>

          {/* Kupon kullan */}
          <View style={styles.sectionBlock}>
            <View style={styles.labelRow}>
              <Ionicons name="pricetag-outline" size={23} color={IconGreen} />
              <ThemedText type="smallBold">Kupon Kullan</ThemedText>
            </View>
            <View style={[styles.couponBox, { borderColor: theme.tint, backgroundColor: cardBg }]}>
              {couponApplying ? (
                <ActivityIndicator color={theme.tint} />
              ) : appliedCoupon ? (
                <>
                  <Ionicons name="pricetag" size={16} color={IconGreen} />
                  <View style={styles.flex}>
                    <ThemedText type="small" style={{ fontWeight: '700' }}>{appliedCoupon.title}</ThemedText>
                    <ThemedText type="small" themeColor="tint">{appliedCoupon.discount.toFixed(2)} ₺ indirim uygulandı</ThemedText>
                  </View>
                  <Pressable onPress={removeCoupon} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={theme.danger} />
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={openCouponPicker} style={styles.couponRowPressable}>
                  <Ionicons name="gift-outline" size={16} color={IconGreen} />
                  <ThemedText type="small" style={styles.flex}>İndirim Kuponu Seç</ThemedText>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
            {couponError && (
              <ThemedText themeColor="danger" type="small" style={{ marginTop: 4 }}>
                {couponError}
              </ThemedText>
            )}
          </View>

          {/* Özet kartı: hedef sitedeki "Ara Toplam / Gel-Al Saati / Toplam"
              dökümü — bkz. gönderilen ekran görüntüsü. */}
          <View style={[styles.summaryCard, { borderColor: theme.tint, backgroundColor: cardBg }]}>
            <View style={styles.summaryRow}>
              <ThemedText themeColor="textSecondary" type="small" style={styles.summaryText}>Ara Toplam</ThemedText>
              <ThemedText type="smallBold" style={styles.summaryText}>{subtotal.toFixed(2)} ₺</ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <ThemedText themeColor="textSecondary" type="small" style={styles.summaryText}>
                {deliveryType === 'eve_servis' ? 'Teslimat Saati' : 'Gel-Al Saati'}
              </ThemedText>
              <Pressable onPress={() => setScheduleOpen((v) => !v)} style={styles.timeValueRow} hitSlop={6}>
                <ThemedText type="smallBold" style={[styles.summaryText, { color: '#fff' }]}>
                  {selectedSlot ? `${selectedSlot.start}-${selectedSlot.end}` : 'Şimdi'}
                </ThemedText>
                <Ionicons name={scheduleOpen ? 'chevron-up' : 'chevron-down'} size={12} color={theme.tint} />
              </Pressable>
            </View>
            {scheduleOpen && (
              <View style={styles.slotsWrap}>
                <Pressable
                  onPress={() => {
                    setSelectedSlot(null);
                    setScheduleOpen(false);
                  }}
                  style={[
                    styles.slotChip,
                    { borderColor: !selectedSlot ? theme.tint : theme.border, backgroundColor: !selectedSlot ? theme.tint : cardBg },
                  ]}
                >
                  <ThemedText type="small" style={{ color: !selectedSlot ? '#fff' : theme.text, fontWeight: '600' }}>
                    Şimdi
                  </ThemedText>
                </Pressable>
                {timeSlots.map((s) => {
                  const active = selectedSlot?.start === s.start;
                  return (
                    <Pressable
                      key={s.start}
                      onPress={() => {
                        setSelectedSlot(s);
                        setScheduleOpen(false);
                      }}
                      style={[styles.slotChip, { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint : cardBg }]}
                    >
                      <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                        {s.start}-{s.end}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {belowMinimum && (
              <>
                <View style={styles.summaryRow}>
                  <ThemedText themeColor="tint" type="small" style={[styles.summaryText, { fontWeight: '700' }]}>Minimum Sipariş Tutarı</ThemedText>
                  <ThemedText themeColor="tint" type="smallBold" style={styles.summaryText}>{minAmount!.toFixed(2)} ₺</ThemedText>
                </View>
                <View style={styles.summaryRow}>
                  <ThemedText themeColor="tint" type="small" style={[styles.summaryText, { fontWeight: '700' }]}>Kalan Tutar</ThemedText>
                  <ThemedText themeColor="tint" type="smallBold" style={styles.summaryText}>{remainingForMinimum.toFixed(2)} ₺</ThemedText>
                </View>
              </>
            )}
            {!belowMinimum && remainingForFreeDelivery > 0 && (
              <ThemedText themeColor="tint" type="small" style={[styles.summaryText, { fontWeight: '700', marginBottom: 2 }]}>
                Ücretsiz teslimata ulaşmak için {remainingForFreeDelivery.toFixed(2)} TL daha ekle.
              </ThemedText>
            )}
            {deliveryType === 'eve_servis' && (
              <View style={styles.summaryRow}>
                <ThemedText themeColor="textSecondary" type="small" style={styles.summaryText}>Teslimat</ThemedText>
                <ThemedText type="smallBold" style={styles.summaryText}>{deliveryFee > 0 ? `${deliveryFee.toFixed(2)} ₺` : 'Ücretsiz'}</ThemedText>
              </View>
            )}
            {couponDiscount > 0 && (
              <View style={styles.summaryRow}>
                <ThemedText themeColor="tint" type="small" style={[styles.summaryText, { fontWeight: '700' }]}>İndirim ({appliedCoupon!.code})</ThemedText>
                <ThemedText themeColor="tint" type="smallBold" style={styles.summaryText}>−{couponDiscount.toFixed(2)} ₺</ThemedText>
              </View>
            )}
            <View style={[styles.summaryDivider, { backgroundColor: theme.tint }]} />
            <View style={styles.summaryRow}>
              <ThemedText type="smallBold" style={styles.summaryTotalText}>Toplam</ThemedText>
              <ThemedText type="smallBold" themeColor="tint" style={styles.summaryTotalText}>{total.toFixed(2)} ₺</ThemedText>
            </View>
          </View>

          {/* Teslim alma bilgisi: sabit/açıklayıcı metin, ayara bağlı değil. */}
          <View style={[styles.infoCard, { borderColor: theme.border, backgroundColor: withAlpha(theme.backgroundElement, 0.72) }]}>
            <View style={styles.labelRow}>
              <Ionicons name={deliveryType === 'eve_servis' ? 'bicycle-outline' : 'storefront-outline'} size={23} color={IconGreen} />
              <ThemedText type="smallBold">
                {deliveryType === 'eve_servis' ? 'Teslimat Bilgisi' : 'Teslim Alma Bilgisi'}
              </ThemedText>
            </View>
            <ThemedText themeColor="textSecondary" type="small" style={{ marginTop: 4 }}>
              {deliveryType === 'eve_servis'
                ? 'Ürünleriniz belirttiğiniz adrese teslim edilecektir.'
                : 'Ürünleriniz Afro Gıda tezgahından teslim alınacaktır. Ödeme teslimat sırasında yapılabilir.'}
            </ThemedText>
          </View>

          {/* Teslimat tercihleri: sadece Eve Servis'te anlamlı. */}
          {deliveryType === 'eve_servis' && (
            <View style={[styles.prefsCard, { borderColor: theme.border, backgroundColor: withAlpha(theme.backgroundElement, 0.72) }]}>
              <View style={styles.labelRow}>
                <Ionicons name="cube-outline" size={23} color={IconGreen} />
                <ThemedText type="smallBold">Teslimat Tercihleri</ThemedText>
              </View>
              <CheckboxRow checked={noRing} onToggle={() => setNoRing((v) => !v)}>
                Kurye zili çalmasın
              </CheckboxRow>
              <CheckboxRow checked={leaveAtDoor} onToggle={() => setLeaveAtDoor((v) => !v)} disabled={paymentMethod !== 'online_card'}>
                Kapıya bırak{'\n'}
                <ThemedText type="small" themeColor="textSecondary">Sadece online ödemelerde geçerlidir.</ThemedText>
              </CheckboxRow>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Teslimat Notu</ThemedText>
              <TextInput
                value={deliveryNote}
                onChangeText={setDeliveryNote}
                placeholder="Örn: 3. kat, kapı kodu 1234, zil bozuk..."
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[
                  styles.noteInput,
                  { borderColor: theme.border, color: theme.text, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)' },
                ]}
              />
            </View>
          )}

          <View style={styles.footer}>
            <ThemedText type="smallBold">Sipariş Tamamlama</ThemedText>
            <ThemedText themeColor="textSecondary" type="small" style={{ marginBottom: 4 }}>
              {deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} siparişini tamamlamak için aşağıdaki belgeleri inceleyin.
            </ThemedText>
            <View style={[styles.agreementBox, { borderColor: theme.border }]}>
              <CheckboxRow checked={agreementAccepted} onToggle={() => setAgreementAccepted((v) => !v)}>
                <ThemedText type="small" themeColor="tint" style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
                  {deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} Mesafeli Satış Sözleşmesi
                </ThemedText>
                {"'ni okudum ve kabul ediyorum."}
              </CheckboxRow>
            </View>

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
              style={[
                styles.completeBtn,
                { backgroundColor: canSubmit ? '#14B67E' : withAlpha('#14B67E', 0.35) },
              ]}
              onPress={handleCheckout}
              disabled={!canSubmit}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <ThemedText style={styles.completeBtnText} numberOfLines={1} type="smallBold">
                    {!user
                      ? 'Giriş Yap ve Devam Et'
                      : paymentMethod === 'online_card'
                        ? 'Güvenli Ödemeye Geç'
                        : `${deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} Siparişi Oluştur`}
                  </ThemedText>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </Pressable>
            {belowMinimum && (
              <ThemedText themeColor="tint" type="small" style={{ textAlign: 'center', fontWeight: '700' }}>
                Minimum sipariş tutarına ulaşmak için {remainingForMinimum.toFixed(2)} ₺ daha ürün eklemelisiniz.
              </ThemedText>
            )}
          </View>
        </ScrollView>
      )}

      <CouponPickerModal
        visible={couponModalOpen}
        coupons={coupons}
        loading={couponsLoading}
        onClose={() => setCouponModalOpen(false)}
        onSelect={applyCoupon}
      />

      <ProductOptionsModal
        product={editingLine?.product ?? null}
        initialQty={editingLine?.qty}
        initialSelectedOptions={editingLine?.selectedOptions}
        confirmLabel="Güncelle"
        onConfirm={(qty, selectedOptions) => {
          if (editingLine) updateLine(editingLine.lineId, editingLine.product, qty, selectedOptions);
        }}
        onClose={() => setEditingLine(null)}
      />
    </Screen>
  );
}

function CouponPickerModal({
  visible,
  coupons,
  loading,
  onClose,
  onSelect,
}: {
  visible: boolean;
  coupons: Coupon[];
  loading: boolean;
  onClose: () => void;
  onSelect: (c: Coupon) => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const cardBg = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modalSheet, { backgroundColor: scheme === 'dark' ? '#0d1210' : '#fff', borderColor: theme.tint }]}>
        <View style={styles.modalHeaderRow}>
          <ThemedText type="subtitle" style={styles.flex}>Kuponlarım</ThemedText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.four }} />
        ) : coupons.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={{ marginTop: Spacing.three, textAlign: 'center' }}>
            Kullanılabilir kuponun yok.
          </ThemedText>
        ) : (
          <ScrollView contentContainerStyle={{ gap: Spacing.two, paddingBottom: Spacing.four }}>
            {coupons.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => onSelect(c)}
                style={[styles.couponListItem, { borderColor: theme.border, backgroundColor: cardBg }]}
              >
                <Ionicons name="pricetag-outline" size={20} color={IconGreen} />
                <View style={styles.flex}>
                  <ThemedText type="smallBold">{c.title}</ThemedText>
                  {!!c.description && (
                    <ThemedText type="small" themeColor="textSecondary">{c.description}</ThemedText>
                  )}
                  <ThemedText type="small" themeColor="tint">
                    {c.discount_amount ? `${c.discount_amount.toFixed(2)} ₺ indirim` : `%${c.discount_percent} indirim`}
                    {c.min_amount ? ` · min ${c.min_amount.toFixed(0)} ₺` : ''}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
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
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two,
  },
  logoBadge: { width: 60, height: 60 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 6,
  },
  resetBtnText: { fontWeight: '700' },
  scrollContent: { paddingBottom: Spacing.six + Spacing.three },
  emptyWrap: {
    marginHorizontal: Spacing.three, marginTop: Spacing.five, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five,
  },
  emptyText: { textAlign: 'center' },
  // Sepet ürün listesi kartı — açılışta özet halinde, "Ürünleri Göster" ile açılır.
  productsCard: {
    borderRadius: 16, borderWidth: 1.5, marginHorizontal: Spacing.three, marginBottom: Spacing.two,
    padding: Spacing.three, gap: Spacing.two,
  },
  productsSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleProductsBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  toggleProductsText: { fontWeight: '700' },
  productsList: { gap: Spacing.two },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.two },
  lineInfo: { flex: 1, gap: 2 },
  lineTotal: { marginRight: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  sectionBlock: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, gap: Spacing.one },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  toggleRow: { flexDirection: 'row', gap: Spacing.two },
  toggleBtn: { flex: 1, borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  addressInput: { borderRadius: 12, borderWidth: 1, padding: Spacing.two, marginTop: Spacing.one },
  addressHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  addAddressBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: Spacing.two,
  },
  neighborhoodsBox: { borderWidth: 1.5, borderRadius: 14, padding: Spacing.two, marginTop: Spacing.two },
  couponBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderWidth: 1.5, borderRadius: 14, padding: Spacing.two,
  },
  couponRowPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  couponListItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderWidth: 1, borderRadius: 14, padding: Spacing.two,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0,
    paddingVertical: Spacing.three, paddingHorizontal: Spacing.four,
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  timeValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryText: { fontSize: 13, lineHeight: 18 },
  summaryTotalText: { fontSize: 19, lineHeight: 23 },
  slotsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one, marginBottom: Spacing.one },
  slotChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6 },
  addressChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  addressChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6,
  },
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
  prefsCard: {
    borderRadius: 16, borderWidth: 1, marginHorizontal: Spacing.three, marginBottom: Spacing.two,
    padding: Spacing.three, gap: 2,
  },
  label: { marginTop: Spacing.one, marginBottom: 2 },
  noteInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two,
    fontSize: 14, minHeight: 60, textAlignVertical: 'top',
  },
  // Sepet ekranı normal akışta durur, yüzen (position: absolute) sekme
  // çubuğunun ARKASINDA kalabileceği için altına o kadar boşluk ekliyoruz.
  footer: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.six + Spacing.three,
    gap: Spacing.two,
  },
  agreementBox: { borderWidth: 1.5, borderRadius: 12, padding: Spacing.two },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  completeBtnText: { color: '#fff' },
});
