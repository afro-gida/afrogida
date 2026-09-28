import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorBox, ListRow, Loading, Page, Section, T, confirmAsync, dateTime, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { ORDER_STATUS, orderTotal, type Order } from '@/lib/orders';

type MemberDetail = {
  user_id: string;
  name?: string;
  phone?: string;
  email?: string | null;
  created_at?: string;
  addresses?: { title?: string; neighborhood?: string; street?: string; building_no?: string; district?: string; city?: string }[];
  no_show_count?: number;
  online_only?: boolean;
  online_only_message?: string;
  is_test?: boolean;
};

/** Üye detayı. Bu ekran adres gösterdiği için her açılış sunucuda
 *  KVKK denetim kaydına yazılır (admin_members.admin_get_member). */
export default function MemberView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [m, setM] = useState<MemberDetail | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [member, all] = await Promise.all([
        api.get<MemberDetail>(`/admin/members/${id}`),
        api.get<Order[]>('/admin/orders?filter_type=all_time'),
      ]);
      setM(member);
      setOrders(all.filter((o) => o.user_id === id));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!m) return <Page title="Üye">{error ? <ErrorBox text={error} onRetry={load} /> : <Loading />}</Page>;

  async function remove() {
    if (!(await confirmAsync(`${m?.name || 'Üye'} hesabı kalıcı olarak silinsin mi? Sipariş kayıtları anonim olarak kalır.`))) return;
    try {
      await api.del(`/admin/members/${id}`);
      router.replace('/uyeler');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const line = (label: string, value?: string | null) => (
    <View style={styles.kv}>
      <T muted style={styles.k}>{label}</T>
      <T style={{ flex: 1 }}>{value || '-'}</T>
    </View>
  );

  return (
    <Page title={m.name || 'Üye'} subtitle={m.phone} right={<Button small kind="secondary" icon="arrow-back" label="Üyeler" onPress={() => router.navigate('/uyeler')} />}>
      <Section title="Bilgiler">
        {line('Telefon', m.phone)}
        {line('E-posta', m.email)}
        {line('Kayıt', dateTime(m.created_at))}
        {line('Gelmeme sayısı', String(m.no_show_count ?? 0))}
        {m.online_only && line('Kısıt', m.online_only_message || 'Sadece online ödeme')}
      </Section>
      {!!m.addresses?.length && (
        <Section title="Adresler">
          {m.addresses.map((a, i) => (
            <T key={i}>{[a.title, [a.neighborhood, a.street, a.building_no && `No:${a.building_no}`].filter(Boolean).join(' '), [a.district, a.city].filter(Boolean).join('/')].filter(Boolean).join(' · ')}</T>
          ))}
        </Section>
      )}
      <Section title={`Siparişler (${orders.length})`}>
        {orders.length === 0 && <T muted>Sipariş yok.</T>}
        {orders.map((o) => (
          <ListRow
            key={o.tx_id}
            title={`${money(orderTotal(o))} · ${ORDER_STATUS[o.order_status ?? ''] ?? o.order_status}`}
            subtitle={`${dateTime(o.created_at)} · ${o.market_name ?? ''}`}
            onPress={() => router.push(`/siparisler/${o.tx_id}`)}
          />
        ))}
      </Section>
      {error && <ErrorBox text={error} />}
      <Button kind="danger" icon="trash-outline" label="Üyeliği sil" onPress={remove} />
    </Page>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', gap: 10 },
  k: { width: 120 },
});
