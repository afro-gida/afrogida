import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { CheckboxRow } from '@/components/checkbox-row';
import { isNoneLabel, ProductOptionsModal } from '@/components/product-options-modal';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { lineCampaignDiscount, lineTotal, useCart } from '@/lib/cart-context';
import { openLegal } from '@/lib/legal';
import { useMarkets } from '@/lib/markets-context';
import { createOrder, type PaymentMethod } from '@/lib/orders';
import { savePendingPayment } from '@/lib/pending-payment';
import { fetchSettings, withMarketSettings, type StoreSettings } from '@/lib/settings';
import { fetchAddresses, addressServesMarket, type Address } from '@/lib/addresses';
import { checkAtAddress } from '@/lib/location-check';
import { fetchCoupons, validateCoupon, type Coupon, type CouponValidation } from '@/lib/coupons';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { formatMoney } from '@/lib/format';
import { Spacing, withAlpha } from '@/constants/theme';
import type { CartLine } from '@/lib/types';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

type TimeSlot = { start: string; end: string };

/** Türkiye saatiyle gün içindeki dakika (cihaz saat dilimi farklı olsa da
 *  sunucunun kullandığı saatle aynı: backend/services/orders.py). */
function istanbulMinutes(d = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

const toHHMM = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** "11:00-19:00" aralığı + şimdiki saat -> şu an açık mı ve bugün kalan
 *  1 saatlik dilimler (başlamamış olanlar). Gece yarısını geçen aralık da olur. */
function scheduleFor(range: string | undefined, nowMin: number, stepMinutes = 60): { openNow: boolean; slots: TimeSlot[] } {
  const m = (range ?? '').match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return { openNow: true, slots: [] }; // saat tanımsız: sunucu da kısıtlamıyor
  const startM = Number(m[1]) * 60 + Number(m[2]);
  let endM = Number(m[3]) * 60 + Number(m[4]);
  if (endM <= startM) endM += 1440;
  const now = nowMin < startM && nowMin + 1440 <= endM ? nowMin + 1440 : nowMin;
  const openNow = now >= startM && now <= endM;
  const slots: TimeSlot[] = [];
  for (let t = startM; t + stepMinutes <= endM; t += stepMinutes) {
    if (t > now) slots.push({ start: toHHMM(t), end: toHHMM(t + stepMinutes) });
  }
  return { openNow, slots };
}

function formatAddressLine(a: Address) {
  // "Görükle" -> "Görükle Mah." (kurye okurken net olsun; sunucunun adres
  // metninden konum eşleştirmesi de "Mah." ekini arıyor)
  const neighborhood = a.neighborhood && !/\bmah/i.test(a.neighborhood) ? `${a.neighborhood} Mah.` : a.neighborhood;
  const parts = [
    [neighborhood, a.street].filter(Boolean).join(' '),
    a.building_no ? `No:${a.building_no}` : '',
    a.floor ? `K:${a.floor}` : '',
    a.apartment_no ? `D:${a.apartment_no}` : '',
  ].filter(Boolean);
  return `${parts.join(' ')}, ${[a.district, a.city].filter(Boolean).join('/')}`.trim();
}

// Premium tasarım (ürünler / takip ekranlarıyla aynı dil): çerçevesiz, dolu
// yüzeyli kartlar + sıcak hafif gölge; duvar kağıdının üstünde hafif perde.
const CARD_BG_DARK = '#0e1411';
const CARD_BG_LIGHT = '#f8ebd6';
const LIST_SCRIM_DARK = 'rgba(0, 0, 0, 0.55)';
const LIST_SCRIM_LIGHT = 'rgba(232, 201, 158, 0.32)';

export default function CartScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const cardBg = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;
  const router = useRouter();
  // odeme=red: online ödeme reddedildi, bekleme ekranı (app/odeme/[tx].tsx)
  // sepeti geri yükleyip buraya döndürdü -> üstte uyarı gösterilir.
  const { id, odeme } = useLocalSearchParams<{ id: string; odeme?: string }>();
  const [paymentRejected, setPaymentRejected] = useState(odeme === 'red');
  useEffect(() => {
    if (odeme === 'red') setPaymentRejected(true);
  }, [odeme]);
  const { user } = useAuth();
  const { lines, setQty, updateLine, clear, deliveryType, setDeliveryType } = useCart();
  // Bir sepet satırına basılınca (ürünün özelleştirmesi varsa) seçim ekranı
  // mevcut seçimle önceden doldurulmuş şekilde açılır (kullanıcı talimatı).
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const { markets } = useMarkets();
  const market = markets.find((m) => m.id === id);
  const [globalSettings, setGlobalSettings] = useState<StoreSettings>({});
  const settings = useMemo(() => withMarketSettings(globalSettings, market), [globalSettings, market]);
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
  // Konum kontrolü: müşteri adresin mahallesinde değilse açılan soru kutusu.
  const [locationPrompt, setLocationPrompt] = useState<{ here: string } | null>(null);

  // Sözleşme onayı ve teslimat tercihleri, teslimat türü değişince sıfırlanır.
  useEffect(() => {
    setAgreementAccepted(false);
  }, [deliveryType]);

  // "Kapıya bırak" sadece online ödemede geçerli — ödeme yöntemi değişince tutarsız kalmasın.
  useEffect(() => {
    if (paymentMethod !== 'online_card') setLeaveAtDoor(false);
  }, [paymentMethod]);

  useEffect(() => {
    fetchSettings().then(setGlobalSettings);
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
  // Not: `delivery_enabled` alanı admin panelinde hiçbir yerde açılamıyor
  // (backend'de de hiç okunmuyor, ölü bir alan) - sadece admin'in gerçekten
  // kontrol ettiği `active_eve_servis`'e bakıyoruz. Aksi halde admin "Eve
  // Servis: Açık" dese bile müşteride hep kapalı görünüyordu (kullanıcı
  // talimatıyla bulunan hata).
  const eveServisAvailable = !!market?.active_eve_servis;

  useEffect(() => {
    if (deliveryType === 'eve_servis' && !eveServisAvailable) setDeliveryType('gel_al');
  }, [eveServisAvailable, deliveryType]);

  const hoursRange = deliveryType === 'eve_servis' ? settings.delivery_order_hours : settings.pickup_order_hours;
  // Saat listesi gerçek saate bağlı: her dakika tazelenir, geçen dilimler düşer.
  const [nowMin, setNowMin] = useState(() => istanbulMinutes());
  useEffect(() => {
    const t = setInterval(() => setNowMin(istanbulMinutes()), 30_000);
    return () => clearInterval(t);
  }, []);
  const { openNow, slots: timeSlots } = useMemo(() => scheduleFor(hoursRange, nowMin), [hoursRange, nowMin]);
  // Seçili dilim geçtiyse "Şimdi"ye dön
  useEffect(() => {
    if (selectedSlot && !timeSlots.some((s) => s.start === selectedSlot.start)) setSelectedSlot(null);
  }, [timeSlots, selectedSlot]);

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

  // Kampanya ("çok al az öde") indirimi satır tutarında düşülü (sunucuyla aynı)
  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + lineTotal(l), 0), [lines, deliveryType]);
  const campaignTotal = useMemo(() => lines.reduce((sum, l) => sum + lineCampaignDiscount(l), 0), [lines]);
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
  // Pazar kapıda nakit ödemeyi kapatmışsa Eve Servis'te sadece online ödeme.
  const doorPaymentDisabled = deliveryType === 'eve_servis' && market?.kapida_nakit_odeme_enabled === false;
  const counterPaymentBlocked = cashLimitExceeded || doorPaymentDisabled;

  useEffect(() => {
    if (counterPaymentBlocked && paymentMethod === 'pay_at_counter') setPaymentMethod('online_card');
  }, [counterPaymentBlocked, paymentMethod]);

  // Koşullar tamamlanmadıysa "Sipariş Oluştur" butonu sönük/pasif görünür
  // (kullanıcı talimatı) — giriş yapılmamışsa bu kural işlemiyor, buton
  // her zaman aktif kalıp /giris'e yönlendiriyor.
  const canSubmit =
    !user ||
    (!submitting &&
      !belowMinimum &&
      agreementAccepted &&
      (deliveryType !== 'eve_servis' || (!!selectedAddress && addressServesMarket(selectedAddress, market?.delivery_neighborhoods))));

  async function handleCheckout(addressConfirmed = false) {
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
      setError(`Minimum sepet tutarına ulaşman için sepetine ${formatMoney(remainingForMinimum)} ₺ daha eklemen gerekiyor.`);
      return;
    }
    if (!agreementAccepted) {
      setError('Devam etmek için mesafeli satış sözleşmesini kabul etmelisin.');
      return;
    }
    setError(null);
    setSubmitting(true);
    // Eve Servis: müşteri şu an adresin mahallesinde değilse "farklı bir adrese
    // mi sipariş veriyorsunuz?" diye sorulur (konum yoksa sorulmaz, engellemez).
    if (deliveryType === 'eve_servis' && selectedAddress && !addressConfirmed && Platform.OS === 'web') {
      const check = await checkAtAddress(selectedAddress);
      if (check.result === 'different') {
        setSubmitting(false);
        setLocationPrompt({ here: check.here });
        return;
      }
    }
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
        marketId: id,
        deliveryType,
        paymentMethod,
        address,
        addressId: deliveryType === 'eve_servis' ? selectedAddress?.id : undefined,
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
      // Sepet TEMİZLENMEZ, yedeklenir: ödeme reddedilirse bekleme ekranı
      // (app/odeme/[tx].tsx) müşteriyi ürünleriyle birlikte sepete döndürür,
      // onaylanırsa sepeti temizleyip takip ekranına geçer.
      await savePendingPayment({ txId: result.tx_id, marketId: id, deliveryType, lines });
      if (Platform.OS === 'web') {
        window.location.href = result.payment_url;
      } else {
        await Linking.openURL(result.payment_url);
        router.push({ pathname: '/odeme/[tx]', params: { tx: result.tx_id } });
      }
      return;
    }
    clear();
    // Sipariş verilince doğrudan takip ekranına geç.
    router.push({ pathname: '/siparis/[tx]', params: { tx: result.tx_id } });
  }

  const isDark = scheme === 'dark';
  const shopLabel = deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al';

  return (
    <Screen>
      <View style={[styles.flex, { backgroundColor: isDark ? LIST_SCRIM_DARK : LIST_SCRIM_LIGHT }]}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <ThemedText style={styles.title}>Sepetim</ThemedText>
            {lines.length > 0 && (
              <ThemedText themeColor="textSecondary" style={styles.subtitle} numberOfLines={1}>
                {market?.name ? `${market.name} · ` : ''}{lines.length} ürün
              </ThemedText>
            )}
          </View>
          {lines.length > 0 && (
            <Pressable
              onPress={clear}
              hitSlop={6}
              style={({ pressed }) => [styles.clearBtn, { backgroundColor: withAlpha(theme.danger, 0.1), opacity: pressed ? 0.7 : 1 }]}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={15} color={theme.danger} />
              <ThemedText style={[styles.clearBtnText, { color: theme.danger }]}>Temizle</ThemedText>
            </Pressable>
          )}
          <Image source={isDark ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT} style={styles.logoBadge} resizeMode="contain" />
        </View>

        {lines.length === 0 ? (
          <View style={[styles.card, styles.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
            <View style={[styles.emptyIcon, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
              <MaterialCommunityIcons name="basket-outline" size={44} color={theme.tint} />
            </View>
            <ThemedText style={styles.emptyTitle}>Sepetin boş</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.emptyText}>
              Pazardaki taze ürünlere göz atıp sepetini doldurabilirsin.
            </ThemedText>
            <Pressable
              onPress={() => router.push(`/pazar/${id}`)}
              style={({ pressed }) => [styles.emptyBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 }]}
            >
              <ThemedText style={styles.ctaText}>Alışverişe Başla</ThemedText>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
            {paymentRejected && (
              <View style={[styles.rejectBanner, { backgroundColor: withAlpha(theme.danger, 0.14), borderColor: withAlpha(theme.danger, 0.35) }]}>
                <Ionicons name="close-circle" size={24} color={theme.danger} />
                <View style={styles.flex}>
                  <ThemedText style={[styles.rowTitle, { color: theme.danger }]}>Ödeme reddedildi</ThemedText>
                  <ThemedText style={styles.rowSub}>
                    Kartından ödeme alınamadı, sipariş oluşturulmadı. Sepetin olduğu gibi duruyor; tekrar deneyebilir ya da başka bir ödeme yöntemi seçebilirsin.
                  </ThemedText>
                </View>
                <Pressable onPress={() => setPaymentRejected(false)} hitSlop={8} accessibilityLabel="Uyarıyı kapat">
                  <Ionicons name="close" size={20} color={theme.textSecondary} />
                </Pressable>
              </View>
            )}
            {/* Ürünler — açılışta gizli, "Göster" ile açılır (kullanıcı talimatı). */}
            <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
              <View style={styles.cardHeadRow}>
                <SectionTitle icon="basket-outline" title="Ürünler" />
                <Pressable
                  onPress={() => setProductsExpanded((v) => !v)}
                  hitSlop={6}
                  style={[styles.togglePill, { backgroundColor: withAlpha(theme.tint, 0.12) }]}
                >
                  <ThemedText style={[styles.togglePillText, { color: theme.tint }]}>
                    {productsExpanded ? 'Gizle' : 'Göster'}
                  </ThemedText>
                  <Ionicons name={productsExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={theme.tint} />
                </Pressable>
              </View>
              <ThemedText themeColor="textSecondary" style={styles.cardSub}>
                {lines.length} çeşit ürün · {formatMoney(subtotal)} ₺
              </ThemedText>

              {productsExpanded &&
                lines.map((item, i) => (
                  <CartLineRow
                    key={item.lineId}
                    line={item}
                    unitPrice={priceFor(item)}
                    first={i === 0}
                    onEdit={() => setEditingLine(item)}
                    onQty={(q) => setQty(item.lineId, q)}
                  />
                ))}
            </View>

            {/* Teslimat */}
            <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
              <SectionTitle icon="truck-delivery-outline" title="Teslimat" />
              <Segmented
                options={[
                  { key: 'gel_al', label: 'Pazardan Gel-Al', icon: 'storefront-outline' },
                  { key: 'eve_servis', label: 'Eve Servis', icon: 'moped-outline', disabled: !eveServisAvailable },
                ]}
                value={deliveryType}
                onChange={(k) => setDeliveryType(k as typeof deliveryType)}
              />
              {deliveryType === 'eve_servis' && (
                <View style={styles.addressBlock}>
                  <View style={styles.rowBetween}>
                    <ThemedText themeColor="textSecondary" style={styles.smallLabel}>Teslimat adresi</ThemedText>
                    <Pressable onPress={() => router.push('/adreslerim')} hitSlop={8}>
                      <ThemedText style={[styles.linkText, { color: theme.tint }]}>Adresleri yönet</ThemedText>
                    </Pressable>
                  </View>

                  {addresses.length === 0 ? (
                    <Pressable
                      onPress={() => router.push('/adreslerim')}
                      style={[styles.addAddressBtn, { borderColor: withAlpha(theme.tint, 0.6) }]}
                    >
                      <Ionicons name="add" size={16} color={theme.tint} />
                      <ThemedText style={[styles.linkText, { color: theme.tint }]}>Adres Ekle</ThemedText>
                    </Pressable>
                  ) : (
                    <>
                      <View style={styles.chipsWrap}>
                        {addresses.map((a) => {
                          const active = a.id === selectedAddressId;
                          const served = addressServesMarket(a, market?.delivery_neighborhoods);
                          return (
                            <Pressable
                              key={a.id}
                              onPress={() => setSelectedAddressId(a.id)}
                              style={[styles.chip, { backgroundColor: active ? theme.tint : withAlpha(theme.text, 0.06) }]}
                            >
                              <Ionicons name="home-outline" size={13} color={active ? '#fff' : theme.text} />
                              <ThemedText style={[styles.chipText, { color: active ? '#fff' : theme.text }]}>{a.title}</ThemedText>
                              {!served && (
                                <ThemedText style={[styles.chipText, { color: active ? '#fff' : theme.danger }]}>· Servis yok</ThemedText>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                      {selectedAddress && (
                        <View style={styles.infoRow}>
                          <Ionicons name="location-outline" size={15} color={theme.tint} />
                          <ThemedText themeColor="textSecondary" style={styles.infoText}>
                            {formatAddressLine(selectedAddress)}
                          </ThemedText>
                        </View>
                      )}
                    </>
                  )}

                  {!!market?.delivery_neighborhoods?.length && (
                    <View style={[styles.noteStrip, { backgroundColor: withAlpha(theme.tint, 0.1) }]}>
                      <Ionicons name="map-outline" size={15} color={theme.tint} />
                      <ThemedText themeColor="textSecondary" style={styles.infoText}>
                        <ThemedText style={[styles.infoText, { color: theme.tint, fontWeight: '800' }]}>Servis mahalleleri: </ThemedText>
                        {market.delivery_neighborhoods.join(', ')}
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Ödeme */}
            <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
              <SectionTitle icon="wallet-outline" title="Ödeme" />
              <Segmented
                options={[
                  {
                    key: 'pay_at_counter',
                    label: deliveryType === 'eve_servis' ? 'Kapıda Nakit' : 'Tezgahta Öde',
                    icon: 'cash',
                    disabled: counterPaymentBlocked,
                  },
                  { key: 'online_card', label: 'Online Kart', icon: 'credit-card-outline' },
                ]}
                value={paymentMethod}
                onChange={(k) => setPaymentMethod(k as PaymentMethod)}
              />
              {doorPaymentDisabled ? (
                <Hint text="Bu pazarda kapıda ödeme kapalı, sadece online ödeme geçerlidir." />
              ) : cashLimitExceeded ? (
                <Hint
                  strong
                  text={`${settings.cash_payment_max_amount?.toFixed(0)} TL ve üzeri alışverişlerde nakit/POS kapalı, sadece online ödeme geçerlidir.`}
                />
              ) : (
                paymentMethod === 'pay_at_counter' && (
                  <Hint
                    text={
                      deliveryType === 'eve_servis'
                        ? 'Kapıda sadece nakit geçerlidir.'
                        : 'Tezgahta nakit veya kartla (POS) ödeyebilirsin.'
                    }
                  />
                )
              )}
            </View>

            {/* Kupon */}
            <View style={[styles.card, styles.shadow, styles.couponCard, { backgroundColor: cardBg }]}>
              {couponApplying ? (
                <ActivityIndicator color={theme.tint} style={styles.flex} />
              ) : appliedCoupon ? (
                <>
                  <View style={[styles.iconCircle, { backgroundColor: theme.tint }]}>
                    <MaterialCommunityIcons name="ticket-percent" size={18} color="#fff" />
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={styles.rowTitle} numberOfLines={1}>{appliedCoupon.title}</ThemedText>
                    <ThemedText style={[styles.rowSub, { color: theme.tint }]}>
                      {formatMoney(appliedCoupon.discount)} ₺ indirim uygulandı
                    </ThemedText>
                  </View>
                  <Pressable onPress={removeCoupon} hitSlop={8} accessibilityLabel="Kuponu kaldır">
                    <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={openCouponPicker} style={styles.couponPressable}>
                  <View style={[styles.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                    <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={theme.tint} />
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={styles.rowTitle}>İndirim kuponu</ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.rowSub}>Kuponlarından birini seç</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
            {couponError && <ThemedText style={[styles.errorText, { color: theme.danger }]}>{couponError}</ThemedText>}

            {/* Özet */}
            <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
              <SectionTitle icon="receipt-text-outline" title="Özet" />
              <MoneyRow label="Ara toplam" value={`${formatMoney(subtotal)} ₺`} />
              {campaignTotal > 0 && (
                <MoneyRow label="Kampanya indirimi (dahil)" value={`−${formatMoney(campaignTotal)} ₺`} accent />
              )}
              <View style={styles.rowBetween}>
                <ThemedText themeColor="textSecondary" style={styles.moneyLabel}>
                  {deliveryType === 'eve_servis' ? 'Teslimat saati' : 'Gel-Al saati'}
                </ThemedText>
                <Pressable
                  onPress={() => setScheduleOpen((v) => !v)}
                  hitSlop={6}
                  style={[styles.timePill, { backgroundColor: withAlpha(theme.tint, 0.12) }]}
                >
                  <Ionicons name="time-outline" size={13} color={theme.tint} />
                  <ThemedText style={[styles.timePillText, { color: theme.tint }]}>
                    {selectedSlot ? `${selectedSlot.start}-${selectedSlot.end}` : openNow ? 'Şimdi' : 'Kapalı'}
                  </ThemedText>
                  <Ionicons name={scheduleOpen ? 'chevron-up' : 'chevron-down'} size={13} color={theme.tint} />
                </Pressable>
              </View>
              {!openNow && (
                <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
                  {deliveryType === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} şu an kapalı · sipariş saatleri {hoursRange}
                </ThemedText>
              )}
              {/* Sunucu sipariş anında açık olmayı şart koşuyor: kapalıyken liste yok */}
              {scheduleOpen && openNow && (
                <View style={styles.chipsWrap}>
                  {[null, ...timeSlots].map((s) => {
                    const active = s ? selectedSlot?.start === s.start : !selectedSlot;
                    return (
                      <Pressable
                        key={s ? s.start : 'now'}
                        onPress={() => {
                          setSelectedSlot(s);
                          setScheduleOpen(false);
                        }}
                        style={[styles.chip, { backgroundColor: active ? theme.tint : withAlpha(theme.text, 0.06) }]}
                      >
                        <ThemedText style={[styles.chipText, { color: active ? '#fff' : theme.text }]}>
                          {s ? `${s.start}-${s.end}` : 'Şimdi'}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {deliveryType === 'eve_servis' && (
                <MoneyRow label="Teslimat" value={deliveryFee > 0 ? `${formatMoney(deliveryFee)} ₺` : 'Ücretsiz'} accent={deliveryFee === 0} />
              )}
              {couponDiscount > 0 && (
                <MoneyRow label={`Kupon (${appliedCoupon!.code})`} value={`−${formatMoney(couponDiscount)} ₺`} accent />
              )}
              {belowMinimum ? (
                <View style={[styles.noteStrip, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
                  <Ionicons name="information-circle" size={16} color={theme.tint} />
                  <ThemedText style={[styles.infoText, { color: theme.text }]}>
                    Minimum sipariş <ThemedText style={[styles.infoText, styles.bold]}>{formatMoney(minAmount!)} ₺</ThemedText>. Sepetine{' '}
                    <ThemedText style={[styles.infoText, styles.bold, { color: theme.tint }]}>{formatMoney(remainingForMinimum)} ₺</ThemedText> daha ekle.
                  </ThemedText>
                </View>
              ) : (
                remainingForFreeDelivery > 0 && (
                  <View style={[styles.noteStrip, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
                    <MaterialCommunityIcons name="moped-outline" size={16} color={theme.tint} />
                    <ThemedText style={[styles.infoText, { color: theme.text }]}>
                      Ücretsiz teslimat için{' '}
                      <ThemedText style={[styles.infoText, styles.bold, { color: theme.tint }]}>{formatMoney(remainingForFreeDelivery)} ₺</ThemedText> daha ekle.
                    </ThemedText>
                  </View>
                )
              )}
              <View style={[styles.divider, { backgroundColor: withAlpha(theme.text, 0.1) }]} />
              <View style={styles.totalRow}>
                <ThemedText style={styles.totalLabel}>Toplam</ThemedText>
                <ThemedText style={[styles.totalValue, { color: theme.tint }]}>{formatMoney(total)} ₺</ThemedText>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name={deliveryType === 'eve_servis' ? 'bicycle-outline' : 'storefront-outline'} size={15} color={theme.tint} />
                <ThemedText themeColor="textSecondary" style={styles.infoText}>
                  {deliveryType === 'eve_servis'
                    ? 'Ürünlerin belirttiğin adrese teslim edilecek.'
                    : 'Ürünlerini Afro Gıda tezgahından teslim alacaksın. Ödeme teslimatta yapılabilir.'}
                </ThemedText>
              </View>
            </View>

            {/* Teslimat tercihleri: sadece Eve Servis'te anlamlı. */}
            {deliveryType === 'eve_servis' && (
              <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
                <SectionTitle icon="package-variant-closed" title="Teslimat tercihleri" />
                <CheckboxRow checked={noRing} onToggle={() => setNoRing((v) => !v)}>
                  Kurye zili çalmasın
                </CheckboxRow>
                <CheckboxRow checked={leaveAtDoor} onToggle={() => setLeaveAtDoor((v) => !v)} disabled={paymentMethod !== 'online_card'}>
                  Kapıya bırak{'\n'}
                  <ThemedText type="small" themeColor="textSecondary">Sadece online ödemelerde geçerlidir.</ThemedText>
                </CheckboxRow>
                <TextInput
                  value={deliveryNote}
                  onChangeText={setDeliveryNote}
                  placeholder="Teslimat notu (ör: 3. kat, kapı kodu 1234)"
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  style={[styles.noteInput, { color: theme.text, backgroundColor: theme.inputBg }]}
                />
              </View>
            )}

            {/* Sözleşme + sipariş */}
            <View style={[styles.card, styles.shadow, { backgroundColor: cardBg }]}>
              <CheckboxRow checked={agreementAccepted} onToggle={() => setAgreementAccepted((v) => !v)}>
                {/* Dokununca yürürlükteki sözleşme PDF'i açılır (Yönetim > Sözleşmeler) */}
                <ThemedText
                  type="small"
                  themeColor="tint"
                  style={{ fontWeight: '700', textDecorationLine: 'underline' }}
                  onPress={() => openLegal(deliveryType === 'eve_servis' ? 'homeDeliveryTerms' : 'pickupTerms')}
                  accessibilityRole="link"
                >
                  {shopLabel} Mesafeli Satış Sözleşmesi
                </ThemedText>
                {"'ni okudum ve kabul ediyorum."}
              </CheckboxRow>
            </View>

            {!user && (
              <ThemedText themeColor="textSecondary" style={styles.centerNote}>Sipariş verebilmek için giriş yapmalısın.</ThemedText>
            )}
            {error && <ThemedText style={[styles.errorText, styles.centerNote, { color: theme.danger }]}>{error}</ThemedText>}

            <Pressable
              style={({ pressed }) => [
                styles.ctaBtn,
                canSubmit && styles.ctaShadow,
                { backgroundColor: canSubmit ? theme.tint : withAlpha(theme.tint, 0.35), opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={() => handleCheckout()}
              disabled={!canSubmit}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" style={styles.flex} />
              ) : (
                <>
                  <ThemedText style={[styles.ctaText, styles.flex]} numberOfLines={1}>
                    {!user
                      ? 'Giriş Yap ve Devam Et'
                      : paymentMethod === 'online_card'
                        ? 'Güvenli Ödemeye Geç'
                        : `${shopLabel} Siparişi Oluştur`}
                  </ThemedText>
                  <View style={styles.ctaTotal}>
                    <ThemedText style={styles.ctaTotalText}>{formatMoney(total)} ₺</ThemedText>
                    <Ionicons name="arrow-forward" size={17} color="#fff" />
                  </View>
                </>
              )}
            </Pressable>
            {belowMinimum && (
              <ThemedText themeColor="textSecondary" style={styles.centerNote}>
                Siparişi oluşturmak için {formatMoney(remainingForMinimum)} ₺ daha ürün eklemelisin.
              </ThemedText>
            )}
          </ScrollView>
        )}
      </View>

      <Modal visible={!!locationPrompt} transparent animationType="fade" onRequestClose={() => setLocationPrompt(null)}>
        <View style={styles.promptBackdrop}>
          <View style={[styles.promptCard, styles.cardShadow, { backgroundColor: cardBg }]}>
            <View style={[styles.promptIcon, { backgroundColor: withAlpha(theme.tint, 0.15) }]}>
              <MaterialCommunityIcons name="map-marker-question-outline" size={30} color={theme.tint} />
            </View>
            <ThemedText style={styles.promptTitle}>Sipariş verdiğiniz adreste değilsiniz</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.promptText}>
              {locationPrompt?.here ? `Şu an ${locationPrompt.here} Mah. civarındasınız. ` : 'Konumunuz sipariş adresinden uzakta görünüyor. '}
              Farklı bir adrese mi sipariş veriyorsunuz?
            </ThemedText>
            {selectedAddress && (
              <View style={[styles.promptAddr, { backgroundColor: withAlpha(theme.tint, 0.1) }]}>
                <Ionicons name="home-outline" size={16} color={theme.tint} />
                <ThemedText style={styles.promptAddrText}>{formatAddressLine(selectedAddress)}</ThemedText>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [styles.promptBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 }]}
              onPress={() => {
                setLocationPrompt(null);
                handleCheckout(true);
              }}
            >
              <ThemedText style={styles.promptBtnText}>Evet, bu adrese gönder</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.promptBtn, styles.promptBtnOutline, { borderColor: theme.tint, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => setLocationPrompt(null)}
            >
              <ThemedText style={[styles.promptBtnText, { color: theme.tint }]}>Hayır, adresi değiştireyim</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

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

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

/** Kart başlığı: yuvarlak ikon + kalın başlık. */
function SectionTitle({ icon, title }: { icon: Mci; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionTitleRow}>
      <View style={[styles.iconCircleSm, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
        <MaterialCommunityIcons name={icon} size={16} color={theme.tint} />
      </View>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
    </View>
  );
}

/** Tek parça seçici (Gel-Al / Eve Servis, Nakit / Online). */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; icon: Mci; disabled?: boolean }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            disabled={o.disabled}
            onPress={() => onChange(o.key)}
            style={[
              styles.segmentBtn,
              active && [styles.segmentActive, { backgroundColor: theme.tint }],
              o.disabled && styles.segmentDisabled,
            ]}
          >
            <MaterialCommunityIcons name={o.icon} size={16} color={active ? '#fff' : theme.textSecondary} />
            <ThemedText numberOfLines={1} style={[styles.segmentText, { color: active ? '#fff' : theme.text }]}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Sepet satırı: görsel, ad + seçenekler + birim fiyat, satır tutarı ve miktar hapı. */
function CartLineRow({
  line,
  unitPrice,
  first,
  onEdit,
  onQty,
}: {
  line: CartLine;
  unitPrice: number;
  first: boolean;
  onEdit: () => void;
  onQty: (q: number) => void;
}) {
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const step = qtyStep(line.product.unit);
  const unit = formatUnit(line.product.unit).toLowerCase();
  const showImage = line.product.image_url && !imageFailed;
  const editable = !!line.product.customization_options?.length;
  const campaign = lineCampaignDiscount(line);
  const chosen = (line.selectedOptions ?? []).filter((o) => !isNoneLabel(o.label)).map((o) => o.label);

  return (
    <View style={[styles.lineRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(theme.text, 0.18) }]}>
      <View style={[styles.lineThumb, { backgroundColor: theme.tintSoft }]}>
        {showImage ? (
          <Image source={{ uri: line.product.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setImageFailed(true)} />
        ) : (
          <Ionicons name="leaf-outline" size={22} color={withAlpha(theme.tint, 0.7)} />
        )}
      </View>
      <Pressable style={styles.lineInfo} disabled={!editable} onPress={onEdit}>
        <ThemedText style={styles.lineName} numberOfLines={2}>{line.product.name}</ThemedText>
        {/* "İstemiyorum" (seçim yapılmadı) listelenmez; sadece gerçek seçimler */}
        {(chosen.length > 0 || editable) && (
          <ThemedText style={[styles.lineOpts, { color: theme.tint }]} numberOfLines={1}>
            {chosen.length ? chosen.join(', ') : 'Seçenek seç'}
            {editable && chosen.length ? '  ·  Düzenle' : ''}
          </ThemedText>
        )}
        <ThemedText themeColor="textSecondary" style={styles.lineUnit}>
          {formatMoney(unitPrice)} ₺ / {unit}
        </ThemedText>
        {campaign > 0 ? (
          <ThemedText style={[styles.lineUnit, styles.campaignText, { color: theme.tint }]}>
            %{line.product.campaign_discount_percent} kampanya · −{formatMoney(campaign)} ₺
          </ThemedText>
        ) : !!line.product.campaign_discount_percent && !!line.product.campaign_min_qty ? (
          <ThemedText themeColor="textSecondary" style={styles.lineUnit}>
            {line.product.campaign_min_qty} {unit} ve üzeri %{line.product.campaign_discount_percent} indirim
          </ThemedText>
        ) : null}
      </Pressable>
      <View style={styles.lineRight}>
        <ThemedText style={styles.lineTotal}>{formatMoney(lineTotal(line))} ₺</ThemedText>
        <View style={[styles.stepper, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
          <Pressable onPress={() => onQty(line.qty - step)} hitSlop={6} style={styles.stepperBtn} accessibilityLabel={`${line.product.name} azalt`}>
            <MaterialCommunityIcons name={line.qty <= step ? 'trash-can-outline' : 'minus'} size={16} color={theme.tint} />
          </Pressable>
          <ThemedText style={styles.stepperQty}>
            {formatQty(line.qty, line.product.unit)}
          </ThemedText>
          <Pressable onPress={() => onQty(line.qty + step)} hitSlop={6} style={styles.stepperBtn} accessibilityLabel={`${line.product.name} artır`}>
            <MaterialCommunityIcons name="plus" size={16} color={theme.tint} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MoneyRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.rowBetween}>
      <ThemedText themeColor="textSecondary" style={styles.moneyLabel}>{label}</ThemedText>
      <ThemedText style={[styles.moneyValue, accent && { color: theme.tint }]}>{value}</ThemedText>
    </View>
  );
}

function Hint({ text, strong }: { text: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name="information-circle-outline" size={15} color={theme.tint} />
      <ThemedText style={[styles.infoText, { color: strong ? theme.tint : theme.textSecondary }, strong && styles.bold]}>{text}</ThemedText>
    </View>
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
      <View style={[styles.modalSheet, { backgroundColor: scheme === 'dark' ? '#0a0f0c' : theme.background }]}>
        <View style={[styles.modalGrabber, { backgroundColor: withAlpha(theme.text, 0.2) }]} />
        <View style={styles.modalHeaderRow}>
          <ThemedText style={[styles.sectionTitle, styles.flex]}>Kuponlarım</ThemedText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.four }} />
        ) : coupons.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={styles.centerNote}>Kullanılabilir kuponun yok.</ThemedText>
        ) : (
          <ScrollView contentContainerStyle={{ gap: Spacing.two, paddingBottom: Spacing.four }}>
            {coupons.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => onSelect(c)}
                style={({ pressed }) => [styles.couponListItem, { backgroundColor: cardBg, opacity: pressed ? 0.8 : 1 }]}
              >
                <View style={[styles.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={theme.tint} />
                </View>
                <View style={styles.flex}>
                  <ThemedText style={styles.rowTitle}>{c.title}</ThemedText>
                  {!!c.description && <ThemedText themeColor="textSecondary" style={styles.rowSub}>{c.description}</ThemedText>}
                  <ThemedText style={[styles.rowSub, styles.bold, { color: theme.tint }]}>
                    {c.discount_amount ? `${formatMoney(c.discount_amount)} ₺ indirim` : `%${c.discount_percent} indirim`}
                    {c.min_amount ? ` · min ${c.min_amount.toFixed(0)} ₺` : ''}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '800' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two,
  },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 17 },
  logoBadge: { width: 48, height: 48 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 6 },
  clearBtnText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  // Yüzen sekme çubuğunun arkasında kalmasın diye altta boşluk.
  scrollContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six + Spacing.five, gap: Spacing.three },
  card: { borderRadius: 22, padding: Spacing.three, gap: Spacing.two + 2 },
  shadow: { shadowColor: '#7a4a1c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 3 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardSub: { fontSize: 13, lineHeight: 17, marginTop: -6 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  iconCircleSm: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  togglePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 5 },
  togglePillText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  // Boş sepet
  emptyCard: { marginHorizontal: Spacing.three, marginTop: Spacing.four, alignItems: 'center', paddingVertical: Spacing.five },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  emptyTitle: { fontSize: 20, lineHeight: 24, fontWeight: '900' },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 19, paddingHorizontal: Spacing.two },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 999,
    paddingHorizontal: Spacing.four, height: 48, marginTop: Spacing.two,
  },
  // Sepet satırı
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, paddingTop: Spacing.two + 2 },
  lineThumb: { width: 50, height: 50, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  lineInfo: { flex: 1, gap: 1 },
  lineName: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  lineOpts: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  lineUnit: { fontSize: 12, lineHeight: 15 },
  campaignText: { fontWeight: '800' },
  lineRight: { alignItems: 'flex-end', gap: 6 },
  lineTotal: { fontSize: 15, lineHeight: 19, fontWeight: '900' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, height: 30 },
  stepperBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  stepperQty: { minWidth: 26, textAlign: 'center', fontSize: 13, lineHeight: 16, fontWeight: '800' },
  // Seçiciler
  segment: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 12, paddingHorizontal: 6 },
  segmentActive: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 2 },
  segmentDisabled: { opacity: 0.4 },
  segmentText: { fontSize: 13, lineHeight: 16, fontWeight: '800', flexShrink: 1 },
  // Adres / çipler
  addressBlock: { gap: Spacing.two },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallLabel: { fontSize: 13, lineHeight: 17, fontWeight: '700' },
  linkText: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  addAddressBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, height: 44,
  },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two + 4, height: 32 },
  chipText: { fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  infoText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  noteStrip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: Spacing.two + 2 },
  rejectBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 4, borderRadius: 18, borderWidth: 1, padding: Spacing.three - 2 },
  // Kupon
  couponCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, minHeight: 72 },
  couponPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4 },
  rowTitle: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  rowSub: { fontSize: 12.5, lineHeight: 16 },
  errorText: { fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: -Spacing.two },
  // Özet
  moneyLabel: { fontSize: 14, lineHeight: 18 },
  moneyValue: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two + 2, height: 28 },
  timePillText: { fontSize: 12.5, lineHeight: 16, fontWeight: '800' },
  divider: { height: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalLabel: { fontSize: 17, lineHeight: 21, fontWeight: '900' },
  totalValue: { fontSize: 26, lineHeight: 30, fontWeight: '900', letterSpacing: -0.5 },
  // Tercihler
  noteInput: { borderRadius: 14, paddingHorizontal: Spacing.three - 2, paddingVertical: Spacing.two + 2, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  // Sipariş düğmesi
  centerNote: { textAlign: 'center', fontSize: 13, lineHeight: 17, marginTop: -Spacing.one },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderRadius: 999, height: 58, paddingLeft: Spacing.four, paddingRight: 8,
  },
  ctaShadow: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 6 },
  // Konum soru kutusu
  promptBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  promptCard: { width: '100%', maxWidth: 380, borderRadius: 26, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  cardShadow: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 8 },
  promptIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  promptTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900', textAlign: 'center' },
  promptText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  promptAddr: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignSelf: 'stretch' },
  promptAddrText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  promptBtn: { alignSelf: 'stretch', height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  promptBtnOutline: { borderWidth: 1.5, backgroundColor: 'transparent' },
  promptBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  ctaText: { color: '#fff', fontSize: 15.5, lineHeight: 19, fontWeight: '900' },
  ctaTotal: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999, height: 42, paddingHorizontal: Spacing.three,
  },
  ctaTotalText: { color: '#fff', fontSize: 15, lineHeight: 19, fontWeight: '900' },
  // Kupon seçici
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: Spacing.two, paddingBottom: Spacing.three, paddingHorizontal: Spacing.three,
  },
  modalGrabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: Spacing.two },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  couponListItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, borderRadius: 18, padding: Spacing.three - 4 },
});
