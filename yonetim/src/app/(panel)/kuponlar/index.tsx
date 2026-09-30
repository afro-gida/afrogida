import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chips, ErrorBox, Loading, Notice, NumField, Page, Section, Select, T, trDate } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { couponDiscountText, type Coupon } from '@/lib/types';

type NewMember = { coupon_id: string | null; limit: number; days: number };
type Filter = 'active' | 'passive' | 'all';

const NONE = '__none__';

/** Süresi geçmiş mi (tarih o günün sonuna kadar geçerli). */
function expired(c: Coupon) {
  if (!c.valid_until) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  return c.valid_until.slice(0, 10) < today;
}

/**
 * Kuponlar: kupon listesi + "Yeni üyelere otomatik kupon" ayarı. Kupona basınca
 * düzenleme ve kişiye / herkese verme ekranı açılır.
 */
export default function Coupons() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [nm, setNm] = useState<NewMember | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, n] = await Promise.all([
        api.get<Coupon[]>('/admin/coupons'),
        api.get<NewMember>('/admin/coupons-new-member'),
      ]);
      setCoupons(c);
      setNm(n);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveNewMember() {
    if (!nm) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setNm(await api.put<NewMember>('/admin/coupons-new-member', nm));
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = (coupons ?? []).filter((c) =>
    filter === 'all' ? true : filter === 'active' ? c.active && !expired(c) : !c.active || expired(c),
  );
  const activeOptions = (coupons ?? []).filter((c) => c.active && !expired(c));

  return (
    <Page
      title="Kuponlar"
      subtitle="Kupon oluştur, kişiye ya da herkese ver"
      right={<Button icon="add" label="Yeni kupon" onPress={() => router.navigate('/kuponlar/yeni')} />}
    >
      {error && <ErrorBox text={error} onRetry={load} />}
      {!coupons && !error && <Loading />}

      {nm && coupons && (
        <Section title="Yeni üyelere otomatik kupon">
          <T muted size={12.5}>Kayıt olan her yeni üyeye bu kupon kendiliğinden verilir. Vermemek için "Kupon verme"yi seç.</T>
          <Select
            label="Kupon"
            value={nm.coupon_id ?? NONE}
            options={[{ value: NONE, label: 'Kupon verme' }, ...activeOptions.map((c) => ({ value: c.id, label: `${c.code} · ${c.title} (${couponDiscountText(c)})` }))]}
            onChange={(v) => { setSaved(false); setNm({ ...nm, coupon_id: v === NONE ? null : v }); }}
          />
          {!!nm.coupon_id && (
            <View style={styles.pair}>
              <NumField style={styles.half} label="Kullanım hakkı" value={nm.limit} onChange={(v) => { setSaved(false); setNm({ ...nm, limit: Math.max(1, Math.round(v)) }); }} />
              <NumField style={styles.half} label="Geçerlilik (gün)" value={nm.days} onChange={(v) => { setSaved(false); setNm({ ...nm, days: Math.round(v) }); }} hint="Kayıttan itibaren · 0 = süresiz" />
            </View>
          )}
          {saved && <Notice text={nm.coupon_id ? 'Kaydedildi. Yeni üyelere bu kupon verilecek.' : 'Kaydedildi. Yeni üyelere kupon verilmeyecek.'} />}
          <View style={styles.actions}>
            <Button label="Kaydet" icon="save-outline" onPress={saveNewMember} loading={busy} />
          </View>
        </Section>
      )}

      {coupons && (
        <>
          <Chips<Filter>
            options={[
              { value: 'active', label: 'Geçerli' },
              { value: 'passive', label: 'Pasif / süresi dolmuş' },
              { value: 'all', label: `Tümü (${coupons.length})` },
            ]}
            value={filter}
            onChange={setFilter}
          />
          {shown.length === 0 && <T muted>Kupon yok.</T>}
          <View style={styles.grid}>
            {shown.map((c) => {
              const given = c.assignments?.length ?? c.assigned_user_ids?.length ?? 0;
              const uses = (c.assignments ?? []).reduce((s, a) => s + (a.used_count || 0), 0);
              return (
                <Card key={c.id} style={styles.tile}>
                  <View style={styles.head}>
                    <T bold size={16} style={{ flex: 1 }}>{c.code}</T>
                    {nm?.coupon_id === c.id && <Badge label="Yeni üye" tone="tint" />}
                    {!c.active ? <Badge label="Pasif" /> : expired(c) ? <Badge label="Süresi doldu" tone="danger" /> : <Badge label="Geçerli" tone="ok" />}
                  </View>
                  <T>{c.title}</T>
                  <T bold>{couponDiscountText(c)}{c.min_amount ? ` · en az ${c.min_amount.toLocaleString('tr-TR')} ₺` : ''}</T>
                  <T muted size={12.5}>Son gün: {trDate(c.valid_until)}</T>
                  <T muted size={12.5}>{given ? `${given} kişiye verildi · ${uses} kullanım` : 'Henüz kimseye verilmedi'}</T>
                  <Button small kind="ghost" label="Aç" onPress={() => router.navigate(`/kuponlar/${c.id}`)} />
                </Card>
              );
            })}
          </View>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  half: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '46%', maxWidth: '50%', minWidth: 150, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
