import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Market {
  id: string;
  name: string;
}

export default function SorumluHome() {
  const theme = useTheme();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Market[]>('/pazar-sorumlusu/markets')
      .then(setMarkets)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  const marketNames = markets.map((m) => m.name).join(', ');

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () =>
            marketNames ? (
              <ThemedText type="small" themeColor="tint" numberOfLines={1} style={styles.headerMarketName}>
                {marketNames}
              </ThemedText>
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="title" style={{ fontSize: 22 }}>Merhaba, {user?.name}</ThemedText>

        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        <View style={styles.chipRow}>
          {markets.map((m) => (
            <View key={m.id} style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
              <ThemedText type="small" style={{ color: theme.tint, fontWeight: '700' }}>{m.name}</ThemedText>
            </View>
          ))}
        </View>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/sorumlu/siparisler')}>
          <ThemedText type="smallBold">🧾 Sipariş Takip</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Pazarındaki siparişleri gör</ThemedText>
        </Pressable>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/sorumlu/tedarikciler')}>
          <ThemedText type="smallBold">🏪 Tedarikçiler</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Pazarındaki tedarikçileri ve ürünlerini gör</ThemedText>
        </Pressable>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/sorumlu/tedarikci-ekle')}>
          <ThemedText type="smallBold">➕ Tedarikçi Ekle / Düzenle</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Pazara tedarikçi ata veya kaldır</ThemedText>
        </Pressable>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/sorumlu/kuryeler')}>
          <ThemedText type="smallBold">🛵 Kuryeler</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Pazarındaki kuryeleri gör</ThemedText>
        </Pressable>

        <Pressable style={[styles.outlineBtn, { borderColor: theme.danger, marginTop: Spacing.four }]} onPress={logout}>
          <ThemedText themeColor="danger" type="smallBold">Çıkış Yap</ThemedText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  outlineBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center' },
  headerMarketName: { maxWidth: 160, marginRight: Spacing.two, fontWeight: '700' },
});
