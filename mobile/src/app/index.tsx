import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { FlatList, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useMarkets } from '@/lib/markets-context';
import { fetchSettings } from '@/lib/settings';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Market } from '@/lib/types';

const WALLPAPER_CARD_LIGHT = require('@/assets/brand/wallpaper-light.jpg');
const WALLPAPER_CARD_DARK = require('@/assets/brand/wallpaper-dark.jpg');

// Pazar kartının alt şeridi: koyu temada eskisi gibi siyah-yeşil, açık temada
// krem (tema kuralı: açık = turuncu + krem, koyu = siyah + yeşil).
const CARD_DARK = { body: '#0d1410', outline: '#2a2f2c', text: '#f2f5ef', muted: '#9aa39c', closed: '#2a2f2c', chip: '#18231d' };
const LOGO = require('@/assets/brand/logo.png');
// Ürünler ekranıyla aynı perde: duvar kağıdı kenarlarda seçilir, yazılar net okunur.
const LIST_SCRIM_DARK = 'rgba(0, 0, 0, 0.55)';
const LIST_SCRIM_LIGHT = 'rgba(232, 201, 158, 0.32)';
// Görselin alt kısmını koyulaştıran geçiş: pazar adı görselin üstünde okunur.
const IMAGE_FADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.72)'] as const;

/**
 * "Olduğumuz Pazarlar" — uygulamanın kök ekranı. Sekme çubuğu YOK; üye
 * olmayan biri sadece bu ekranı görür. Bir pazarda "Siparişe Başla"'ya
 * basınca /pazar/[id] altındaki sekmeli (Kampanyalar/Sepet/Profil) alışveriş
 * bölümüne girilir.
 */
export default function MarketsScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { markets, loading } = useMarkets();
  const [supportPhone, setSupportPhone] = useState<string | undefined>(undefined);
  const isGuest = !authLoading && !user;

  useEffect(() => {
    fetchSettings().then((s) => setSupportPhone(s.support_phone));
  }, []);

  const header = (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={LOGO} style={styles.brandLogo} resizeMode="contain" />
        <ThemedText style={[styles.brandName, { color: theme.tint }]}>AFRO GIDA</ThemedText>
        <View style={styles.flex} />
        {isGuest && (
          <Pressable
            style={({ pressed }) => [styles.loginBtn, { borderColor: theme.tint, opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push('/giris')}
          >
            <Ionicons name="person-outline" size={15} color={theme.tint} />
            <ThemedText style={[styles.loginText, { color: theme.tint }]}>Giriş Yap</ThemedText>
          </Pressable>
        )}
      </View>

      <View style={styles.titleBlock}>
        <ThemedText style={styles.title}>Olduğumuz Pazarlar</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          Hangi gün, hangi pazardayız?
        </ThemedText>
      </View>

      {isGuest && (
        <Pressable
          style={({ pressed }) => [styles.ctaBanner, styles.shadow, { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 }]}
          onPress={() => router.push('/kayit')}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="gift-outline" size={22} color="#fff" />
          </View>
          <View style={styles.flex}>
            <ThemedText style={styles.ctaTitle}>Hemen Üye Olun</ThemedText>
            <ThemedText style={styles.ctaText}>Avantajlı fiyatlar ve kuponlar için ücretsiz kayıt olun</ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </Pressable>
      )}
    </View>
  );

  return (
    <Screen>
      <View style={[styles.flex, { backgroundColor: isDark ? LIST_SCRIM_DARK : LIST_SCRIM_LIGHT }]}>
        <FlatList
          style={styles.flex}
          data={loading ? [] : markets}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderItem={({ item }) => <MarketCard market={item} supportPhone={supportPhone} isMember={!!user} />}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name={loading ? 'hourglass-outline' : 'storefront-outline'} size={28} color={theme.tint} />
              <ThemedText themeColor="textSecondary">{loading ? 'Yükleniyor…' : 'Şu an açık pazar yok.'}</ThemedText>
            </View>
          }
        />
      </View>
    </Screen>
  );
}

function MarketCard({ market, supportPhone, isMember }: { market: Market; supportPhone?: string; isMember: boolean }) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const c = isDark
    ? CARD_DARK
    : { body: theme.backgroundElement, outline: theme.border, text: theme.text, muted: theme.textSecondary, closed: theme.backgroundSelected, chip: theme.background };
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const [neighborhoodsOpen, setNeighborhoodsOpen] = useState(false);
  // Not: delivery_neighborhoods boşsa "her mahalleye servis var" demektir
  // (bkz. lib/addresses.ts addressServesMarket) — bu yüzden burada mahalle
  // sayısı şartı ARANMIYOR, sepetteki asıl uygunluk kontrolüyle (sepet.tsx
  // eveServisAvailable) aynı alana bakılıyor. `delivery_enabled` admin'de
  // hiç kontrol edilemeyen (ve backend'de de okunmayan) ölü bir alan olduğu
  // için kontrolden çıkarıldı (kullanıcı talimatıyla bulunan hata).
  const hasDelivery = !!market.active_eve_servis;
  const mapUrl = market.google_maps_url || market.location_url;
  const showRealImage = market.image_url && !imageFailed;
  const open = market.orders_enabled;
  // Görselin üstündeki haplar: açık temada krem, koyu temada siyah cam.
  const pillBg = isDark ? 'rgba(10, 14, 12, 0.72)' : withAlpha(theme.background, 0.94);

  return (
    <View style={[styles.card, styles.shadow, { backgroundColor: c.body }, isDark && styles.shadowDark]}>
      <View style={styles.cardImageWrap}>
        {showRealImage ? (
          <Image
            source={{ uri: market.image_url! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <>
            <Image source={isDark ? WALLPAPER_CARD_DARK : WALLPAPER_CARD_LIGHT} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <Image source={LOGO} style={styles.cardLogo} resizeMode="contain" />
          </>
        )}
        <LinearGradient colors={IMAGE_FADE} locations={[0.35, 0.6, 1]} style={StyleSheet.absoluteFill} />
        {!open && <View style={[StyleSheet.absoluteFill, styles.closedVeil]} />}

        <View style={[styles.pill, styles.dayPill, { backgroundColor: pillBg }]}>
          <Ionicons name="calendar-outline" size={13} color={theme.tint} />
          <ThemedText style={[styles.pillText, { color: c.text }]}>{capitalize(market.day)}</ThemedText>
        </View>
        <View style={[styles.pill, styles.statusPill, { backgroundColor: pillBg }]}>
          <View style={[styles.statusDot, { backgroundColor: open ? theme.tint : c.muted }]} />
          <ThemedText style={[styles.pillText, { color: c.text }]}>{open ? 'Sipariş açık' : 'Kapalı'}</ThemedText>
        </View>

        <View style={styles.imageCaption}>
          <ThemedText numberOfLines={1} style={styles.marketName}>
            {market.name}
          </ThemedText>
          {!!market.location && (
            <View style={styles.locationRow}>
              <Ionicons name="location-sharp" size={13} color="rgba(255,255,255,0.85)" />
              <ThemedText numberOfLines={1} style={styles.locationText}>
                {market.location}
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.featureRow}>
          {market.active_eve_servis && <Feature icon="bicycle-outline" label="Eve Servis" bg={c.chip} color={c.text} tint={theme.tint} />}
          {market.active_gel_al && <Feature icon="bag-handle-outline" label="Gel-Al" bg={c.chip} color={c.text} tint={theme.tint} />}
          {hasDelivery && (
            <Pressable onPress={() => setNeighborhoodsOpen(true)} hitSlop={8} style={styles.linkBtn}>
              <ThemedText style={[styles.linkText, { color: theme.tint }]}>Servis mahalleleri</ThemedText>
              <Ionicons name="chevron-forward" size={14} color={theme.tint} />
            </Pressable>
          )}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: open ? theme.tint : c.closed, opacity: pressed ? 0.85 : 1 },
            ]}
            disabled={!open}
            onPress={() => router.push(isMember ? `/pazar/${market.id}` : '/giris')}
          >
            {!open ? (
              <Ionicons name="time-outline" size={19} color={isDark ? '#fff' : c.muted} />
            ) : !isMember ? (
              <Ionicons name="lock-closed-outline" size={18} color="#fff" />
            ) : null}
            <ThemedText style={[styles.actionText, { color: open || isDark ? '#fff' : c.muted }]}>
              {!open ? 'Şu an kapalı' : isMember ? 'Siparişe Başla' : 'Üye Girişi Gerekli'}
            </ThemedText>
            {open && isMember && <Ionicons name="arrow-forward" size={18} color="#fff" />}
          </Pressable>
          <Pressable
            accessibilityLabel="Konum"
            disabled={!mapUrl}
            style={({ pressed }) => [
              styles.mapBtn,
              { borderColor: c.outline, opacity: !mapUrl ? 0.45 : pressed ? 0.7 : 1 },
            ]}
            onPress={() => mapUrl && Linking.openURL(mapUrl)}
          >
            <Ionicons name="navigate-outline" size={20} color={theme.tint} />
          </Pressable>
        </View>
      </View>

      <Modal visible={neighborhoodsOpen} transparent animationType="fade" onRequestClose={() => setNeighborhoodsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setNeighborhoodsOpen(false)} />
        <View style={styles.modalCenterWrap} pointerEvents="box-none">
          <View style={[styles.neighborhoodsBox, styles.shadow, { backgroundColor: theme.background }]}>
            <View style={styles.neighborhoodsHeaderRow}>
              <View style={[styles.modalIcon, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="location-outline" size={18} color={theme.tint} />
              </View>
              <View style={styles.flex}>
                <ThemedText type="smallBold">Evlere Servisimiz Olan Mahalleler</ThemedText>
                {!!market.location && (
                  <ThemedText themeColor="textSecondary" type="small">{market.location}</ThemedText>
                )}
              </View>
              <Pressable onPress={() => setNeighborhoodsOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            {market.delivery_neighborhoods?.length ? (
              <ScrollView style={styles.neighborhoodsList}>
                <View style={styles.neighborhoodsChipsWrap}>
                  {market.delivery_neighborhoods.map((n) => (
                    <View key={n} style={[styles.neighborhoodChip, { backgroundColor: theme.backgroundElement }]}>
                      <Ionicons name="checkmark-circle" size={14} color={theme.tint} />
                      <ThemedText type="small">{n}</ThemedText>
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <ThemedText themeColor="textSecondary" type="small" style={{ marginTop: Spacing.one }}>
                Tüm mahallelere eve servis veriyoruz.
              </ThemedText>
            )}
            {!!supportPhone && (
              <View style={styles.supportBox}>
                <ThemedText themeColor="textSecondary" type="small" style={{ textAlign: 'center' }}>
                  Daha fazla bilgi için bizlere ulaşın.
                </ThemedText>
                <Pressable
                  style={[styles.supportBtn, { backgroundColor: theme.tint }]}
                  onPress={() => Linking.openURL(`tel:${supportPhone.replace(/\s+/g, '')}`)}
                >
                  <Ionicons name="call" size={18} color="#fff" />
                  <ThemedText style={{ color: '#fff' }} type="smallBold">{supportPhone}</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Feature({ icon, label, bg, color, tint }: { icon: keyof typeof Ionicons.glyphMap; label: string; bg: string; color: string; tint: string }) {
  return (
    <View style={[styles.feature, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={14} color={tint} />
      <ThemedText style={[styles.featureText, { color }]}>{label}</ThemedText>
    </View>
  );
}

// Sunucudan gün adı bazen küçük harfle geliyor ("perşembe") — Türkçe kurala göre büyüt.
function capitalize(s: string) {
  return s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : s;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: Spacing.two, paddingBottom: Spacing.one, gap: Spacing.three },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  brandLogo: { width: 34, height: 34, borderRadius: 17 },
  brandName: { fontSize: 13, lineHeight: 16, fontWeight: '900', letterSpacing: 1.6 },
  loginBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderRadius: 999, paddingHorizontal: Spacing.two + 4, paddingVertical: 6,
  },
  loginText: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  titleBlock: { gap: 2 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 20 },
  ctaBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, borderRadius: 18, padding: Spacing.three },
  ctaIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '800' },
  ctaText: { color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 17 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three + 4 },
  // Ürün kartlarıyla aynı: çerçevesiz dolu yüzey + sıcak, hafif gölge.
  card: { borderRadius: 22, overflow: 'hidden' },
  shadow: {
    shadowColor: '#7a4a1c',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  shadowDark: { shadowColor: '#000', shadowOpacity: 0.4 },
  cardImageWrap: { height: 176, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardLogo: { width: 92, height: 92, borderRadius: 46, marginBottom: Spacing.five },
  closedVeil: { backgroundColor: 'rgba(40, 30, 20, 0.35)' },
  pill: {
    position: 'absolute', top: Spacing.three - 4,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 5,
  },
  dayPill: { left: Spacing.three - 4 },
  statusPill: { right: Spacing.three - 4 },
  pillText: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  imageCaption: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.three - 2, gap: 2 },
  marketName: {
    color: '#fff', fontSize: 23, lineHeight: 28, fontWeight: '900', letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locationText: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 17, fontWeight: '600', flexShrink: 1 },
  cardBody: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three - 2, paddingBottom: Spacing.three, gap: Spacing.three - 2 },
  featureRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 5 },
  featureText: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 1, marginLeft: 'auto' },
  linkText: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: Spacing.two + 2 },
  actionBtn: {
    flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two,
    borderRadius: 999,
  },
  actionText: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  mapBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { borderRadius: 18, padding: Spacing.five, alignItems: 'center', gap: Spacing.two },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCenterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  neighborhoodsBox: { width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 22, padding: Spacing.three + 2 },
  neighborhoodsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, marginBottom: Spacing.three },
  modalIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  neighborhoodsList: { flexGrow: 0 },
  neighborhoodsChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two - 2 },
  neighborhoodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 6,
  },
  supportBox: { marginTop: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, alignItems: 'center' },
  supportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 999, paddingVertical: Spacing.two + 2, width: '100%',
  },
});
