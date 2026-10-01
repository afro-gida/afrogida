import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, DaysField, ErrorBox, Field, ListRow, Notice, NumField, Section, Select, T, confirmAsync, sktText } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { couponDiscountText, type Coupon } from '@/lib/types';

type Member = { user_id: string; name?: string; phone?: string };

/**
 * Kupon ver (Kuponlar sayfasında, yeni üye kuponunun altında): önce kupon
 * seçilir; sonra tek üyeye (arama) ya da tüm üyelere, kullanım hakkı ve kaç
 * gün geçerli olacağıyla verilir.
 */
export function CouponGive({ coupons, onGiven }: { coupons: Coupon[]; onGiven: () => void }) {
  const [couponId, setCouponId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);
  // Üyeye ver
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [oneLimit, setOneLimit] = useState(1);
  const [oneUntil, setOneUntil] = useState<string | null>(null);
  // Herkese ver
  const [allLimit, setAllLimit] = useState(1);
  const [allUntil, setAllUntil] = useState<string | null>(null);

  // Üye arama (yazmayı bırakınca)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults([]);
    const t = setTimeout(() => {
      api.get<Member[]>(`/admin/members?search=${encodeURIComponent(q)}`).then((r) => setResults(r.slice(0, 8))).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const coupon = coupons.find((c) => c.id === couponId) ?? null;

  async function run(key: 'one' | 'all', fn: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      setDone(await fn());
      onGiven();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const giveOne = () => run('one', async () => {
    if (!coupon) throw new Error('Önce kupon seç');
    if (!member) throw new Error('Önce üye seç');
    const r = await api.post<{ message: string }>('/admin/coupons/assign-member', {
      coupon_id: coupon.id, user_id: member.user_id, limit: oneLimit, valid_until: oneUntil,
    });
    setMember(null);
    setQuery('');
    return r.message;
  });

  const giveAll = async () => {
    if (!coupon) return setError('Önce kupon seç');
    if (!(await confirmAsync(`"${coupon.code}" TÜM üyelere ${allLimit} kullanım hakkıyla verilsin mi?${allUntil ? ` SKT: ${sktText(allUntil)}.` : ''}`))) return;
    run('all', async () => {
      const r = await api.post<{ message: string }>('/admin/coupons/assign-all', { coupon_id: coupon.id, limit: allLimit, valid_until: allUntil });
      return r.message;
    });
  };

  return (
    <Section title="Kupon ver">
      <Select
        label="Verilecek kupon"
        value={couponId}
        placeholder="Kupon seç"
        options={coupons.map((c) => ({ value: c.id, label: `${c.code} · ${c.title} (${couponDiscountText(c)})` }))}
        onChange={(v) => { setCouponId(v); setDone(null); setError(null); }}
      />
      {coupons.length === 0 && <T muted size={12.5}>Verilebilecek geçerli kupon yok. Önce "Yeni kupon" ile oluştur.</T>}

      {coupon && (
        <View style={styles.cols}>
          <View style={[styles.col, styles.box]}>
            <T bold>Üyeye ver</T>
            <Field label="Üye ara" value={query} onChangeText={(v) => { setQuery(v); setMember(null); }} placeholder="Ad, telefon ya da e-posta" />
            {!member && results.map((m) => (
              <ListRow key={m.user_id} title={m.name || 'İsimsiz'} subtitle={m.phone} onPress={() => { setMember(m); setResults([]); }} />
            ))}
            {member && <Notice text={`Seçili üye: ${member.name || 'İsimsiz'}${member.phone ? ` (${member.phone})` : ''}`} />}
            <NumField label="Kullanım hakkı" value={oneLimit} onChange={(v) => setOneLimit(Math.max(1, Math.round(v)))} hint="Bu üye kuponu kaç kez kullanabilir" />
            <DaysField label="Kaç gün geçerli?" value={oneUntil} onChange={setOneUntil} />
            <View style={styles.actions}>
              <Button icon="gift-outline" label="Üyeye ver" onPress={giveOne} loading={busy === 'one'} disabled={!member} />
            </View>
          </View>

          <View style={[styles.col, styles.box]}>
            <T bold>Tüm üyelere ver</T>
            <T muted size={12.5}>Şu an kayıtlı bütün müşteri üyelere verilir. Daha önce verilenlerin kullanım sayısı korunur.</T>
            <NumField label="Kişi başı kullanım hakkı" value={allLimit} onChange={(v) => setAllLimit(Math.max(1, Math.round(v)))} />
            <DaysField label="Kaç gün geçerli?" value={allUntil} onChange={setAllUntil} />
            <View style={styles.actions}>
              <Button icon="people-outline" label="Tüm üyelere ver" onPress={giveAll} loading={busy === 'all'} />
            </View>
          </View>
        </View>
      )}
      {error && <ErrorBox text={error} />}
      {done && <Notice text={done} />}
    </Section>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexGrow: 1, flexBasis: 320, minWidth: 0, gap: 10 },
  box: { borderWidth: 1, borderColor: '#9993', borderRadius: 10, padding: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
