import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { ThemeColor } from '@/constants/theme';

export interface OrderItem {
  name: string;
  qty: number;
  unit: string;
  note: string;
  selected_options: { title: string; label: string; price_delta: number }[];
  supplier_group: string;
}

export interface SorumluOrder {
  tx_id: string;
  order_status: string;
  payment_status: string;
  payment_method: string;
  delivery_type: string;
  market_name: string;
  amount?: number | null;
  delivery_fee?: number | null;
  user_name: string;
  customer_phone_masked: string;
  items: OrderItem[];
  created_at: string;
  delivery_slot_start?: string | null;
  delivery_slot_end?: string | null;
  delivered_at?: string | null;
  courier_id?: string | null;
  courier_name?: string | null;
  refund_status?: string | null;
  refund_amount?: number | null;
  cancel_reason?: string | null;
  return_request?: { item_names: string[]; reason: string; requested_by_name: string; requested_at: string } | null;
}

const PERIOD_FILTERS: { value: string; label: string }[] = [
  { value: 'today', label: 'Bugün' },
  { value: 'last_7_days', label: 'Son 7 Gün' },
  { value: 'last_1_month', label: 'Son 1 Ay' },
  { value: 'all_time', label: 'Tüm Zamanlar' },
];

const STATUS_LABELS: Record<string, string> = {
  talep_alindi: 'Talep Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};

const CANCELLED = new Set(['iptal_edildi', 'teslim_alinmadi', 'musteri_gelmedi_iptal']);

function statusColor(status: string): ThemeColor {
  if (status === 'teslim_edildi') return 'tint';
  if (CANCELLED.has(status)) return 'danger';
  return 'textSecondary';
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'talep_alindi', label: 'Yeni Sipariş' },
  { value: 'hazirlaniyor', label: 'Hazırlanıyor' },
  { value: 'yolda', label: 'Yolda' },
  { value: 'teslim_edildi', label: 'Teslim Edildi' },
  { value: 'iptal', label: 'İptal' },
];

function matchesStatusTab(tab: string, status: string) {
  if (tab === 'all') return true;
  if (tab === 'hazirlaniyor') return status === 'hazirlaniyor' || status === 'hazirlik_bekliyor' || status === 'hazir';
  if (tab === 'iptal') return CANCELLED.has(status);
  return status === tab;
}

function money(n?: number | null) {
  if (n == null) return '—';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function dayGroupLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', weekday: 'short' });
}

export default function SorumluSiparisler() {
  const theme = useTheme();
  const router = useRouter();
  const [period, setPeriod] = useState('today');
  const [statusTab, setStatusTab] = useState('all');
  const [orders, setOrders] = useState<SorumluOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get<SorumluOrder[]>(`/pazar-sorumlusu/orders?filter_type=${period}`)
      .then(setOrders)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, [period]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of STATUS_TABS) counts[tab.value] = orders.filter((o) => matchesStatusTab(tab.value, o.order_status)).length;
    return counts;
  }, [orders]);

  const filtered = useMemo(() => orders.filter((o) => matchesStatusTab(statusTab, o.order_status)), [orders, statusTab]);

  const groups = useMemo(() => {
    const map = new Map<string, SorumluOrder[]>();
    for (const o of filtered) {
      const key = dayGroupLabel(o.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.chipRow}>
          {PERIOD_FILTERS.map((f) => (
            <Pressable
              key={f.value}
              style={[styles.pill, { borderColor: theme.tint, backgroundColor: period === f.value ? theme.tint : 'transparent' }]}
              onPress={() => setPeriod(f.value)}
            >
              <ThemedText type="small" style={{ color: period === f.value ? '#fff' : theme.text }}>{f.label}</ThemedText>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {STATUS_TABS.map((t) => (
            <Pressable
              key={t.value}
              style={[styles.pill, { borderColor: theme.tint, backgroundColor: statusTab === t.value ? theme.tint : 'transparent' }]}
              onPress={() => setStatusTab(t.value)}
            >
              <ThemedText type="small" style={{ color: statusTab === t.value ? '#fff' : theme.text }}>
                {t.label} ({tabCounts[t.value] ?? 0})
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {groups.map(([day, dayOrders]) => (
          <View key={day} style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.dayHeader}>{day}</ThemedText>
            {dayOrders.map((o) => (
              <Pressable
                key={o.tx_id}
                style={[styles.card, { backgroundColor: theme.authCard }]}
                onPress={() => router.push(`/sorumlu/siparis/${o.tx_id}`)}
              >
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold">{o.user_name || 'Müşteri'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{o.tx_id} · {formatTime(o.created_at)}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor={statusColor(o.order_status)}>
                    {STATUS_LABELS[o.order_status] ?? o.order_status}
                  </ThemedText>
                </View>
                <View style={styles.rowBetween}>
                  <View style={styles.chipRow}>
                    <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {o.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'}
                      </ThemedText>
                    </View>
                    {!!o.delivery_slot_start && (
                      <View style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
                        <ThemedText type="small" themeColor="tint">{o.delivery_slot_start}-{o.delivery_slot_end}</ThemedText>
                      </View>
                    )}
                  </View>
                  <ThemedText type="smallBold">{money(o.amount)}</ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
        {!loading && filtered.length === 0 && (
          <ThemedText themeColor="textSecondary">Bu aralıkta sipariş bulunamadı.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.three },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  dayHeader: { textAlign: 'center' },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
