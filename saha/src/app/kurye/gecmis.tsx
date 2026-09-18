import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface HistoryOrder {
  tx_id: string;
  market_name: string;
  amount?: number;
  user_name?: string;
  delivered_at?: string;
}

function dateTime(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GecmisScreen() {
  const theme = useTheme();
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ orders: HistoryOrder[] }>('/courier/orders/history')
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {orders.map((o) => (
          <View key={o.tx_id} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <ThemedText type="smallBold">{o.market_name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{o.user_name} · {dateTime(o.delivered_at)}</ThemedText>
          </View>
        ))}
        {!loading && orders.length === 0 && (
          <ThemedText themeColor="textSecondary">Henüz teslimat geçmişin yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
});
