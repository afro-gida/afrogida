import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chips, ErrorBox, Field, Loading, Notice, NumField, Page, Section, Select, T, confirmAsync, isoDay, sktText } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { couponDiscountText, type Coupon } from '@/lib/types';
import { CouponGive } from '@/components/coupon-give';

type NewMember = { coupon_id: string | null; limit: number; days: number };
type Filter = 'active' | 'passive' | 'all';
type GivenFilter = 'usable' | 'used' | 'expired' | 'all';
/** Üyeye verilmiş tek kupon (GET /admin/coupon-assignments). */
type Given = {
  coupon_id: string; code: string; title: string; discount_amount?: number | null; discount_percent: number;
  coupon_active: boolean; user_id: string; user_name: string; phone?: string | null;
  limit: number; used_count: number; remaining: number; valid_until?: string | null; expired: boolean;
};

const givenState = (g: Given): 'usable' | 'used' | 'expired' =>
  g.expired ? 'expired' : g.remaining <= 0 ? 'used' : 'usable';

const NONE = '__none__';

/** Süresi geçmiş mi (tarih o günün sonuna kadar geçerli). */
function expired(c: Coupon) {
  if (!c.valid_until) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  return (isoDay(c.valid_until) ?? '') < today;
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
  const [given, setGiven] = useState<Given[] | null>(null);
  const [givenFilter, setGivenFilter] = useState<GivenFilter>('usable');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, n, g] = await Promise.all([
        api.get<Coupon[]>('/admin/coupons'),
        api.get<NewMember>('/admin/coupons-new-member'),
        // Bu liste yüklenemezse (ör. sunucu henüz güncellenmedi) sayfanın geri kalanı çalışsın
        api.get<Given[]>('/admin/coupon-assignments').catch(() => [] as Given[]),
      ]);
      setCoupons(c);
      setNm(n);
      setGiven(g);
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

  async function takeBack(g: Given) {
    if (!(await confirmAsync(`${g.user_name} adlı üyeden "${g.code}" kuponu geri alınsın mı?`))) return;
    try {
      await api.post('/admin/coupons/unassign-member', { coupon_id: g.coupon_id, user_id: g.user_id });
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Tanımlanmamış = kimseye verilmemiş kuponlar
  const unassigned = (coupons ?? []).filter((c) => !(c.assignments?.length || c.assigned_user_ids?.length));
  const shown = unassigned.filter((c) =>
    filter === 'all' ? true : filter === 'active' ? c.active && !expired(c) : !c.active || expired(c),
  );
  const activeOptions = (coupons ?? []).filter((c) => c.active && !expired(c));
  const q = query.trim().toLocaleLowerCase('tr-TR');
  const givenShown = (given ?? []).filter((g) =>
    (givenFilter === 'all' || givenState(g) === givenFilter) &&
    (!q || `${g.user_name} ${g.phone ?? ''} ${g.code} ${g.title}`.toLocaleLowerCase('tr-TR').includes(q)),
  );

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

      {/* Kupon ver: yeni üye kuponunun altında (kupon seç -> üyeye / herkese) */}
      {coupons && <CouponGive coupons={activeOptions} onGiven={load} />}

      {/* 1) Tanımlanmamış kuponlar: üretildi ama kimseye verilmedi */}
      {coupons && (
        <Section title={`Tanımlanmamış kuponlar (${unassigned.length})`}>
          <T muted size={12.5}>Üretilmiş ama henüz kimseye verilmemiş kuponlar. Yukarıdaki "Kupon ver" ile üyeye ya da herkese verebilirsin.</T>
          <Chips<Filter>
            options={[
              { value: 'active', label: 'Geçerli' },
              { value: 'passive', label: 'Pasif / süresi dolmuş' },
              { value: 'all', label: 'Tümü' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          {shown.length === 0 && <T muted>Kupon yok.</T>}
          <View style={styles.grid}>
            {shown.map((c) => (
              <Card key={c.id} style={styles.tile}>
                <View style={styles.head}>
                  <T bold size={16} style={{ flex: 1 }}>{c.code}</T>
                  {nm?.coupon_id === c.id && <Badge label="Yeni üye" tone="tint" />}
                  {!c.active ? <Badge label="Pasif" /> : expired(c) ? <Badge label="Süresi doldu" tone="danger" /> : <Badge label="Geçerli" tone="ok" />}
                </View>
                <T>{c.title}</T>
                <T bold>{couponDiscountText(c)}{c.min_amount ? ` · en az ${c.min_amount.toLocaleString('tr-TR')} ₺` : ''}</T>
                <T muted size={12.5}>SKT: {sktText(c.valid_until)}</T>
                <Button small kind="ghost" label="Düzenle" onPress={() => router.navigate(`/kuponlar/${c.id}`)} />
              </Card>
            ))}
          </View>
        </Section>
      )}

      {/* 2) Verilen kuponlar: kişiye verilmiş her kupon ayrı satır (hak + SKT) */}
      {given && (
        <Section title={`Verilen kuponlar (${given.length})`}>
          <View style={styles.pair}>
            <Field style={styles.half} label="Ara" value={query} onChangeText={setQuery} placeholder="Üye adı, telefon ya da kupon kodu" />
          </View>
          <Chips<GivenFilter>
            options={[
              { value: 'usable', label: `Kullanılabilir (${given.filter((g) => givenState(g) === 'usable').length})` },
              { value: 'used', label: 'Kullanıldı' },
              { value: 'expired', label: 'Süresi doldu' },
              { value: 'all', label: 'Tümü' },
            ]}
            value={givenFilter}
            onChange={setGivenFilter}
          />
          {givenShown.length === 0 && <T muted>Kayıt yok.</T>}
          {givenShown.slice(0, 200).map((g) => {
            const st = givenState(g);
            return (
              <View key={`${g.coupon_id}-${g.user_id}`} style={[styles.row, { borderBottomColor: '#9993' }]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <T bold>{g.user_name}{g.phone ? ` · ${g.phone}` : ''}</T>
                  <T size={13}>
                    <T bold size={13} color="#d97706" style={styles.link}>{g.code}</T>
                    {` · ${g.title} · ${couponDiscountText(g)}`}
                  </T>
                  <T muted size={12.5}>{g.used_count}/{g.limit} kullanıldı · SKT {sktText(g.valid_until)}</T>
                </View>
                {st === 'expired' ? <Badge label="Süresi doldu" tone="danger" />
                  : st === 'used' ? <Badge label="Kullanıldı" />
                  : !g.coupon_active ? <Badge label="Kupon pasif" tone="warn" />
                  : <Badge label={`${g.remaining} hak`} tone="ok" />}
                <Button small kind="ghost" label="Kupon" onPress={() => router.navigate(`/kuponlar/${g.coupon_id}`)} />
                <Button small kind="ghost" label="Geri al" onPress={() => takeBack(g)} />
              </View>
            );
          })}
          {givenShown.length > 200 && <T muted size={12.5}>İlk 200 kayıt gösteriliyor; aramayla daralt.</T>}
        </Section>
      )}    </Page>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  half: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '46%', maxWidth: '50%', minWidth: 150, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  link: { textDecorationLine: 'underline' },
});
