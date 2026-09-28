import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chips, ErrorBox, Field, Loading, Notice, NumField, Page, Section, T, Toggle, confirmAsync } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { DAYS, EMPTY_MARKET, type Market } from '@/lib/types';

const HOURS = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

export default function MarketEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'yeni';
  const [m, setM] = useState<Omit<Market, 'id'> & { id?: string } | null>(isNew ? { ...EMPTY_MARKET } : null);
  const [hoods, setHoods] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api
      .get<Market[]>('/admin/markets')
      .then((rows) => {
        const found = rows.find((r) => r.id === id);
        if (!found) return setError('Pazar bulunamadı');
        setM(found);
        setHoods((found.delivery_neighborhoods ?? []).join(', '));
      })
      .catch((e) => setError(errMsg(e)));
  }, [id, isNew]);

  if (!m) return <Page title="Pazar">{error ? <ErrorBox text={error} /> : <Loading />}</Page>;

  const set = <K extends keyof Market>(k: K, v: Market[K]) => {
    setSaved(false);
    setM((p) => (p ? { ...p, [k]: v } : p));
  };

  async function save() {
    if (!m) return;
    setError(null);
    if (!m.name.trim()) return setError('Pazar adı zorunlu.');
    for (const [k, label] of [['pazar_saati', 'Pazar saati'], ['gel_al_saati', 'Gel-Al saati'], ['eve_servis_saati', 'Eve Servis saati']] as const) {
      if (!HOURS.test(String(m[k]))) return setError(`${label} SS:DD-SS:DD biçiminde olmalı (ör. 08:00-20:00).`);
    }
    // Sunucu PUT'ta kaydın TAMAMINI yazar -> tüm alanlar gönderilir.
    const body = {
      ...m,
      name: m.name.trim(),
      delivery_neighborhoods: hoods.split(',').map((s) => s.trim()).filter(Boolean),
    };
    delete (body as any).id;
    delete (body as any).created_at;
    delete (body as any).is_open;
    setBusy(true);
    try {
      if (isNew) {
        const created = await api.post<Market>('/admin/markets', body);
        router.replace(`/pazarlar/${created.id}`);
      } else {
        setM(await api.put<Market>(`/admin/markets/${id}`, body));
      }
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmAsync(`"${m?.name}" pazarı silinsin mi? Bu işlem geri alınamaz.`))) return;
    try {
      await api.del(`/admin/markets/${id}`);
      router.replace('/pazarlar');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title={isNew ? 'Yeni pazar' : m.name}
      subtitle={isNew ? undefined : m.day}
      right={<Button small kind="secondary" icon="arrow-back" label="Pazarlar" onPress={() => router.navigate('/pazarlar')} />}
    >
      <Section title="Genel">
        <Field label="Pazar adı" value={m.name} onChangeText={(v) => set('name', v)} />
        <T size={12.5} bold>Gün</T>
        <Chips options={DAYS.map((d) => ({ value: d, label: d }))} value={m.day} onChange={(v) => set('day', v)} />
        <Field label="Google Haritalar bağlantısı" value={m.google_maps_url ?? ''} onChangeText={(v) => set('google_maps_url', v || null)} autoCapitalize="none" />
        <Toggle label="Pazar aktif" hint="Kapalıysa müşteri listesinde görünmez" value={m.active} onChange={(v) => set('active', v)} />
        <Toggle label="Sipariş alımı açık" value={m.orders_enabled} onChange={(v) => set('orders_enabled', v)} />
      </Section>

      <Section title="Saatler">
        <View style={styles.row}>
          <Field style={styles.grow} label="Pazar saati" placeholder="08:00-20:00" value={m.pazar_saati} onChangeText={(v) => set('pazar_saati', v)} />
          <Field style={styles.grow} label="Gel-Al saati" placeholder="11:00-19:00" value={m.gel_al_saati} onChangeText={(v) => set('gel_al_saati', v)} />
          <Field style={styles.grow} label="Eve Servis saati" placeholder="11:00-19:00" value={m.eve_servis_saati} onChangeText={(v) => set('eve_servis_saati', v)} />
        </View>
      </Section>

      <Section title="Gel-Al">
        <Toggle label="Gel-Al açık" value={m.active_gel_al} onChange={(v) => set('active_gel_al', v)} />
        <View style={styles.row}>
          <NumField label="Minimum sepet" suffix="₺" value={m.gel_al_min_tutar} onChange={(v) => set('gel_al_min_tutar', v)} />
        </View>
      </Section>

      <Section title="Eve Servis">
        <Toggle label="Eve Servis açık" value={m.active_eve_servis} onChange={(v) => { set('active_eve_servis', v); set('delivery_enabled', v); }} />
        <View style={styles.row}>
          <NumField label="Minimum sepet" suffix="₺" value={m.eve_servis_min_tutar} onChange={(v) => set('eve_servis_min_tutar', v)} />
          <NumField label="Teslimat ücreti" suffix="₺" value={m.teslimat_ucreti} onChange={(v) => set('teslimat_ucreti', v)} />
          <NumField label="Ücretsiz teslimat alt limiti" suffix="₺" value={m.ucretsiz_teslimat_alt_limiti} onChange={(v) => set('ucretsiz_teslimat_alt_limiti', v)} hint="0 = ücretsiz teslimat yok" />
        </View>
        <Field
          label="Servis mahalleleri (virgülle)"
          hint="Boş bırakılırsa mahalle kısıtı yok. Ör: Görükle, Kurtuluş, İrfaniye"
          value={hoods}
          onChangeText={(v) => { setSaved(false); setHoods(v); }}
          multiline
        />
      </Section>

      <Section title="Ödeme">
        <Toggle label="Online kart ödemesi" value={m.online_payment_enabled} onChange={(v) => set('online_payment_enabled', v)} />
        <Toggle label="Kapıda / tezgahta nakit ödeme" value={m.kapida_nakit_odeme_enabled} onChange={(v) => set('kapida_nakit_odeme_enabled', v)} />
        <Toggle label="Nakit için üst limit" value={m.nakit_tezgah_limit_enabled} onChange={(v) => set('nakit_tezgah_limit_enabled', v)} />
        {m.nakit_tezgah_limit_enabled && (
          <View style={styles.row}>
            <NumField label="Nakit üst limit" suffix="₺" value={m.nakit_tezgah_maksimum_tutari} onChange={(v) => set('nakit_tezgah_maksimum_tutari', v)} hint="Üstündeki siparişlerde sadece online ödeme" />
          </View>
        )}
      </Section>

      {error && <ErrorBox text={error} />}
      {saved && <Notice text="Kaydedildi. Müşteri sitesinde hemen geçerli." />}
      <View style={styles.actions}>
        <Button label={isNew ? 'Pazarı oluştur' : 'Kaydet'} icon="save-outline" onPress={save} loading={busy} />
        {!isNew && <Button kind="danger" icon="trash-outline" label="Pazarı sil" onPress={remove} />}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  grow: { flexGrow: 1, flexBasis: 200 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
});
