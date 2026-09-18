import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { formatMoney as money } from '@/lib/format';
import { Spacing } from '@/constants/theme';
import type { ThemeColor } from '@/constants/theme';
import type { SorumluOrder } from '../siparisler';

interface Courier {
  user_id: string;
  name: string;
  phone: string;
  is_online: boolean;
  markets: string[];
}

interface OrderDetail extends SorumluOrder {
  delivery_neighborhood?: string;
  address?: string | null;
}

const STATUS_FLOW = ['talep_alindi', 'hazirlik_bekliyor', 'hazirlaniyor', 'hazir', 'yolda', 'teslim_edildi'];
const STATUS_LABELS: Record<string, string> = {
  talep_alindi: 'Sipariş Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};
const STATUS_META: Record<string, { icon: IoniconName; color: string }> = {
  talep_alindi: { icon: 'document-text', color: '#9CA3AF' },
  hazirlik_bekliyor: { icon: 'time', color: '#F5A623' },
  hazirlaniyor: { icon: 'flask', color: '#3B82F6' },
  hazir: { icon: 'cube', color: '#8B5CF6' },
  yolda: { icon: 'bicycle', color: '#14B67E' },
  teslim_edildi: { icon: 'checkmark-done', color: '#22C55E' },
  iptal_edildi: { icon: 'close-circle', color: '#EF4444' },
};
const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  pending: 'Bekliyor',
  unpaid: 'Ödenmedi',
  failed: 'Başarısız',
  suspicious: 'Şüpheli',
  iade_edildi: 'İade Edildi',
  kismi_iade_edildi: 'Kısmi İade',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Kapıda Nakit',
  pay_at_counter: 'Tezgahta Ödeme',
  online_card: 'Kredi Kartı',
};
const FINAL_STATUSES = new Set(['teslim_edildi', 'iptal_edildi', 'teslim_alinmadi', 'musteri_gelmedi_iptal']);
const CANCELLED = new Set(['iptal_edildi', 'teslim_alinmadi', 'musteri_gelmedi_iptal']);
const NOTIFY_COLOR = '#EC4899';

function paymentColor(status: string): ThemeColor {
  if (status === 'paid') return 'tint';
  if (['failed', 'suspicious', 'iade_edildi', 'kismi_iade_edildi'].includes(status)) return 'danger';
  return 'textSecondary';
}

export default function SorumluSiparisDetay() {
  const theme = useTheme();
  const { txId } = useLocalSearchParams<{ txId: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState<string | null>(null);
  const [notifyDone, setNotifyDone] = useState('');

  const [returnMode, setReturnMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [returnReason, setReturnReason] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState('');

  function load() {
    if (!txId) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.get<OrderDetail>(`/pazar-sorumlusu/orders/${txId}`),
      api.get<Courier[]>('/pazar-sorumlusu/couriers'),
    ])
      .then(([o, c]) => {
        setOrder(o);
        setCouriers(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [txId]);

  const isFinal = order ? FINAL_STATUSES.has(order.order_status) : false;

  const groupedItems = useMemo(() => {
    if (!order) return [];
    const map = new Map<string, { item: SorumluOrder['items'][number]; index: number }[]>();
    order.items.forEach((item, index) => {
      const key = item.supplier_group || 'Diğer';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ item, index });
    });
    return Array.from(map.entries());
  }, [order]);

  async function notify(courierId: string) {
    if (!txId) return;
    setNotifyBusy(courierId);
    setNotifyDone('');
    try {
      await api.post(`/pazar-sorumlusu/orders/${txId}/notify-courier`, { courier_user_id: courierId });
      setNotifyDone(courierId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bildirilemedi');
    } finally {
      setNotifyBusy(null);
    }
  }

  function toggleItem(index: number) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function submitReturnRequest() {
    if (!txId || selectedItems.size === 0) {
      setReturnError('En az bir ürün seçin');
      return;
    }
    setReturnSaving(true);
    setReturnError('');
    try {
      await api.post(`/pazar-sorumlusu/orders/${txId}/return-request`, {
        item_indices: Array.from(selectedItems),
        reason: returnReason.trim(),
      });
      setReturnMode(false);
      setSelectedItems(new Set());
      setReturnReason('');
      load();
    } catch (err) {
      setReturnError(err instanceof ApiError ? err.message : 'Talep oluşturulamadı');
    } finally {
      setReturnSaving(false);
    }
  }

  function openMap() {
    if (!order?.address) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;
    // Web'de Linking.openURL yerine window.open kullanılmalı — tıklama olayı
    // içinde senkron çağrılmazsa tarayıcı pop-up engelleyicisine takılıp
    // sessizce hiçbir şey açmıyordu (kullanıcı talimatıyla bulunan hata:
    // butonlar görünüyor ama tepkisizdi). bkz. tedarikci/index.tsx openPdf().
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      Linking.openURL(url);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {order && (
          <>
            {isFinal && (
              <View style={[styles.banner, { borderColor: theme.tint }]}>
                <ThemedText type="small" themeColor="tint">Geçmiş sipariş — sadece görüntüleme</ThemedText>
              </View>
            )}

            <View>
              <ThemedText type="title" style={{ fontSize: 20 }}>{order.user_name || 'Müşteri'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{order.tx_id}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{order.customer_phone_masked}</ThemedText>
            </View>

            <View style={styles.grid}>
              <View style={[styles.gridCell, { backgroundColor: theme.authCard }]}>
                <ThemedText type="small" themeColor="textSecondary">Toplam</ThemedText>
                <ThemedText type="smallBold" style={styles.gridValue}>{money(order.amount)}</ThemedText>
              </View>
              <View style={[styles.gridCell, { backgroundColor: theme.authCard }]}>
                <ThemedText type="small" themeColor="textSecondary">Ödeme</ThemedText>
                <ThemedText type="smallBold" themeColor={paymentColor(order.payment_status)} style={styles.gridValue}>
                  {PAYMENT_LABELS[order.payment_status] ?? order.payment_status ?? '—'}
                </ThemedText>
              </View>
              <View style={[styles.gridCell, { backgroundColor: theme.authCard }]}>
                <ThemedText type="small" themeColor="textSecondary">Teslim</ThemedText>
                <ThemedText type="smallBold" style={styles.gridValue}>{order.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'}</ThemedText>
              </View>
              <View style={[styles.gridCell, { backgroundColor: theme.authCard }]}>
                <ThemedText type="small" themeColor="textSecondary">Ödeme Şekli</ThemedText>
                <ThemedText type="smallBold" style={styles.gridValue}>{PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method ?? '—'}</ThemedText>
              </View>
            </View>

            {order.delivery_type === 'eve_servis' && order.address && (
              <View style={[styles.card, { backgroundColor: theme.authCard }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {order.delivery_neighborhood ? `${order.delivery_neighborhood} · ` : ''}{order.address}
                </ThemedText>
                <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={openMap}>
                  <ThemedText style={{ color: '#fff' }} type="smallBold">📍 Konumu Aç</ThemedText>
                </Pressable>
              </View>
            )}

            <View style={[styles.card, { backgroundColor: theme.authCard }]}>
              <ThemedText type="smallBold">Durum</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRow}>
                {(CANCELLED.has(order.order_status) ? [...STATUS_FLOW, 'iptal_edildi'] : STATUS_FLOW).map((s) => {
                  const active = s === order.order_status;
                  const meta = STATUS_META[s];
                  return (
                    <View
                      key={s}
                      style={[
                        styles.statusPill,
                        { backgroundColor: 'transparent', borderColor: meta.color, borderWidth: active ? 2 : 1.5 },
                      ]}
                    >
                      <View style={[styles.statusIcon, { backgroundColor: meta.color }]}>
                        <Ionicons name={meta.icon} size={13} color="#fff" />
                      </View>
                      <ThemedText type="smallBold" style={{ color: meta.color }}>{STATUS_LABELS[s]}</ThemedText>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {order.delivery_type === 'eve_servis' && !isFinal && (
              <View style={[styles.card, { backgroundColor: theme.authCard }]}>
                <Pressable onPress={() => setNotifyOpen((v) => !v)}>
                  <ThemedText type="smallBold" style={{ color: NOTIFY_COLOR }}>🛵 Kuryeye Bildir</ThemedText>
                </Pressable>
                {notifyOpen && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    {couriers.length === 0 && <ThemedText type="small" themeColor="textSecondary">Pazarında kayıtlı kurye yok.</ThemedText>}
                    {couriers.map((c) => (
                      <Pressable
                        key={c.user_id}
                        style={[styles.rowBetween, styles.courierRow, { borderColor: theme.border }]}
                        onPress={() => notify(c.user_id)}
                        disabled={notifyBusy === c.user_id}
                      >
                        <View>
                          <ThemedText type="small">{c.name || 'Kurye'}</ThemedText>
                          <ThemedText type="small" themeColor={c.is_online ? 'tint' : 'textSecondary'}>
                            {c.is_online ? 'Çevrimiçi' : 'Çevrimdışı'}
                          </ThemedText>
                        </View>
                        <ThemedText type="small" themeColor="tint">
                          {notifyBusy === c.user_id ? 'Gönderiliyor…' : notifyDone === c.user_id ? 'Bildirildi ✓' : 'Bildir'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            <View style={[styles.card, { backgroundColor: theme.authCard }]}>
              <View style={styles.rowBetween}>
                <ThemedText type="smallBold">Ürünler</ThemedText>
                {!isFinal && !order.return_request && (
                  <Pressable onPress={() => setReturnMode((v) => !v)}>
                    <ThemedText type="smallBold" themeColor="danger">
                      {returnMode ? 'Vazgeç' : '↩ İade Talebi Oluştur'}
                    </ThemedText>
                  </Pressable>
                )}
              </View>

              {order.return_request && (
                <View style={[styles.banner, { borderColor: theme.danger }]}>
                  <ThemedText type="small" themeColor="danger">
                    İade talebi oluşturuldu: {order.return_request.item_names.join(', ')}
                    {order.return_request.reason ? ` — "${order.return_request.reason}"` : ''}
                  </ThemedText>
                </View>
              )}

              {groupedItems.map(([supplier, rows]) => (
                <View key={supplier} style={{ gap: 4, marginTop: 6 }}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>{supplier}</ThemedText>
                  {rows.map(({ item, index }) => (
                    <Pressable
                      key={index}
                      style={styles.itemRow}
                      onPress={() => returnMode && toggleItem(index)}
                      disabled={!returnMode}
                    >
                      {returnMode && (
                        <ThemedText type="small" themeColor={selectedItems.has(index) ? 'danger' : 'textSecondary'}>
                          {selectedItems.has(index) ? '☑' : '☐'}
                        </ThemedText>
                      )}
                      <View style={{ flex: 1 }}>
                        <ThemedText type="small">{item.qty} {item.unit} · {item.name}</ThemedText>
                        {item.selected_options.map((o, i) => (
                          <ThemedText key={i} type="small" themeColor="tint">{o.title}: {o.label}</ThemedText>
                        ))}
                        {!!item.note && <ThemedText type="small" themeColor="textSecondary">Not: {item.note}</ThemedText>}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}

              {returnMode && (
                <View style={{ gap: 8, marginTop: 8 }}>
                  <TextInput
                    value={returnReason}
                    onChangeText={setReturnReason}
                    placeholder="İade sebebi (opsiyonel)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
                  />
                  {!!returnError && <ThemedText type="small" themeColor="danger">{returnError}</ThemedText>}
                  <Pressable style={[styles.smallBtn, { backgroundColor: theme.danger }]} onPress={submitReturnRequest} disabled={returnSaving}>
                    <ThemedText style={{ color: '#fff' }} type="smallBold">
                      {returnSaving ? 'Gönderiliyor…' : `İade Talebini Gönder (${selectedItems.size})`}
                    </ThemedText>
                  </Pressable>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  banner: { borderWidth: 1.5, borderRadius: 12, padding: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, padding: Spacing.two, gap: 2 },
  gridValue: { fontSize: 17, lineHeight: 22 },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  statusRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999,
    borderWidth: 1.5, paddingVertical: 6, paddingHorizontal: 12,
  },
  statusIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  smallBtn: { borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courierRow: { borderWidth: 1, borderRadius: 12, padding: Spacing.two },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 14 },
});
