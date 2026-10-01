import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge, Button, Chips, DaysField, ErrorBox, Field, Loading, Notice, NumField, Page, Section, T, Toggle,
  confirmAsync, dateTime, sktText, todayIso,
} from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { couponDiscountText, type Coupon, type CouponDetail } from '@/lib/types';

type Kind = 'amount' | 'percent';

const EMPTY: Omit<Coupon, 'id'> = {
  code: '', title: '', discount_percent: 10, discount_amount: null, min_amount: 0, active: true, valid_until: null,
};

/** İki "YYYY-AA-GG" tarihinden erken olanı (boş = sınırsız). */
function earliest(a?: string | null, b?: string | null) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.slice(0, 10) <= b.slice(0, 10) ? a : b;
}

/** Okunması kolay rastgele kod (0/O, 1/I karışmasın). */
function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'AFRO' + Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
}

/**
 * Kupon düzenle + kimlere verildiği (geri alma). Vermek Kuponlar sayfasında
 * (\"Kupon ver\"); kupondaki tarih herkes için üst sınırdır.
 */
export default function CouponEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'yeni';
  const router = useRouter();
  const [c, setC] = useState<Omit<Coupon, 'id'> | null>(isNew ? { ...EMPTY, code: randomCode() } : null);
  const [kind, setKind] = useState<Kind>('amount');
  const [detail, setDetail] = useState<CouponDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setError(null);
    try {
      const d = await api.get<CouponDetail>(`/admin/coupons/${id}/details`);
      setDetail(d);
      setC(d.coupon);
      setKind(d.coupon.discount_amount ? 'amount' : 'percent');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id, isNew]);
  useEffect(() => { load(); }, [load]);

  if (!c) return <Page title="Kupon">{error ? <ErrorBox text={error} /> : <Loading />}</Page>;
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K]) => { setDone(null); setC((x) => (x ? { ...x, [k]: v } : x)); };

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const msg = await fn();
      if (msg) setDone(msg);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const save = () => run('save', async () => {
    if (!c) return;
    const body = {
      ...c,
      code: c.code.trim(),
      title: c.title.trim(),
      discount_amount: kind === 'amount' ? Number(c.discount_amount || 0) : null,
      discount_percent: kind === 'percent' ? Math.round(Number(c.discount_percent || 0)) : 0,
    };
    for (const k of ['assignments', 'assigned_user_ids', 'created_at', 'used', 'used_at', 'auto_issued', 'per_user_limit']) delete (body as any)[k];
    if (isNew) {
      const created = await api.post<Coupon>('/admin/coupons', body);
      router.replace(`/kuponlar/${created.id}`);
      return;
    }
    await api.put(`/admin/coupons/${id}`, body);
    await load();
    return 'Kupon kaydedildi.';
  });

  const remove = async () => {
    if (!(await confirmAsync(`"${c.code}" kuponu silinsin mi? Verilen herkesten de kalkar.`))) return;
    run('del', async () => {
      await api.del(`/admin/coupons/${id}`);
      router.navigate('/kuponlar');
    });
  };

  const takeBack = async (uid: string, name: string) => {
    if (!(await confirmAsync(`${name} adlı üyeden kupon geri alınsın mı?`))) return;
    run(`un-${uid}`, async () => {
      await api.post('/admin/coupons/unassign-member', { coupon_id: id, user_id: uid });
      await load();
      return 'Kupon üyeden geri alındı.';
    });
  };

  const takeBackAll = async () => {
    if (!(await confirmAsync('Kupon verilen HERKESTEN geri alınsın mı?'))) return;
    run('unall', async () => {
      await api.post('/admin/coupons/unassign-all', { coupon_id: id });
      await load();
      return 'Kupon herkesten geri alındı.';
    });
  };

  return (
    <Page
      title={isNew ? 'Yeni kupon' : c.code}
      subtitle={isNew ? undefined : `${c.title} · ${couponDiscountText(c)}`}
      right={<Button small kind="secondary" icon="arrow-back" label="Kuponlar" onPress={() => router.navigate('/kuponlar')} />}
    >
      <Section title="Kupon">
        <View style={styles.pair}>
          <Field style={styles.half} label="Kupon kodu" autoCapitalize="characters" value={c.code} onChangeText={(v) => set('code', v.toUpperCase().replace(/\s/g, ''))} />
          <View style={styles.codeBtn}>
            <Button small kind="secondary" icon="shuffle" label="Rastgele" onPress={() => set('code', randomCode())} />
          </View>
        </View>
        <Field label="Başlık (müşteri görür)" value={c.title} onChangeText={(v) => set('title', v)} placeholder="Örn: Hoş geldin indirimi" />
        <T size={12.5} bold>İndirim türü</T>
        <Chips<Kind> options={[{ value: 'amount', label: 'Tutar (₺)' }, { value: 'percent', label: 'Yüzde (%)' }]} value={kind} onChange={(k) => { setDone(null); setKind(k); }} />
        <View style={styles.pair}>
          {kind === 'amount' ? (
            <NumField style={styles.half} label="İndirim" suffix="₺" value={c.discount_amount ?? 0} onChange={(v) => set('discount_amount', v)} />
          ) : (
            <NumField style={styles.half} label="İndirim" suffix="%" value={c.discount_percent} onChange={(v) => set('discount_percent', Math.min(100, Math.round(v)))} />
          )}
          <NumField style={styles.half} label="En az sepet tutarı" suffix="₺" value={c.min_amount} onChange={(v) => set('min_amount', v)} hint="0 = sınır yok" />
        </View>
        <DaysField label="Kupon kaç gün geçerli? (herkes için)" value={c.valid_until} onChange={(v) => set('valid_until', v)} />
        <Toggle label="Aktif" hint="Kapatınca kimse kullanamaz (verilenler dahil)" value={c.active} onChange={(v) => set('active', v)} />
        <View style={styles.actions}>
          <Button label={isNew ? 'Kuponu oluştur' : 'Kaydet'} icon="save-outline" onPress={save} loading={busy === 'save'} />
          {!isNew && <Button kind="danger" icon="trash-outline" label="Sil" onPress={remove} loading={busy === 'del'} />}
        </View>
      </Section>

      {error && <ErrorBox text={error} />}
      {done && <Notice text={done} />}

      {!isNew && detail && (
        <>
          <Section
            title={`Verilenler (${detail.assigned_count}) · ${detail.total_uses} kullanım`}
            right={detail.assigned_count ? <Button small kind="ghost" label="Herkesten geri al" onPress={takeBackAll} loading={busy === 'unall'} /> : undefined}
          >
            {detail.assigned_users.length === 0 && <T muted>Henüz kimseye verilmedi.</T>}
            {detail.assigned_users.map((u) => {
              // Geçerli son gün: kişiye özel tarih ile kuponun tarihinden ERKEN olanı
              // (kişiye tarih verilmemişse kuponun tarihi geçerli — "Süresiz" değil)
              const until = earliest(u.valid_until, detail.coupon.valid_until);
              const isExpired = !!until && until.slice(0, 10) < todayIso();
              return (
              <View key={u.user_id} style={styles.userRow}>
                <View style={{ flex: 1 }}>
                  <T bold>{u.user_name}{u.phone ? ` · ${u.phone}` : ''}</T>
                  <T muted size={12.5}>
                    {u.used_count}/{u.limit} kullanıldı · SKT {sktText(until)}
                    {u.last_used_at ? ` · son kullanım ${dateTime(u.last_used_at)}` : ''}
                  </T>
                </View>
                {isExpired ? <Badge label="Süresi doldu" tone="danger" /> : u.remaining > 0 ? <Badge label={`${u.remaining} hak`} tone="ok" /> : <Badge label="Bitti" />}
                <Button small kind="ghost" label="Geri al" onPress={() => takeBack(u.user_id, u.user_name)} loading={busy === `un-${u.user_id}`} />
              </View>
              );
            })}
          </Section>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  half: { flex: 1, minWidth: 0 },
  codeBtn: { paddingTop: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
});
