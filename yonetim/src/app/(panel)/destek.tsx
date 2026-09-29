import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chips, ErrorBox, Loading, Page, T, dateTime } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type SupportStatus = 'pending' | 'resolved';

type ReturnRow = {
  tx_id: string;
  user_name?: string;
  market_name?: string;
  refund_status?: string | null;
  return_request: {
    item_names: string[];
    reason?: string;
    photo_urls?: string[];
    requested_by_name?: string;
    requested_at?: string;
    status?: SupportStatus;
  };
};

type Complaint = {
  id: string;
  user_name?: string;
  message: string;
  status?: SupportStatus;
  created_at?: string;
};

type Tab = 'iade' | 'oneri';
type Filter = 'pending' | 'resolved' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Bekleyen' },
  { value: 'resolved', label: 'İncelendi' },
  { value: 'all', label: 'Tümü' },
];

const statusOf = (s?: string): SupportStatus => (s === 'resolved' ? 'resolved' : 'pending');

/**
 * Yardım & Destek: sorumluların iade talepleri + müşterilerin şikayet/öneri
 * mesajları tek yerde. İade kararı (iade / kupon / ret) sipariş detayında
 * verilir; burada sadece takip ("incelendi" işareti) yapılır.
 */
export default function Support() {
  const router = useRouter();
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('iade');
  const [filter, setFilter] = useState<Filter>('pending');
  const [returns, setReturns] = useState<ReturnRow[] | null>(null);
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, c] = await Promise.all([
        api.get<ReturnRow[]>('/admin/return-requests'),
        api.get<Complaint[]>('/admin/complaints'),
      ]);
      setReturns(r);
      setComplaints(c);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function mark(kind: Tab, id: string, status: SupportStatus) {
    setBusy(id);
    setError(null);
    try {
      if (kind === 'iade') {
        await api.put(`/admin/return-requests/${id}`, { status });
        setReturns((rows) => rows?.map((r) => (r.tx_id === id ? { ...r, return_request: { ...r.return_request, status } } : r)) ?? null);
      } else {
        await api.put(`/admin/complaints/${id}`, { status });
        setComplaints((rows) => rows?.map((c) => (c.id === id ? { ...c, status } : c)) ?? null);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const pendingReturns = returns?.filter((r) => statusOf(r.return_request.status) === 'pending').length ?? 0;
  const pendingComplaints = complaints?.filter((c) => statusOf(c.status) === 'pending').length ?? 0;
  const show = (s?: string) => filter === 'all' || statusOf(s) === filter;

  const toggleBtn = (kind: Tab, id: string, s?: string) =>
    statusOf(s) === 'pending' ? (
      <Button small kind="secondary" icon="checkmark" label="İncelendi" loading={busy === id} onPress={() => mark(kind, id, 'resolved')} />
    ) : (
      <Button small kind="ghost" label="Bekleyene al" loading={busy === id} onPress={() => mark(kind, id, 'pending')} />
    );

  const loaded = returns && complaints;

  return (
    <Page title="Yardım & Destek" subtitle="İade talepleri ve müşteri mesajları" right={<Button small kind="secondary" icon="refresh" label="Yenile" onPress={load} />}>
      <Chips<Tab>
        options={[
          { value: 'iade', label: `İade talepleri (${pendingReturns})` },
          { value: 'oneri', label: `Öneri / Şikayet (${pendingComplaints})` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Chips<Filter> options={FILTERS} value={filter} onChange={setFilter} />
      {error && <ErrorBox text={error} onRetry={load} />}
      {!loaded && !error && <Loading />}

      {loaded && tab === 'iade' && (() => {
        const rows = returns.filter((r) => show(r.return_request.status));
        if (!rows.length) return <T muted>Kayıt yok.</T>;
        return rows.map((r) => {
          const rr = r.return_request;
          return (
            <Card key={r.tx_id} style={styles.card}>
              <View style={styles.head}>
                <T bold style={{ flex: 1 }}>#{r.tx_id.slice(-6)} · {r.user_name || 'Müşteri'}</T>
                <Badge label={statusOf(rr.status) === 'pending' ? 'Bekliyor' : 'İncelendi'} tone={statusOf(rr.status) === 'pending' ? 'warn' : 'ok'} />
              </View>
              <T muted size={12.5}>{r.market_name || '-'} · {rr.requested_by_name || 'Sorumlu'} · {dateTime(rr.requested_at)}</T>
              <T>{rr.item_names.join(', ')}</T>
              {!!rr.reason && <T muted>Sebep: {rr.reason}</T>}
              {!!rr.photo_urls?.length && (
                <View style={styles.photos}>
                  {rr.photo_urls.map((u) => (
                    <Pressable key={u} onPress={() => (Platform.OS === 'web' ? window.open(u, '_blank', 'noopener,noreferrer') : null)}>
                      <Image source={{ uri: u }} style={[styles.photo, { borderColor: t.border }]} />
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.actions}>
                <Button small icon="open-outline" label="Siparişi aç" onPress={() => router.navigate(`/siparisler/${r.tx_id}` as any)} />
                {toggleBtn('iade', r.tx_id, rr.status)}
              </View>
            </Card>
          );
        });
      })()}

      {loaded && tab === 'oneri' && (() => {
        const rows = complaints.filter((c) => show(c.status));
        if (!rows.length) return <T muted>Kayıt yok.</T>;
        return rows.map((c) => (
          <Card key={c.id} style={styles.card}>
            <View style={styles.head}>
              <T bold style={{ flex: 1 }}>{c.user_name || 'Müşteri'}</T>
              <Badge label={statusOf(c.status) === 'pending' ? 'Bekliyor' : 'İncelendi'} tone={statusOf(c.status) === 'pending' ? 'warn' : 'ok'} />
            </View>
            <T muted size={12.5}>{dateTime(c.created_at)}</T>
            <T>{c.message}</T>
            <View style={styles.actions}>{toggleBtn('oneri', c.id, c.status)}</View>
          </Card>
        ));
      })()}
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 80, height: 80, borderRadius: 8, borderWidth: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
