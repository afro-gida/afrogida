import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, ErrorBox, ListRow, Loading, Page, T, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import type { Market } from '@/lib/types';

export default function Markets() {
  const router = useRouter();
  const [rows, setRows] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<Market[]>('/admin/markets'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Page title="Pazarlar" subtitle="Gün, saat, tutar ve teslimat ayarları" right={<Button small icon="add" label="Yeni pazar" onPress={() => router.push('/pazarlar/yeni')} />}>
      {error && <ErrorBox text={error} onRetry={load} />}
      {!rows && !error ? (
        <Loading />
      ) : (
        <Card>
          {rows?.length === 0 && <T muted>Henüz pazar yok.</T>}
          {rows?.map((m) => (
            <ListRow
              key={m.id}
              title={`${m.name} · ${m.day}`}
              subtitle={`Pazar ${m.pazar_saati} · Gel-Al min ${money(m.gel_al_min_tutar)} · Eve Servis min ${money(m.eve_servis_min_tutar)} · Teslimat ${money(m.teslimat_ucreti)} (${money(m.ucretsiz_teslimat_alt_limiti)} üstü ücretsiz)`}
              onPress={() => router.push(`/pazarlar/${m.id}`)}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {!m.active && <Badge label="Pasif" />}
                  <Badge label={m.orders_enabled ? 'Sipariş açık' : 'Sipariş kapalı'} tone={m.orders_enabled ? 'ok' : 'danger'} />
                </View>
              }
            />
          ))}
        </Card>
      )}
    </Page>
  );
}
