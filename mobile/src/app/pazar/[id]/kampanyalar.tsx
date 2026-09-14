import { useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { fetchCampaigns } from '@/lib/campaigns';
import { Spacing } from '@/constants/theme';
import type { Campaign } from '@/lib/types';

export default function CampaignsScreen() {
  const theme = useTheme();
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

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Kampanyalar</ThemedText>
      </View>
      <FlatList
        style={styles.flex}
        data={loading ? [] : campaigns}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            {item.image_url && (
              <Image source={{ uri: item.image_url }} style={styles.image} resizeMode="cover" />
            )}
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <ThemedText type="smallBold" style={styles.flex}>
                  {item.title}
                </ThemedText>
                {item.discount_text && (
                  <View style={[styles.discountPill, { backgroundColor: theme.accentOrange }]}>
                    <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>
                      {item.discount_text}
                    </ThemedText>
                  </View>
                )}
              </View>
              <ThemedText themeColor="textSecondary" type="small">
                {item.description}
              </ThemedText>
              {item.members_only && (
                <ThemedText themeColor="tint" type="small">
                  👤 Üyelere özel
                </ThemedText>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">
              {loading ? 'Yükleniyor…' : 'Şu an aktif kampanya yok.'}
            </ThemedText>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six + Spacing.four },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  image: { width: '100%', height: 120 },
  body: { padding: Spacing.three, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  discountPill: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.two },
});
