import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useMarkets } from '@/lib/markets-context';
import { fetchSettings } from '@/lib/settings';
import { IconGreen, Spacing } from '@/constants/theme';
import type { Market } from '@/lib/types';

const WALLPAPER_CARD = require('@/assets/brand/wallpaper-light.jpg');
const LOGO = require('@/assets/brand/logo.png');

/**
 * "Olduğumuz Pazarlar" — uygulamanın kök ekranı. Sekme çubuğu YOK; üye
 * olmayan biri sadece bu ekranı görür. Bir pazarda "Siparişe Başla"'ya
 * basınca /pazar/[id] altındaki sekmeli (Kampanyalar/Sepet/Profil) alışveriş
 * bölümüne girilir.
 */
export default function MarketsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { markets, loading } = useMarkets();
  const [supportPhone, setSupportPhone] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetchSettings().then((s) => setSupportPhone(s.support_phone));
  }, []);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <ThemedText type="title" style={styles.title}>
              Olduğumuz Pazarlar
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              Hangi gün, hangi pazardayız?
            </ThemedText>
          </View>
          {!authLoading && !user && (
            <Pressable style={[styles.memberBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/giris')}>
              <Ionicons name="person-outline" size={21} color="#fff" />
              <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                Üye Ol / Giriş Yap
              </ThemedText>
            </Pressable>
          )}
        </View>

        {!authLoading && !user && (
          <Pressable style={[styles.ctaBanner, { backgroundColor: theme.tint }]} onPress={() => router.push('/kayit')}>
            <View style={styles.ctaIcon}>
              <Ionicons name="person-add-outline" size={27} color="#fff" />
            </View>
            <View style={styles.flex}>
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Hemen Üye Olun!
              </ThemedText>
              <ThemedText style={{ color: '#fff' }} type="small">
                Avantajlı fiyatlar ve kuponlar için ücretsiz kayıt olun
              </ThemedText>
            </View>
            <ThemedText style={{ color: '#fff', fontSize: 18 }}>›</ThemedText>
          </Pressable>
        )}
      </View>

      <FlatList
        style={styles.flex}
        data={loading ? [] : markets}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <MarketCard market={item} supportPhone={supportPhone} isMember={!!user} />}
        ListEmptyComponent={
          <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">{loading ? 'Yükleniyor…' : 'Şu an açık pazar yok.'}</ThemedText>
          </View>
        }
      />
    </Screen>
  );
}

function MarketCard({ market, supportPhone, isMember }: { market: Market; supportPhone?: string; isMember: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const [neighborhoodsOpen, setNeighborhoodsOpen] = useState(false);
  // Not: delivery_neighborhoods boşsa "her mahalleye servis var" demektir
  // (bkz. lib/addresses.ts addressServesMarket) — bu yüzden burada mahalle
  // sayısı şartı ARANMIYOR, sepetteki asıl uygunluk kontrolüyle (sepet.tsx
  // eveServisAvailable) aynı iki alana bakılıyor.
  const hasDelivery = !!(market.active_eve_servis && market.delivery_enabled);
  const mapUrl = market.google_maps_url || market.location_url;
  const showRealImage = market.image_url && !imageFailed;

  return (
    <View style={styles.card}>
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
            <Image source={WALLPAPER_CARD} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <Image source={LOGO} style={styles.cardLogo} resizeMode="contain" />
          </>
        )}
        <View style={[styles.dayBadge, { backgroundColor: theme.tint }]}>
          <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
            ✓ {market.day}
          </ThemedText>
        </View>
      </View>

      <View style={styles.cardBody}>
        <ThemedText type="smallBold" style={[styles.marketName, styles.onDark]}>
          {market.name}
        </ThemedText>
        {hasDelivery && (
          <Pressable onPress={() => setNeighborhoodsOpen(true)} hitSlop={6}>
            <ThemedText themeColor="tint" type="small" style={styles.underline}>
              Evlere Servisimiz Olan Mahalleler
            </ThemedText>
          </Pressable>
        )}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: market.orders_enabled ? theme.tint : '#2a2f2c' }]}
            disabled={!market.orders_enabled}
            onPress={() => router.push(isMember ? `/pazar/${market.id}` : '/giris')}
          >
            <Ionicons name={isMember ? 'cart-outline' : 'lock-closed-outline'} size={21} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
              {!market.orders_enabled ? 'Şu an kapalı' : isMember ? 'Siparişe Başla' : 'Üye Girişi Gerekli'}
            </ThemedText>
          </Pressable>
          {mapUrl ? (
            <Pressable style={styles.actionBtnOutline} onPress={() => Linking.openURL(mapUrl)}>
              <Ionicons name="location-outline" size={21} color={IconGreen} />
              <ThemedText type="small" style={styles.onDark}>Konum</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.actionBtnOutline}>
              <Ionicons name="location-outline" size={21} color={IconGreen} />
              <ThemedText type="small" style={styles.onDarkSecondary}>
                Konum
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      <Modal visible={neighborhoodsOpen} transparent animationType="fade" onRequestClose={() => setNeighborhoodsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setNeighborhoodsOpen(false)} />
        <View style={styles.modalCenterWrap} pointerEvents="box-none">
          <View style={[styles.neighborhoodsBox, { backgroundColor: theme.background, borderColor: theme.tint }]}>
            <View style={styles.neighborhoodsHeaderRow}>
              <Ionicons name="location-outline" size={20} color={IconGreen} />
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
                    <View key={n} style={[styles.neighborhoodChip, { borderColor: theme.tint }]}>
                      <Ionicons name="checkmark-circle" size={14} color={IconGreen} />
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: Spacing.three, gap: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 28 },
  memberBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2 },
  ctaBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.two },
  ctaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Spacing.three, paddingTop: 0 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: '#2a2f2c', overflow: 'hidden' },
  cardImageWrap: { height: 130, alignItems: 'center', justifyContent: 'center' },
  cardLogo: { width: 88, height: 88, borderRadius: 44 },
  dayBadge: { position: 'absolute', top: Spacing.two, right: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  // Kart alt bilgi şeridi her zaman koyu — fotoğrafın üstündeki kontrast için,
  // açık/koyu tema seçiminden bağımsız (gerçek sitedeki gibi).
  cardBody: { padding: Spacing.three, gap: 6, backgroundColor: '#0d1410' },
  onDark: { color: '#f2f5ef' },
  onDarkSecondary: { color: '#9aa39c' },
  marketName: { fontSize: 17 },
  underline: { textDecorationLine: 'underline' },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 999, paddingVertical: Spacing.two },
  actionBtnOutline: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 999, borderWidth: 1.5, borderColor: '#3a423b', paddingVertical: Spacing.two },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', margin: Spacing.three },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCenterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  neighborhoodsBox: { width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 18, borderWidth: 1.5, padding: Spacing.three },
  neighborhoodsHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  neighborhoodsList: { flexGrow: 0 },
  neighborhoodsChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  neighborhoodChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6,
  },
  supportBox: { marginTop: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, alignItems: 'center' },
  supportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 999, paddingVertical: Spacing.two + 2, width: '100%',
  },
});
