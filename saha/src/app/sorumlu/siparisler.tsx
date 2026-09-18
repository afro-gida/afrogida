import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface OrderItem {
  name: string;
  qty: number;
  unit: string;
}

interface Order {
  tx_id: string;
  order_status: string;
  delivery_type: string;
  market_name: string;
  amount?: number | null;
  user_name: string;
  items: OrderItem[];
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  talep_alindi: 'Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};

const STATUS_COLORS: Record<string, string> = {
  teslim_edildi: 'tint',
  iptal_edildi: 'danger',
};

function money(n?: number | null) {
  if (n == null) return '—';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SorumluSiparisler() {
  const theme = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .get<Order[]>('/pazar-sorumlusu/orders')
      .then(setOrders)
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
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{o.user_name || 'Müşteri'}</ThemedText>
              <ThemedText type="small" themeColor={(STATUS_COLORS[o.order_status] as 'tint' | 'danger') ?? 'textSecondary'}>
                {STATUS_LABELS[o.order_status] ?? o.order_status}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {o.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} · {formatDate(o.created_at)}
            </ThemedText>
            <View style={{ gap: 2, marginTop: 2 }}>
              {o.items.map((it, i) => (
                <ThemedText key={i} type="small" themeColor="textSecondary">
                  {it.qty} {it.unit} · {it.name}
                </ThemedText>
              ))}
            </View>
            <ThemedText type="small" themeColor="tint" style={{ marginTop: 2 }}>
              {money(o.amount)}
            </ThemedText>
          </View>
        ))}
        {!loading && orders.length === 0 && (
          <ThemedText themeColor="textSecondary">Pazarında henüz sipariş yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
