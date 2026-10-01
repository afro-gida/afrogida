import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { formatMoney as money } from '@/lib/format';
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
  payment_method?: string;
  market_name: string;
  amount?: number;
  address?: string;
  delivery_neighborhood?: string;
  user_name?: string;
  customer_phone?: string;
  items: OrderItem[];
}

const STATUS_LABEL: Record<string, string> = {
  talep_alindi: 'Sipariş alındı',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır · teslim al',
  yolda: 'Yolda',
};

// Sunucu adresin sonuna "Konum: https://www.google.com/maps?q=LAT,LNG" ekliyor
// (müşterinin haritada işaretlediği kapı girişi).
const KONUM_RE = /\n?Konum:\s*https?:\/\/\S*maps\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\S*/;

function splitAddress(raw = '') {
  const m = raw.match(KONUM_RE);
  return {
    text: raw.replace(KONUM_RE, '').trim(),
    coords: m ? { lat: m[1], lng: m[2] } : null,
  };
}

function openUrl(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else Linking.openURL(url);
}

/** Yol tarifi: işaretli kapı konumu varsa oraya, yoksa adres metniyle. Telefonda Google Haritalar açılır. */
function openDirections(addressText: string, coords: { lat: string; lng: string } | null) {
  const dest = coords ? `${coords.lat},${coords.lng}` : encodeURIComponent(addressText.replace(/\n/g, ' '));
  openUrl(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`);
}

/** "905380557577" / "05380557577" -> tel bağlantısı + okunur biçim "0538 055 75 77". */
function phoneParts(raw = '') {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('90')) d = d.slice(2);
  if (d.length === 10) d = '0' + d;
  const pretty = d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : raw;
  return { tel: d.length === 11 ? `+90${d.slice(1)}` : raw, pretty };
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

        <View style={styles.rowBetween}>
          <ThemedText type="smallBold">Aktif Siparişler ({orders.length})</ThemedText>
          <Pressable onPress={load} disabled={loading} hitSlop={8} style={[styles.refreshBtn, { borderColor: theme.border }]}>
            {loading ? <ActivityIndicator size="small" color={theme.tint} /> : <Ionicons name="refresh" size={16} color={theme.tint} />}
            <ThemedText type="small" themeColor="tint">Yenile</ThemedText>
          </Pressable>
        </View>
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {orders.map((o) => {
          const addr = splitAddress(o.address);
          const phone = o.customer_phone ? phoneParts(o.customer_phone) : null;
          const paidOnline = o.payment_method === 'online_card';
          return (
            <View key={o.tx_id} style={[styles.card, { backgroundColor: theme.authCard }]}>
              <View style={styles.rowBetween}>
                <ThemedText type="smallBold">{o.market_name}</ThemedText>
                <View style={[styles.statusChip, { backgroundColor: o.order_status === 'yolda' ? theme.tint : theme.tintSoft }]}>
                  <ThemedText type="small" style={{ fontWeight: '700', color: o.order_status === 'yolda' ? '#fff' : theme.text }}>
                    {STATUS_LABEL[o.order_status] ?? o.order_status}
                  </ThemedText>
                </View>
              </View>

              <ThemedText type="smallBold" style={{ fontSize: 16 }}>{o.user_name}</ThemedText>
              {!!addr.text && (
                <View style={styles.addrRow}>
                  <Ionicons name="location-outline" size={18} color={theme.tint} style={{ marginTop: 1 }} />
                  <ThemedText type="small" style={{ flex: 1 }}>{addr.text}</ThemedText>
                </View>
              )}

              {/* Büyük butonlar: yol tarifi + arama (kurye yoldayken tek dokunuşla) */}
              <View style={styles.actionRow}>
                {!!addr.text && (
                  <Pressable
                    onPress={() => openDirections(addr.text, addr.coords)}
                    style={({ pressed }) => [styles.bigBtn, { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Ionicons name="navigate" size={20} color="#fff" />
                    <View>
                      <ThemedText type="smallBold" style={{ color: '#fff' }}>Yol Tarifi</ThemedText>
                      <ThemedText type="small" style={{ color: '#fff', opacity: 0.9, fontSize: 11 }}>
                        {addr.coords ? 'Kapı konumuna' : 'Adrese göre'}
                      </ThemedText>
                    </View>
                  </Pressable>
                )}
                {!!phone && (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${phone.tel}`)}
                    style={({ pressed }) => [styles.bigBtn, styles.callBtn, { borderColor: theme.tint, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Ionicons name="call" size={20} color={theme.tint} />
                    <View>
                      <ThemedText type="smallBold" themeColor="tint">Müşteriyi Ara</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>{phone.pretty}</ThemedText>
                    </View>
                  </Pressable>
                )}
              </View>

              {o.amount != null && (
                <View style={[styles.payRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <Ionicons name={paidOnline ? 'card-outline' : 'cash-outline'} size={18} color={paidOnline ? theme.textSecondary : theme.tint} />
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {paidOnline ? 'Online ödendi' : 'Kapıda tahsil edilecek'}
                  </ThemedText>
                  <ThemedText type="smallBold" themeColor={paidOnline ? 'textSecondary' : 'tint'}>{money(o.amount)}</ThemedText>
                </View>
              )}

              {o.items.map((it, i) => (
                <ThemedText key={i} type="small" themeColor="textSecondary">• {it.name} × {it.qty} {it.unit}</ThemedText>
              ))}

              {o.order_status === 'hazir' && (
                <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={() => depart(o.tx_id)} disabled={busyTx === o.tx_id}>
                  <ThemedText style={{ color: '#fff' }} type="smallBold">Yola Çıktım</ThemedText>
                </Pressable>
              )}

              {o.order_status === 'yolda' && (
                <View style={{ gap: 6 }}>
                  <TextInput
                    value={codeInputs[o.tx_id] ?? ''}
                    onChangeText={(v) => setCodeInputs((c) => ({ ...c, [o.tx_id]: v.replace(/\D/g, '') }))}
                    placeholder="Teslim kodu (müşteriden al)"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
                  />
                  <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={() => verifyCode(o.tx_id)} disabled={busyTx === o.tx_id}>
                    <ThemedText style={{ color: '#fff' }} type="smallBold">Teslim Ettim</ThemedText>
                  </Pressable>
                </View>
              )}
              {!!actionError[o.tx_id] && <ThemedText themeColor="danger" type="small">{actionError[o.tx_id]}</ThemedText>}
            </View>
          );
        })}
        {!loading && orders.length === 0 && (
          <ThemedText themeColor="textSecondary">Şu an aktif sipariş yok.</ThemedText>
        )}

        <Pressable style={[styles.outlineBtn, { borderColor: theme.danger, marginTop: Spacing.four }]} onPress={() => logout()}>
          <ThemedText themeColor="danger" type="smallBold">Çıkış Yap</ThemedText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  statusChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  addrRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: 2 },
  bigBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  callBtn: { borderWidth: 1.5 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  smallBtn: { borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  outlineBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center' },
});
