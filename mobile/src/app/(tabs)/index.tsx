import { useState } from 'react';
import { FlatList, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useMarkets } from '@/lib/markets-context';
import { Spacing } from '@/constants/theme';
import type { Market } from '@/lib/types';

const WALLPAPER_CARD = require('@/assets/brand/wallpaper-light.jpg');
const LOGO = require('@/assets/brand/logo.png');

export default function MarketsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { markets, loading } = useMarkets();

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
              <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                👤 Üye Ol / Giriş Yap
              </ThemedText>
            </Pressable>
          )}
        </View>

        <View style={styles.pillRow}>
          <View style={[styles.infoPill, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" numberOfLines={1} style={styles.pillText}>
              🏪 Pazar: 00:00-22:00
            </ThemedText>
          </View>
          <View style={[styles.infoPill, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" numberOfLines={1} style={styles.pillText}>
              🕐 Gel-Al: 11:00-19:00
            </ThemedText>
          </View>
        </View>

        {!authLoading && !user && (
          <Pressable style={[styles.ctaBanner, { backgroundColor: theme.tint }]} onPress={() => router.push('/kayit')}>
            <View style={styles.ctaIcon}>
              <ThemedText style={{ fontSize: 18 }}>👤</ThemedText>
            </View>
            <View style={styles.flex}>
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Hemen Üye Olun! 🌱
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
        renderItem={({ item }) => <MarketCard market={item} />}
        ListEmptyComponent={
          <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">{loading ? 'Yükleniyor…' : 'Şu an açık pazar yok.'}</ThemedText>
          </View>
        }
      />
    </Screen>
  );
}

function MarketCard({ market }: { market: Market }) {
  const theme = useTheme();
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const hasDelivery = market.active_eve_servis && (market.delivery_neighborhoods?.length ?? 0) > 0;
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
          <ThemedText themeColor="tint" type="small" style={styles.underline}>
            Evlere Servisimiz Olan Mahalleler
          </ThemedText>
        )}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: market.orders_enabled ? theme.tint : '#2a2f2c' }]}
            disabled={!market.orders_enabled}
            onPress={() => router.push(`/pazar/${market.id}`)}
          >
            <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
              🛒 {market.orders_enabled ? 'Siparişe Başla' : 'Şu an kapalı'}
            </ThemedText>
          </Pressable>
          {mapUrl ? (
            <Pressable style={styles.actionBtnOutline} onPress={() => Linking.openURL(mapUrl)}>
              <ThemedText type="small" style={styles.onDark}>📍 Konum</ThemedText>
            </Pressable>
          ) : (
            <View style={styles.actionBtnOutline}>
              <ThemedText type="small" style={styles.onDarkSecondary}>
                📍 Konum
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: Spacing.three, gap: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 28 },
  memberBtn: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2 },
  pillRow: { flexDirection: 'row', gap: Spacing.two },
  infoPill: { flex: 1, borderRadius: 10, paddingHorizontal: Spacing.one + 2, paddingVertical: Spacing.one + 2, alignItems: 'center' },
  pillText: { fontSize: 12 },
  ctaBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.two },
  ctaIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
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
  actionBtn: { flex: 1, borderRadius: 999, paddingVertical: Spacing.two, alignItems: 'center' },
  actionBtnOutline: { flex: 1, borderRadius: 999, borderWidth: 1.5, borderColor: '#3a423b', paddingVertical: Spacing.two, alignItems: 'center' },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', margin: Spacing.three },
});
