import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Chips, ErrorBox, Field, ListRow, Loading, Page, T, dateTime, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { ORDER_STATUS, PAYMENT_STATUS, orderTotal, statusTone, type Order } from '@/lib/orders';

type Range = 'today' | 'last_7_days' | 'last_1_month' | 'all_time';

export default function Orders() {
  const router = useRouter();
  const [range, setRange] = useState<Range>('today');
  const [rows, setRows] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('__all');

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await api.get<Order[]>(`/admin/orders?filter_type=${range}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  const markets = [...new Set((rows ?? []).map((o) => o.market_name || '—'))];
  const needle = q.trim().toLocaleLowerCase('tr-TR');
  const shown = (rows ?? []).filter(
    (o) =>
      (market === '__all' || (o.market_name || '—') === market) &&
      (!needle || `${o.tx_id} ${o.user_name ?? ''}`.toLocaleLowerCase('tr-TR').includes(needle)),
  );
  const total = shown.reduce((s, o) => s + orderTotal(o), 0);

  return (
    <Page title="Siparişler" subtitle={rows ? `${shown.length} sipariş · ${money(total)}` : undefined} right={<Button small kind="secondary" icon="refresh" label="Yenile" onPress={load} />}>
      <Chips<Range>
        options={[
          { value: 'today', label: 'Bugün' },
          { value: 'last_7_days', label: 'Son 7 gün' },
          { value: 'last_1_month', label: 'Son 30 gün' },
          { value: 'all_time', label: 'Tümü' },
        ]}
        value={range}
        onChange={setRange}
      />
      {markets.length > 1 && (
        <Chips options={[{ value: '__all', label: 'Tüm pazarlar' }, ...markets.map((m) => ({ value: m, label: m }))]} value={market} onChange={setMarket} />
      )}
      <Field label="Ara" placeholder="Sipariş no veya müşteri adı" value={q} onChangeText={setQ} />
      {error && <ErrorBox text={error} onRetry={load} />}
      {!rows && !error ? (
        <Loading />
      ) : (
        <Card>
          {shown.length === 0 && <T muted>Bu aralıkta sipariş yok.</T>}
          {shown.map((o) => (
            <ListRow
              key={o.tx_id}
              title={`${o.user_name || 'Müşteri'} · ${money(orderTotal(o))}`}
              subtitle={`${dateTime(o.created_at)} · ${o.market_name || '—'} · ${o.delivery_type === 'eve_servis' ? 'Eve Servis' : 'Gel-Al'} · ${PAYMENT_STATUS[o.payment_status ?? ''] ?? o.payment_status ?? ''} · #${o.tx_id.slice(-6)}`}
              onPress={() => router.push(`/siparisler/${o.tx_id}`)}
              right={
                <View>
                  <Badge label={ORDER_STATUS[o.order_status ?? ''] ?? o.order_status ?? '-'} tone={statusTone(o.order_status)} />
                </View>
              }
            />
          ))}
        </Card>
      )}
    </Page>
  );
}
