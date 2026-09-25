import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchCampaigns } from '@/lib/campaigns';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Campaign } from '@/lib/types';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

// Diğer ekranlarla aynı: çerçevesiz dolu kart + sıcak gölge, duvar kağıdında hafif perde.
const CARD_BG_DARK = '#0e1411';
const CARD_BG_LIGHT = '#f8ebd6';
const LIST_SCRIM_DARK = 'rgba(0, 0, 0, 0.55)';
const LIST_SCRIM_LIGHT = 'rgba(232, 201, 158, 0.32)';
// Görselin alt kısmını koyulaştırır: başlık görselin üstünde okunur (ana sayfa pazar kartıyla aynı).
const IMAGE_FADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.75)'] as const;

export default function CampaignsScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCampaigns().then((res) => {
      if (cancelled) return;
      setCampaigns(res.campaigns);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cardBg = isDark ? CARD_BG_DARK : CARD_BG_LIGHT;

  return (
    <Screen>
      <View style={[styles.flex, { backgroundColor: isDark ? LIST_SCRIM_DARK : LIST_SCRIM_LIGHT }]}>
        <FlatList
          style={styles.flex}
          data={loading ? [] : campaigns}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.flex}>
                <ThemedText style={styles.title}>Kampanyalar</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.subtitle}>Pazarın güncel fırsatları</ThemedText>
              </View>
              <Image source={isDark ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT} style={styles.logoBadge} resizeMode="contain" />
            </View>
          }
          renderItem={({ item }) => <CampaignCard item={item} cardBg={cardBg} />}
          ListEmptyComponent={
            <View style={[styles.card, styles.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
              {loading ? (
                <ActivityIndicator color={theme.tint} />
              ) : (
                <>
                  <View style={[styles.emptyIcon, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                    <MaterialCommunityIcons name="bullhorn-outline" size={34} color={theme.tint} />
                  </View>
                  <ThemedText style={styles.emptyTitle}>Şu an aktif kampanya yok</ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.emptyText}>
                    Yeni fırsatlar eklendiğinde burada göreceksin.
                  </ThemedText>
                </>
              )}
            </View>
          }
        />
      </View>
    </Screen>
  );
}

function CampaignCard({ item, cardBg }: { item: Campaign; cardBg: string }) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image_url && !imageFailed;
  // Görselin üstündeki "Üyelere özel" hapı: açık temada krem, koyu temada siyah cam.
  const pillBg = isDark ? 'rgba(10, 14, 12, 0.72)' : withAlpha(theme.background, 0.94);

  return (
    <View style={[styles.card, styles.shadow, isDark && styles.shadowDark, { backgroundColor: cardBg }]}>
      <View style={[styles.imageWrap, { backgroundColor: theme.tintSoft }]}>
        {showImage ? (
          <Image source={{ uri: item.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setImageFailed(true)} />
        ) : (
          <MaterialCommunityIcons name="bullhorn-outline" size={56} color={withAlpha(theme.tint, 0.6)} style={styles.fallbackIcon} />
        )}
        <LinearGradient colors={IMAGE_FADE} locations={[0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />

        {!!item.discount_text && (
          <View style={[styles.pill, styles.pillLeft, { backgroundColor: theme.tint }]}>
            <MaterialCommunityIcons name="tag" size={13} color="#fff" />
            <ThemedText style={[styles.pillText, { color: '#fff' }]}>{item.discount_text}</ThemedText>
          </View>
        )}
        {item.members_only && (
          <View style={[styles.pill, styles.pillRight, { backgroundColor: pillBg }]}>
            <Ionicons name="person" size={12} color={theme.tint} />
            <ThemedText style={[styles.pillText, { color: theme.text }]}>Üyelere özel</ThemedText>
          </View>
        )}

        <ThemedText numberOfLines={2} style={styles.cardTitle}>{item.title}</ThemedText>
      </View>

      {!!item.description && (
        <View style={styles.body}>
          <ThemedText themeColor="textSecondary" style={styles.description}>{item.description}</ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.one },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 17 },
  logoBadge: { width: 48, height: 48 },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.three + 2, paddingBottom: Spacing.six + Spacing.five },
  card: { borderRadius: 22, overflow: 'hidden' },
  shadow: { shadowColor: '#7a4a1c', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 4 },
  shadowDark: { shadowColor: '#000', shadowOpacity: 0.4 },
  imageWrap: { height: 170, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fallbackIcon: { marginBottom: Spacing.four },
  pill: {
    position: 'absolute', top: Spacing.three - 4,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 5,
  },
  pillLeft: { left: Spacing.three - 4 },
  pillRight: { right: Spacing.three - 4 },
  pillText: { fontSize: 12, lineHeight: 15, fontWeight: '900' },
  cardTitle: {
    position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.three - 2,
    color: '#fff', fontSize: 20, lineHeight: 25, fontWeight: '900', letterSpacing: -0.4,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  body: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three - 2, paddingBottom: Spacing.three },
  description: { fontSize: 14, lineHeight: 20 },
  emptyCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  emptyTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900', textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
});
