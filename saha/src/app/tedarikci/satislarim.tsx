import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface SaleItem {
  name?: string;
  product_name?: string;
  qty?: number;
  quantity?: number;
  unit?: string;
  price?: number;
  unit_price?: number;
}

interface SaleLog {
  date?: string;
  delivery_type?: string;
  items: SaleItem[];
  subtotal: number;
  refunded: boolean;
  refunded_amount: number;
  refund_label?: string;
  net: number;
}

interface MySales {
  supplier: string;
  order_count: number;
  total_sold: number;
  total_refunded: number;
  net_total: number;
  log: SaleLog[];
}

function money(n?: number) {
  if (n == null) return '—';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateTime(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SatislarimScreen() {
  const theme = useTheme();
  const [data, setData] = useState<MySales | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<MySales>('/supplier/my-sales')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Satışlar yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {data && (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.statRow}>
              <View><ThemedText themeColor="textSecondary" type="small">Sipariş</ThemedText><ThemedText type="smallBold">{data.order_count}</ThemedText></View>
              <View><ThemedText themeColor="textSecondary" type="small">Toplam Satış</ThemedText><ThemedText type="smallBold">{money(data.total_sold)}</ThemedText></View>
              <View><ThemedText themeColor="textSecondary" type="small">Net</ThemedText><ThemedText type="smallBold" themeColor="tint">{money(data.net_total)}</ThemedText></View>
            </View>
          </View>
        )}

        {(data?.log ?? []).map((s, i) => (
          <View key={i} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="small" themeColor="textSecondary">{dateTime(s.date)}</ThemedText>
              <ThemedText type="smallBold">{money(s.net)}</ThemedText>
            </View>
            {s.items.map((it, ii) => (
              <ThemedText key={ii} type="small" themeColor="textSecondary">
                {it.name ?? it.product_name ?? 'Ürün'} × {it.qty ?? it.quantity ?? 1} {it.unit ?? ''}
              </ThemedText>
            ))}
            {s.refunded && (
              <ThemedText type="small" themeColor="danger">{s.refund_label || 'İade edildi'} (-{money(s.refunded_amount)})</ThemedText>
            )}
          </View>
        ))}
        {!loading && (data?.log.length ?? 0) === 0 && (
          <ThemedText themeColor="textSecondary">Henüz satış kaydın yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
