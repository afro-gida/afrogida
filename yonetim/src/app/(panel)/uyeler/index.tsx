import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Card, ErrorBox, Field, ListRow, Loading, Page, T, dateTime } from '@/components/ui';
import { api, errMsg } from '@/lib/api';

export type Member = {
  user_id: string;
  name?: string;
  phone?: string;
  email?: string | null;
  role?: string;
  created_at?: string;
  is_restricted?: boolean;
  is_test?: boolean;
};

export default function Members() {
  const router = useRouter();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async (search = '') => {
    setError(null);
    try {
      setRows(await api.get<Member[]>(`/admin/members${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Page title="Üyeler" subtitle={rows ? `${rows.length} üye` : undefined}>
      <Field label="Ara" placeholder="Ad veya telefon — Enter" value={q} onChangeText={setQ} onSubmitEditing={() => load(q)} returnKeyType="search" />
      <Button small kind="secondary" icon="search" label="Ara" onPress={() => load(q)} />
      {error && <ErrorBox text={error} onRetry={() => load(q)} />}
      {!rows && !error ? (
        <Loading />
      ) : (
        <Card>
          {rows?.length === 0 && <T muted>Üye yok.</T>}
          {rows?.map((m) => (
            <ListRow
              key={m.user_id}
              title={m.name || 'İsimsiz'}
              subtitle={`${m.phone ?? ''} · Kayıt ${dateTime(m.created_at)}`}
              onPress={() => router.push(`/uyeler/${m.user_id}`)}
              right={m.is_test ? <Badge label="Test" /> : m.is_restricted ? <Badge label="Kısıtlı" tone="danger" /> : undefined}
            />
          ))}
        </Card>
      )}
    </Page>
  );
}
