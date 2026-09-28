import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Button, Chips, ErrorBox, Field, Loading, Notice, NumField, Page, Section, T, Toggle, confirmAsync, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { salePrice, type CatalogConfig, type OptionGroup, type Product } from '@/lib/types';
import { useTheme } from '@/lib/theme';

const UNITS = ['Kg', 'Adet', 'Demet', 'Paket', 'Litre'];

const EMPTY: Omit<Product, 'id'> = {
  name: '',
  category: 'Sebze',
  subcategory: 'Diğer',
  supplier_group: '',
  unit: 'Kg',
  image_url: null,
  description: '',
  in_stock: true,
  active: true,
  hidden: false,
  supplier_price: 0,
  profit_margin_amount: 0,
  sale_price: 0,
  price: 0,
  campaign_discount_percent: 0,
  campaign_min_qty: 0,
  customization_options: [],
};

export default function ProductEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const isNew = id === 'yeni';
  const [p, setP] = useState<(Omit<Product, 'id'> & { id?: string }) | null>(isNew ? { ...EMPTY } : null);
  const [sale, setSale] = useState<number>(0);
  const [cfg, setCfg] = useState<CatalogConfig>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<CatalogConfig>('/admin/catalog-config').then(setCfg).catch(() => {});
    if (isNew) return;
    api
      .get<Product[]>('/admin/products')
      .then((rows) => {
        const found = rows.find((r) => r.id === id);
        if (!found) return setError('Ürün bulunamadı');
        setP({ ...found, customization_options: found.customization_options ?? [] });
        setSale(salePrice(found));
      })
      .catch((e) => setError(errMsg(e)));
  }, [id, isNew]);

  if (!p) return <Page title="Ürün">{error ? <ErrorBox text={error} /> : <Loading />}</Page>;

  const set = <K extends keyof Product>(k: K, v: Product[K]) => {
    setSaved(false);
    setP((x) => (x ? { ...x, [k]: v } : x));
  };

  const mains = cfg.categories ?? ['Sebze', 'Meyve', 'Yeşillik', 'Zeytin Ürünleri'];
  const subs = cfg.subcategories?.[p.category] ?? [];
  const suppliers = cfg.suppliers?.length ? cfg.suppliers : [...new Set([p.supplier_group || ''].filter(Boolean))];
  const supp = Number(p.supplier_price || 0);
  const margin = sale - supp;
  const groups: OptionGroup[] = (p.customization_options as OptionGroup[]) ?? [];
  const setGroups = (g: OptionGroup[]) => set('customization_options', g);

  async function save() {
    if (!p) return;
    setError(null);
    if (!p.name.trim()) return setError('Ürün adı zorunlu.');
    if (!p.supplier_group) return setError('Tedarikçi seçin.');
    if (sale <= 0) return setError('Satış fiyatı girin.');
    if (supp > 0 && sale < supp) return setError('Satış fiyatı tedarikçi fiyatının altında olamaz.');
    for (const g of groups) {
      if (!g.title.trim() || g.choices.length === 0 || g.choices.some((c) => !c.label.trim())) {
        return setError('Seçenek gruplarında boş başlık veya seçenek var.');
      }
    }
    // Sunucu PUT'ta kaydın tamamını yazar (gönderilmeyen alan varsayılana döner)
    // -> ürünün tamamı gönderilir. Fiyat: satış = tedarikçi fiyatı + kâr.
    const body: any = {
      ...p,
      name: p.name.trim(),
      supplier_price: supp,
      profit_margin_amount: Math.max(0, margin),
      sale_price: sale,
      price: sale,
      gel_al_price: sale,
      eve_servis_price: sale,
      customization_options: groups.length ? groups : null,
    };
    delete body.id;
    delete body.created_at;
    delete body.updated_at;
    setBusy(true);
    try {
      if (isNew) {
        const created = await api.post<Product>('/admin/products', body);
        router.replace(`/urunler/${created.id}`);
      } else {
        const updated = await api.put<Product>(`/admin/products/${id}`, body);
        setP({ ...updated, customization_options: updated.customization_options ?? [] });
        setSale(salePrice(updated));
      }
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmAsync(`"${p?.name}" silinsin mi?`))) return;
    try {
      await api.del(`/admin/products/${id}`);
      router.replace('/urunler');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title={isNew ? 'Yeni ürün' : p.name}
      subtitle={isNew ? undefined : `${p.supplier_group} · ${money(salePrice(p as Product))} / ${p.unit}`}
      right={<Button small kind="secondary" icon="arrow-back" label="Ürünler" onPress={() => router.navigate('/urunler')} />}
    >
      <Section title="Genel">
        <View style={styles.row}>
          <Field style={styles.grow} label="Ürün adı" value={p.name} onChangeText={(v) => set('name', v)} />
          <View style={styles.grow}>
            <T size={12.5} bold>Birim</T>
            <Chips options={UNITS.map((u) => ({ value: u, label: u }))} value={p.unit} onChange={(v) => set('unit', v)} />
          </View>
        </View>
        <T size={12.5} bold>Tedarikçi</T>
        <Chips options={suppliers.map((s) => ({ value: s, label: s }))} value={p.supplier_group || ''} onChange={(v) => set('supplier_group', v)} />
        <T size={12.5} bold>Ana kategori</T>
        <Chips options={mains.map((c) => ({ value: c, label: c }))} value={p.category} onChange={(v) => { set('category', v); set('subcategory', 'Diğer'); }} />
        {subs.length > 0 && (
          <>
            <T size={12.5} bold>Alt kategori</T>
            <Chips options={subs.map((c) => ({ value: c, label: c }))} value={p.subcategory || ''} onChange={(v) => set('subcategory', v)} />
          </>
        )}
        <Field label="Açıklama" value={p.description ?? ''} onChangeText={(v) => set('description', v)} multiline />
        <View style={styles.row}>
          <Field style={styles.grow} label="Görsel adresi (URL)" autoCapitalize="none" value={p.image_url ?? ''} onChangeText={(v) => set('image_url', v || null)} />
          {!!p.image_url && <Image source={{ uri: p.image_url }} style={[styles.thumb, { borderColor: t.border }]} />}
        </View>
      </Section>

      <Section title="Fiyat">
        <View style={styles.row}>
          <NumField label="Tedarikçi fiyatı (alış)" suffix="₺" value={supp} onChange={(v) => set('supplier_price', v)} hint="Müşteri bu fiyatı asla görmez" />
          <NumField label="Satış fiyatı" suffix="₺" value={sale} onChange={(v) => { setSaved(false); setSale(v); }} hint="Müşterinin gördüğü fiyat" />
        </View>
        <T muted>
          Platform kârı: <T bold color={margin < 0 ? t.danger : t.ok}>{money(margin)}</T> / {p.unit.toLowerCase()}
        </T>
      </Section>

      <Section title="Durum">
        <Toggle label="Stokta" hint="Kapatınca müşteride 'Tükendi' görünür" value={p.in_stock} onChange={(v) => set('in_stock', v)} />
        <Toggle label="Aktif" value={p.active} onChange={(v) => set('active', v)} />
        <Toggle label="Gizli" hint="Müşteri listesinde hiç görünmez" value={p.hidden} onChange={(v) => set('hidden', v)} />
      </Section>

      <Section title="Kampanya (çok al az öde)">
        <View style={styles.row}>
          <NumField label="İndirim" suffix="%" value={p.campaign_discount_percent ?? 0} onChange={(v) => set('campaign_discount_percent', Math.min(90, v))} />
          <NumField label="En az miktar" suffix={p.unit} value={p.campaign_min_qty ?? 0} onChange={(v) => set('campaign_min_qty', v)} hint="İkisi de doluysa kampanya aktif" />
        </View>
      </Section>

      <Section
        title="Seçenekler (Boyut, Şekil…)"
        right={<Button small kind="secondary" icon="add" label="Grup ekle" onPress={() => setGroups([...groups, { title: '', choices: [{ label: 'İstemiyorum', price_delta: 0 }] }])} />}
      >
        <T muted size={12.5}>Ek fiyat kilo/adet başına satış fiyatına eklenir ve tamamen platformun olur. "İstemiyorum" / "Seçmiyorum" varsayılan seçimdir.</T>
        {groups.map((g, gi) => (
          <View key={gi} style={[styles.group, { borderColor: t.border }]}>
            <View style={styles.row}>
              <Field style={styles.grow} label="Grup adı" placeholder="Boyut" value={g.title} onChangeText={(v) => setGroups(groups.map((x, i) => (i === gi ? { ...x, title: v } : x)))} />
              <Button small kind="danger" icon="trash-outline" label="Grubu sil" onPress={() => setGroups(groups.filter((_, i) => i !== gi))} />
            </View>
            {g.choices.map((c, ci) => (
              <View key={ci} style={styles.row}>
                <Field
                  style={styles.grow}
                  label="Seçenek"
                  value={c.label}
                  onChangeText={(v) => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, label: v } : y)) } : x)))}
                />
                <NumField
                  label="Ek fiyat"
                  suffix="₺"
                  value={c.price_delta ?? 0}
                  onChange={(v) => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, price_delta: v } : y)) } : x)))}
                />
                <Button small kind="ghost" icon="close" label="" onPress={() => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.filter((_, j) => j !== ci) } : x)))} />
              </View>
            ))}
            <Button small kind="ghost" icon="add" label="Seçenek ekle" onPress={() => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: [...x.choices, { label: '', price_delta: 0 }] } : x)))} />
          </View>
        ))}
      </Section>

      {error && <ErrorBox text={error} />}
      {saved && <Notice text="Kaydedildi. Müşteri sitesinde hemen geçerli." />}
      <View style={styles.actions}>
        <Button label={isNew ? 'Ürünü oluştur' : 'Kaydet'} icon="save-outline" onPress={save} loading={busy} />
        {!isNew && <Button kind="danger" icon="trash-outline" label="Ürünü sil" onPress={remove} />}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  grow: { flexGrow: 1, flexBasis: 200 },
  thumb: { width: 72, height: 72, borderRadius: 8, borderWidth: 1 },
  group: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
});
