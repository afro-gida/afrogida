import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Courier {
  user_id: string;
  name: string;
  phone: string;
  is_online: boolean;
  markets: string[];
}

export default function SorumluKuryeler() {
  const theme = useTheme();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .get<Courier[]>('/pazar-sorumlusu/couriers')
      .then(setCouriers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {couriers.map((c) => (
          <View key={c.user_id} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{c.name || 'Kurye'}</ThemedText>
              <View style={[styles.badge, { backgroundColor: c.is_online ? theme.tintSoft : theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor={c.is_online ? 'tint' : 'textSecondary'}>
                  {c.is_online ? 'Çevrimiçi' : 'Çevrimdışı'}
                </ThemedText>
              </View>
            </View>
            {!!c.phone && <ThemedText type="small" themeColor="textSecondary">{c.phone}</ThemedText>}
          </View>
        ))}
        {!loading && couriers.length === 0 && (
          <ThemedText themeColor="textSecondary">Pazarında kayıtlı kurye yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
});
