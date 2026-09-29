import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, ErrorBox, Field, Loading, Notice, Page, Section, T, confirmAsync, dateTime, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { FINAL_STATUSES, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, orderTotal, statusTone, type Order, type OrderItem } from '@/lib/orders';
import { useTheme } from '@/lib/theme';

function itemQty(i: OrderItem) {
  return Number(i.qty ?? i.quantity ?? 0);
}

/**
 * Sipariş detayı. Yönetici kararları: her şeyi görür ama geçmişi değiştiremez
 * — "teslim edildi" elle yapılamaz, tutar değiştirilemez. Yapabildikleri:
 * gerekçeli iptal ve not (ikisi de sunucuda loglanır).
 */
export default function OrderDetail() {
  const { tx } = useLocalSearchParams<{ tx: string }>();
  const router = useRouter();
  const t = useTheme();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'note' | 'cancel' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const order = await api.get<Order>(`/admin/orders/${tx}`);
      setO(order);
      setNote(order.admin_note ?? '');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [tx]);
  useEffect(() => {
    load();
  }, [load]);

  if (!o) return <Page title="Sipariş">{error ? <ErrorBox text={error} onRetry={load} /> : <Loading />}</Page>;

  const isFinal = FINAL_STATUSES.includes(o.order_status ?? '');

  async function saveNote() {
    setBusy('note');
    setError(null);
    try {
      await api.put(`/admin/orders/${tx}`, { admin_note: note.trim() });
      setDone('Not kaydedildi.');
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (reason.trim().length < 5) return setError('İptal gerekçesi yazın (en az 5 karakter).');
    if (!(await confirmAsync('Sipariş iptal edilsin mi? Bu işlem geri alınamaz. Online ödendiyse iade ayrıca yapılmalı.'))) return;
    setBusy('cancel');
    setError(null);
    try {
      await api.put(`/admin/orders/${tx}`, { order_status: 'iptal_edildi', cancel_reason: reason.trim() });
      setDone('Sipariş iptal edildi.');
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const line = (label: string, value?: string | null) => (
    <View style={styles.kv}>
      <T muted style={styles.k}>{label}</T>
      <T style={styles.v}>{value || '-'}</T>
    </View>
  );

  return (
    <Page
      title={`Sipariş #${o.tx_id.slice(-6)}`}
      subtitle={dateTime(o.created_at)}
      right={<Button small kind="secondary" icon="arrow-back" label="Siparişler" onPress={() => router.navigate('/siparisler')} />}
    >
      <View style={styles.badges}>
        <Badge label={ORDER_STATUS[o.order_status ?? ''] ?? o.order_status ?? '-'} tone={statusTone(o.order_status)} />
        <Badge label={PAYMENT_STATUS[o.payment_status ?? ''] ?? o.payment_status ?? '-'} tone={o.payment_status === 'paid' ? 'ok' : 'warn'} />
      </View>

      <Section title="Müşteri ve teslimat">
        {line('Müşteri', o.user_name)}
        {line('Telefon', o.user_phone)}
        {line('Pazar', o.market_name)}
        {line('Teslimat', o.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al')}
        {o.delivery_type === 'eve_servis'
          ? line('Saat', o.delivery_slot_start ? `${o.delivery_slot_start}-${o.delivery_slot_end ?? ''}` : 'En kısa sürede')
          : line('Teslim alma', o.pickup_time || 'En kısa sürede')}
        {o.delivery_type === 'eve_servis' && line('Adres', o.address)}
        {line('Ödeme', PAYMENT_METHOD[o.payment_method ?? ''] ?? o.payment_method)}
        {line('Sipariş no', o.tx_id)}
      </Section>

      <Section title={`Ürünler (${o.items?.length ?? 0})`}>
        {(o.items ?? []).map((i, idx) => {
          const opts = (i.selected_options ?? []).map((s) => `${s.title}: ${s.label}`).join(', ');
          return (
            <View key={idx} style={[styles.item, { borderBottomColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <T bold>{i.name}</T>
                <T muted size={12.5}>
                  {itemQty(i)} {i.unit ?? ''} × {money(i.price)}{opts ? ` · ${opts}` : ''}
                  {i.supplier_group_snapshot ? ` · ${i.supplier_group_snapshot}` : ''}
                  {i.supplier_price_snapshot ? ` · alış ${money(i.supplier_price_snapshot)}` : ''}
                </T>
              </View>
              <T bold>{money(i.line_total ?? i.total ?? (i.price ?? 0) * itemQty(i))}</T>
            </View>
          );
        })}
        {line('Ara toplam', money(o.subtotal))}
        {line('Teslimat', money(o.delivery_fee))}
        {!!o.discount && line(`İndirim${o.coupon_code ? ` (${o.coupon_code})` : ''}`, `-${money(o.discount)}`)}
        <View style={styles.kv}>
          <T bold style={styles.k}>Toplam</T>
          <T bold size={17} style={styles.v}>{money(orderTotal(o))}</T>
        </View>
      </Section>

      {o.return_request && (
        <Section title="İade talebi (sorumlu)">
          <T>{o.return_request.item_names.join(', ')}</T>
          {!!o.return_request.reason && <T muted>Sebep: {o.return_request.reason}</T>}
          <T muted size={12}>{o.return_request.requested_by_name || 'Sorumlu'} · {dateTime(o.return_request.requested_at)}</T>
          {!!o.return_request.photo_urls?.length && (
            <View style={styles.photos}>
              {o.return_request.photo_urls.map((u) => (
                <Pressable key={u} onPress={() => (Platform.OS === 'web' ? window.open(u, '_blank', 'noopener,noreferrer') : null)}>
                  <Image source={{ uri: u }} style={[styles.photo, { borderColor: t.border }]} />
                </Pressable>
              ))}
            </View>
          )}
          <T muted size={12}>İade kararı (iade / kupon / ret) ve kart iadesi yönetim tarafından verilir.</T>
        </Section>
      )}

      <Section title="Yönetici notu">
        <Field label="Not (sadece yönetim görür)" value={note} onChangeText={setNote} multiline />
        <Button kind="secondary" label="Notu kaydet" onPress={saveNote} loading={busy === 'note'} />
      </Section>

      {isFinal ? (
        o.cancel_reason ? <Notice tone="warn" text={`İptal gerekçesi: ${o.cancel_reason}`} /> : null
      ) : (
        <Section title="Siparişi iptal et">
          <T muted size={12.5}>Gerekçe kayda geçer ve silinemez. Online ödenmiş siparişte kart iadesi ayrıca yapılır.</T>
          <Field label="İptal gerekçesi" value={reason} onChangeText={setReason} multiline />
          <Button kind="danger" icon="close-circle-outline" label="İptal et" onPress={cancel} loading={busy === 'cancel'} />
        </Section>
      )}

      {error && <ErrorBox text={error} />}
      {done && <Notice text={done} />}
    </Page>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: 8 },
  kv: { flexDirection: 'row', gap: 10 },
  k: { width: 110 },
  v: { flex: 1 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 96, height: 96, borderRadius: 8, borderWidth: 1 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
