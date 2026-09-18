import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface CourierStats {
  is_online: boolean;
  per_package_fee: number;
  total_delivered: number;
  day_delivered: number;
  day_earnings: number;
  total_earnings: number;
}

interface OrderItem {
  name: string;
  qty: number;
  unit: string;
  note?: string;
}

interface CourierOrder {
  tx_id: string;
  order_status: string;
  market_name: string;
  amount?: number;
  address?: string;
  delivery_neighborhood?: string;
  user_name?: string;
  customer_phone?: string;
  items: OrderItem[];
}

function money(n?: number) {
  if (n == null) return '—';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KuryeHome() {
  const theme = useTheme();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<CourierStats | null>(null);
  const [orders, setOrders] = useState<CourierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [busyTx, setBusyTx] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<CourierStats>('/courier/stats'),
      api.get<{ orders: CourierOrder[] }>('/courier/orders'),
    ])
      .then(([s, o]) => {
        setStats(s);
        setOrders(o.orders);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleOnline(value: boolean) {
    setToggling(true);
    try {
      await api.put('/courier/toggle-online', { is_online: value });
      setStats((s) => (s ? { ...s, is_online: value } : s));
    } catch {
      // sessizce başarısız - kullanıcı tekrar deneyebilir
    } finally {
      setToggling(false);
    }
  }

  async function depart(txId: string) {
    setBusyTx(txId);
    setActionError((e) => ({ ...e, [txId]: '' }));
    try {
      await api.post(`/courier/orders/${txId}/depart`);
      load();
    } catch (err) {
      setActionError((e) => ({ ...e, [txId]: err instanceof ApiError ? err.message : 'Başarısız' }));
    } finally {
      setBusyTx(null);
    }
  }

  async function verifyCode(txId: string) {
    const code = (codeInputs[txId] ?? '').trim();
    if (!code) {
      setActionError((e) => ({ ...e, [txId]: 'Müşterinin SMS ile aldığı kodu gir' }));
      return;
    }
    setBusyTx(txId);
    setActionError((e) => ({ ...e, [txId]: '' }));
    try {
      await api.post(`/courier/orders/${txId}/verify-delivery-code`, { code });
      load();
    } catch (err) {
      setActionError((e) => ({ ...e, [txId]: err instanceof ApiError ? err.message : 'Kod hatalı' }));
    } finally {
      setBusyTx(null);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="title" style={{ fontSize: 22 }}>Merhaba, {user?.name}</ThemedText>

        <View style={[styles.card, { backgroundColor: theme.authCard }]}>
          <View style={styles.rowBetween}>
            <ThemedText type="smallBold">{stats?.is_online ? 'Çevrimiçi' : 'Çevrimdışı'}</ThemedText>
            <Switch value={!!stats?.is_online} onValueChange={toggleOnline} disabled={toggling} />
          </View>
          {stats && (
            <View style={styles.statRow}>
              <View><ThemedText type="small" themeColor="textSecondary">Bugün</ThemedText><ThemedText type="smallBold">{stats.day_delivered} teslim</ThemedText></View>
              <View><ThemedText type="small" themeColor="textSecondary">Bugün Kazanç</ThemedText><ThemedText type="smallBold" themeColor="tint">{money(stats.day_earnings)}</ThemedText></View>
              <View><ThemedText type="small" themeColor="textSecondary">Toplam</ThemedText><ThemedText type="smallBold">{money(stats.total_earnings)}</ThemedText></View>
            </View>
          )}
        </View>

        <Pressable onPress={() => router.push('/kurye/gecmis')}>
          <ThemedText themeColor="tint" type="small">Teslim Geçmişi →</ThemedText>
        </Pressable>

        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        <ThemedText type="smallBold">Aktif Siparişler ({orders.length})</ThemedText>
        {orders.map((o) => (
          <View key={o.tx_id} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{o.market_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{o.order_status}</ThemedText>
            </View>
            <ThemedText type="small">{o.user_name} {o.customer_phone ? `· ${o.customer_phone}` : ''}</ThemedText>
            {o.address && <ThemedText type="small" themeColor="textSecondary">{o.address}</ThemedText>}
            {o.items.map((it, i) => (
              <ThemedText key={i} type="small" themeColor="textSecondary">{it.name} × {it.qty} {it.unit}</ThemedText>
            ))}

            {o.customer_phone && (
              <Pressable onPress={() => Linking.openURL(`tel:${o.customer_phone}`)}>
                <ThemedText themeColor="tint" type="small">📞 Müşteriyi Ara</ThemedText>
              </Pressable>
            )}

            {o.order_status === 'hazir' && (
              <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={() => depart(o.tx_id)} disabled={busyTx === o.tx_id}>
                <ThemedText style={{ color: '#fff' }} type="smallBold">Yola Çıktım</ThemedText>
              </Pressable>
            )}

            {o.order_status === 'yolda' && (
              <View style={{ gap: 6 }}>
                <TextInput
                  value={codeInputs[o.tx_id] ?? ''}
                  onChangeText={(v) => setCodeInputs((c) => ({ ...c, [o.tx_id]: v }))}
                  placeholder="Teslim kodu (müşteriden al)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
                />
                <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={() => verifyCode(o.tx_id)} disabled={busyTx === o.tx_id}>
                  <ThemedText style={{ color: '#fff' }} type="smallBold">Teslim Ettim</ThemedText>
                </Pressable>
              </View>
            )}
            {!!actionError[o.tx_id] && <ThemedText themeColor="danger" type="small">{actionError[o.tx_id]}</ThemedText>}
          </View>
        ))}
        {!loading && orders.length === 0 && (
          <ThemedText themeColor="textSecondary">Şu an aktif sipariş yok.</ThemedText>
        )}

        <Pressable style={[styles.outlineBtn, { borderColor: theme.danger, marginTop: Spacing.four }]} onPress={logout}>
          <ThemedText themeColor="danger" type="smallBold">Çıkış Yap</ThemedText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  smallBtn: { borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  outlineBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center' },
});
