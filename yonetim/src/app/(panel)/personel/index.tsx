import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, ErrorBox, Field, ListRow, Loading, MultiChips, Notice, Page, Section, Select, T, Chips, confirmAsync } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { DAYS, todayName, type CatalogConfig, type Market } from '@/lib/types';

type Staff = { user_id: string; name?: string; phone?: string; supplier_group?: string | null; managed_markets?: string[]; courier_markets?: string[] };

/**
 * Personel ve zincir: Yönetici → Pazar sorumlusu (pazarları) → Tedarikçiler
 * (hangi pazarlarda satıyor) → Tedarikçi hesapları, ayrıca Kuryeler (pazarları).
 * Atanacak kişinin önce müşteri sitesinden üye olmuş olması gerekir; telefon
 * numarasıyla bulunur.
 */
export default function StaffScreen() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [cfg, setCfg] = useState<CatalogConfig | null>(null);
  const [managers, setManagers] = useState<Staff[]>([]);
  const [suppliersUsers, setSuppliersUsers] = useState<Staff[]>([]);
  const [couriers, setCouriers] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mk, c, mg, su, co] = await Promise.all([
        api.get<Market[]>('/admin/markets'),
        api.get<CatalogConfig>('/admin/catalog-config'),
        api.get<Staff[]>('/admin/pazar-sorumlulari'),
        api.get<Staff[]>('/admin/staff'),
        api.get<Staff[]>('/admin/couriers'),
      ]);
      setMarkets(mk);
      setCfg(c);
      setManagers(mg);
      setSuppliersUsers(su);
      setCouriers(co);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const ok = (msg: string) => {
    setDone(msg);
    setError(null);
    load();
  };
  const fail = (e: unknown) => {
    setDone(null);
    setError(errMsg(e));
  };

  if (loading) return <Page title="Personel"><Loading /></Page>;

  const marketName = (id: string) => markets.find((m) => m.id === id)?.name ?? id;
  const marketOptionsById = markets.map((m) => ({ value: m.id, label: `${m.name} (${m.day})` }));
  const marketOptionsByName = markets.map((m) => ({ value: m.name, label: `${m.name} (${m.day})` }));
  const supplierGroups = cfg?.suppliers ?? [];

  return (
    <Page title="Personel" subtitle="Sorumlu → tedarikçi → kurye zinciri">
      {error && <ErrorBox text={error} />}
      {done && <Notice text={done} />}

      <ManagerSection managers={managers} marketName={marketName} marketOptions={marketOptionsById} onOk={ok} onFail={fail} />
      <SupplierChainSection cfg={cfg} markets={markets} onOk={ok} onFail={fail} />
      <SupplierUsersSection users={suppliersUsers} groups={supplierGroups} onOk={ok} onFail={fail} />
      <CourierSection couriers={couriers} marketOptions={marketOptionsByName} onOk={ok} onFail={fail} />
    </Page>
  );
}

type Cb = { onOk: (msg: string) => void; onFail: (e: unknown) => void };

function ManagerSection({ managers, marketName, marketOptions, onOk, onFail }: Cb & {
  managers: Staff[]; marketName: (id: string) => string; marketOptions: { value: string; label: string }[];
}) {
  const [phone, setPhone] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function assign(identifier: string, managed: string[], msg: string) {
    setBusy(true);
    try {
      await api.post('/admin/pazar-sorumlusu/assign', { identifier, managed_markets: managed });
      setPhone('');
      setSel([]);
      onOk(msg);
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="1. Pazar sorumluları">
      <T muted size={12.5}>Sorumlu sadece atandığı pazarları ve o pazarların tedarikçilerini yönetir.</T>
      {managers.length === 0 && <T muted>Henüz sorumlu yok.</T>}
      {managers.map((m) => (
        <ListRow
          key={m.user_id}
          title={`${m.name || 'İsimsiz'} · ${m.phone ?? ''}`}
          subtitle={(m.managed_markets ?? []).map(marketName).join(', ') || 'Pazar yok'}
          right={
            <View style={styles.rowBtns}>
              <Button small kind="secondary" label="Düzenle" onPress={() => { setPhone(m.phone ?? m.user_id); setSel(m.managed_markets ?? []); }} />
              <Button small kind="danger" label="Kaldır" onPress={async () => { if (await confirmAsync(`${m.name} sorumluluktan alınsın mı?`)) assign(m.user_id, [], 'Sorumluluk kaldırıldı.'); }} />
            </View>
          }
        />
      ))}
      <Field label="Telefon (üye olmuş olmalı)" placeholder="05xxxxxxxxx" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <T size={12.5} bold>Yöneteceği pazarlar</T>
      <MultiChips options={marketOptions} values={sel} onChange={setSel} />
      <Button label="Sorumlu ata / güncelle" icon="person-add-outline" loading={busy} disabled={!phone.trim() || sel.length === 0} onPress={() => assign(phone.trim(), sel, 'Pazar sorumlusu kaydedildi.')} />
    </Section>
  );
}

const normName = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/**
 * Pazar pazar tedarikçi seçimi: her pazarın altında tüm tedarikçiler; seçilenler
 * o pazarda satış yapar. Veride eşleşme tedarikçi -> pazar adları
 * (catalog_config.supplier_markets) olarak durur; burada tersine çevrilip
 * gösterilir. Mevcut pazarlarda olmayan eski pazar adları korunur.
 */
function SupplierChainSection({ cfg, markets, onOk, onFail }: Cb & { cfg: CatalogConfig | null; markets: Market[] }) {
  const [map, setMap] = useState<Record<string, string[]>>(cfg?.supplier_markets ?? {});
  const [list, setList] = useState<string[]>(cfg?.suppliers ?? []);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Gün kutusu: sadece seçilen günün pazarları listelenir (başta bugün).
  // Bugün pazar yoksa haftada pazarı olan ilk gün (boş liste gösterilmesin)
  const [day, setDay] = useState<string>(() =>
    markets.some((m) => m.day === todayName()) ? todayName() : DAYS.find((d) => markets.some((m) => m.day === d)) ?? todayName(),
  );
  const dayMarkets = markets.filter((m) => m.day === day);

  const sells = (sg: string, m: Market) => (map[sg] ?? []).some((n) => normName(n) === normName(m.name));
  const toggle = (sg: string, m: Market) => {
    const cur = map[sg] ?? [];
    setMap({ ...map, [sg]: sells(sg, m) ? cur.filter((n) => normName(n) !== normName(m.name)) : [...cur, m.name] });
    setDirty(true);
  };

  useEffect(() => {
    setMap(cfg?.supplier_markets ?? {});
    setList(cfg?.suppliers ?? []);
    setDirty(false);
  }, [cfg]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      // Katalog ayarının tamamı yazılır (kategoriler vb. korunur).
      await api.put('/admin/catalog-config', { ...cfg, suppliers: list, supplier_markets: map });
      setDirty(false);
      onOk('Tedarikçi–pazar eşleşmesi kaydedildi. Müşteri sitesinde hemen geçerli.');
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="2. Pazarlar ve tedarikçileri">
      <T muted size={12.5}>Her pazarda satış yapacak tedarikçilere dokun. Müşteri bir pazarda sadece o pazarın tedarikçilerinin ürünlerini görür.</T>
      <Select
        label="Gün"
        options={DAYS.map((d) => ({ value: d, label: `${d} (${markets.filter((m) => m.day === d).length} pazar)` }))}
        value={day}
        onChange={setDay}
      />
      {dayMarkets.length === 0 && <T muted>{day} günü kurulan pazar yok.</T>}
      {dayMarkets.map((m) => {
        const count = list.filter((sg) => sells(sg, m)).length;
        return (
          <View key={m.id} style={styles.chain}>
            <View style={styles.rowBtns}>
              <T bold style={{ flex: 1 }}>{m.name} · {m.day}</T>
              <Badge label={`${count} tedarikçi`} tone={count ? 'ok' : 'danger'} />
            </View>
            <MultiChips
              options={list.map((sg) => ({ value: sg, label: sg }))}
              values={list.filter((sg) => sells(sg, m))}
              onChange={(v) => {
                const changed = list.find((sg) => v.includes(sg) !== sells(sg, m));
                if (changed) toggle(changed, m);
              }}
            />
          </View>
        );
      })}
      {list.some((sg) => !markets.some((m) => sells(sg, m))) && (
        <T muted size={12.5}>
          Hiçbir pazarda olmayan: {list.filter((sg) => !markets.some((m) => sells(sg, m))).join(', ')}
        </T>
      )}
      <View style={styles.rowBtns}>
        <Field style={{ flex: 1 }} label="Yeni tedarikçi adı" placeholder="Ör: Ali Sebze" value={newName} onChangeText={setNewName} />
        <Button
          small
          kind="secondary"
          icon="add"
          label="Ekle"
          disabled={!newName.trim() || list.includes(newName.trim())}
          onPress={() => { const n = newName.trim(); setList([...list, n]); setMap({ ...map, [n]: [] }); setNewName(''); setDirty(true); }}
        />
      </View>
      <Button label={dirty ? 'Eşleşmeyi kaydet' : 'Kaydedildi'} icon="save-outline" disabled={!dirty} loading={busy} onPress={save} />
    </Section>
  );
}

function SupplierUsersSection({ users, groups, onOk, onFail }: Cb & { users: Staff[]; groups: string[] }) {
  const [phone, setPhone] = useState('');
  const [group, setGroup] = useState(groups[0] ?? '');
  const [busy, setBusy] = useState(false);

  async function assign(identifier: string, sg: string | null, msg: string) {
    setBusy(true);
    try {
      await api.post('/admin/staff/assign', { identifier, supplier_group: sg });
      setPhone('');
      onOk(msg);
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="3. Tedarikçi hesapları (esnaf)">
      <T muted size={12.5}>Esnafın kendi uygulamasına girip ürün/fiyat güncelleyebileceği hesap. Her hesap bir tedarikçiye bağlanır.</T>
      {users.length === 0 && <T muted>Henüz tedarikçi hesabı yok.</T>}
      {users.map((u) => (
        <ListRow
          key={u.user_id}
          title={`${u.name || 'İsimsiz'} · ${u.phone ?? ''}`}
          subtitle={u.supplier_group ?? '-'}
          right={<Button small kind="danger" label="Kaldır" onPress={async () => { if (await confirmAsync(`${u.name} tedarikçi yetkisinden alınsın mı?`)) assign(u.user_id, null, 'Tedarikçi yetkisi kaldırıldı.'); }} />}
        />
      ))}
      <Field label="Telefon (üye olmuş olmalı)" placeholder="05xxxxxxxxx" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <T size={12.5} bold>Bağlı olacağı tedarikçi</T>
      <Chips options={groups.map((g) => ({ value: g, label: g }))} value={group} onChange={setGroup} />
      <Button label="Tedarikçi hesabı ata" icon="person-add-outline" loading={busy} disabled={!phone.trim() || !group} onPress={() => assign(phone.trim(), group, 'Tedarikçi hesabı atandı.')} />
    </Section>
  );
}

function CourierSection({ couriers, marketOptions, onOk, onFail }: Cb & { couriers: Staff[]; marketOptions: { value: string; label: string }[] }) {
  const [phone, setPhone] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function assign(identifier: string, mk: string[], msg: string) {
    setBusy(true);
    try {
      await api.post('/admin/courier/assign', { identifier, courier_markets: mk });
      setPhone('');
      setSel([]);
      onOk(msg);
    } catch (e) {
      onFail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="4. Kuryeler">
      {couriers.length === 0 && <T muted>Henüz kurye yok.</T>}
      {couriers.map((c) => (
        <ListRow
          key={c.user_id}
          title={`${c.name || 'İsimsiz'} · ${c.phone ?? ''}`}
          subtitle={(c.courier_markets ?? []).join(', ') || 'Pazar yok'}
          right={
            <View style={styles.rowBtns}>
              <Button small kind="secondary" label="Düzenle" onPress={() => { setPhone(c.phone ?? c.user_id); setSel(c.courier_markets ?? []); }} />
              <Button small kind="danger" label="Kaldır" onPress={async () => { if (await confirmAsync(`${c.name} kuryelikten alınsın mı?`)) assign(c.user_id, [], 'Kuryelik kaldırıldı.'); }} />
            </View>
          }
        />
      ))}
      <Field label="Telefon (üye olmuş olmalı)" placeholder="05xxxxxxxxx" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <T size={12.5} bold>Çalışacağı pazarlar</T>
      <MultiChips options={marketOptions} values={sel} onChange={setSel} />
      <Button label="Kurye ata / güncelle" icon="bicycle-outline" loading={busy} disabled={!phone.trim() || sel.length === 0} onPress={() => assign(phone.trim(), sel, 'Kurye kaydedildi.')} />
    </Section>
  );
}

const styles = StyleSheet.create({
  rowBtns: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  chain: { gap: 6, paddingBottom: 8 },
});
