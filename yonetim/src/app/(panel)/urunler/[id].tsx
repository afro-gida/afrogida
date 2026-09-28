import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chips, ErrorBox, Field, Loading, Notice, NumField, Page, Section, T, Toggle, confirmAsync, money } from '@/components/ui';
import { api, errMsg, uploadImage } from '@/lib/api';
import { pickImage, shrinkImage } from '@/lib/image';
import { salePrice, type CatalogConfig, type OptionGroup, type Product } from '@/lib/types';
import { LAST_TIER_MAX, profitFor } from '@/lib/pricing';
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
  const { id, t: fromSupplier } = useLocalSearchParams<{ id: string; t?: string }>();
  const router = useRouter();
  const t = useTheme();
  const isNew = id === 'yeni';
  const [p, setP] = useState<(Omit<Product, 'id'> & { id?: string }) | null>(
    isNew ? { ...EMPTY, supplier_group: fromSupplier ?? '' } : null,
  );
  // Geri / silme sonrası: ürünün tedarikçisinin listesine dön.
  const backToList = () =>
    router.navigate(p?.supplier_group ? `/urunler?t=${encodeURIComponent(p.supplier_group)}` : '/urunler');
  const [cfg, setCfg] = useState<CatalogConfig>({});
  const [origSupp, setOrigSupp] = useState(0);
  const [uploading, setUploading] = useState<'camera' | 'gallery' | null>(null);
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
        setOrigSupp(Number(found.supplier_price || 0));
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
  // Kâr modeli otomatik: satış = alış + kademe kârı (asıl hesap sunucuda)
  const autoProfit = profitFor(supp);
  const groups: OptionGroup[] = (p.customization_options as OptionGroup[]) ?? [];
  const setGroups = (g: OptionGroup[]) => set('customization_options', g);

  async function save() {
    if (!p) return;
    setError(null);
    if (!p.name.trim()) return setError('Ürün adı zorunlu.');
    if (!p.supplier_group) return setError('Tedarikçi seçin.');
    // Alış fiyatı 5 TL'nin katı (sadece fiyat değiştiyse — eski ürün kaydedilebilsin)
    if (supp !== origSupp && Math.round(supp * 100) % 500 !== 0) {
      return setError('Alış fiyatı 5 TL\'nin katı olmalı (5, 10, 15, 20 …).');
    }
    if (autoProfit == null) {
      return setError(supp > LAST_TIER_MAX ? `${LAST_TIER_MAX} ₺ üstü alış fiyatı için kâr kademesi yok.` : 'Alış fiyatını girin.');
    }
    for (const g of groups) {
      if (!g.title.trim() || g.choices.length === 0 || g.choices.some((c) => !c.label.trim())) {
        return setError('Seçenek gruplarında boş başlık veya seçenek var.');
      }
    }
    // Ürünün tamamı + alış fiyatı gönderilir; satış fiyatını ve kârı sunucu
    // kâr tablosundan hesaplar (gönderilen satış fiyatı yok sayılır).
    const body: any = {
      ...p,
      name: p.name.trim(),
      supplier_price: supp,
      customization_options: groups.length ? groups : null,
    };
    for (const f of ['sale_price', 'profit_margin_amount', 'price', 'gel_al_price', 'eve_servis_price']) delete body[f];
    delete body.id;
    delete body.created_at;
    delete body.updated_at;
    setBusy(true);
    try {
      if (isNew) await api.post<Product>('/admin/products', body);
      else await api.put<Product>(`/admin/products/${id}`, body);
      // Kaydedince ürünün tedarikçisinin listesine dön
      backToList();
      return;
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Galeri / kamera -> cihazda küçült -> yükle (sunucu ayrıca WebP'ye çevirir)
  async function addPhoto(camera: boolean) {
    if (Platform.OS !== 'web') return; // iPhone/iPad sürümünde yerel seçici eklenecek
    const file = await pickImage(camera);
    if (!file) return;
    setUploading(camera ? 'camera' : 'gallery');
    setError(null);
    try {
      const small = await shrinkImage(file);
      set('image_url', await uploadImage(small, 'urun.jpg'));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(null);
    }
  }

  async function remove() {
    if (!(await confirmAsync(`"${p?.name}" silinsin mi?`))) return;
    try {
      await api.del(`/admin/products/${id}`);
      backToList();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title={isNew ? 'Yeni ürün' : p.name}
      subtitle={isNew ? undefined : `${p.supplier_group} · ${money(salePrice(p as Product))} / ${p.unit}`}
      right={<Button small kind="secondary" icon="arrow-back" label={p.supplier_group || 'Ürünler'} onPress={backToList} />}
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
      </Section>

      <Section title="Görsel">
        <View style={styles.photoRow}>
          <View style={[styles.photo, { borderColor: t.border, backgroundColor: t.cardAlt }]}>
            {p.image_url ? (
              <Image source={{ uri: p.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <T muted size={12}>Resim yok</T>
            )}
          </View>
          <View style={styles.photoBtns}>
            <Button kind="secondary" icon="images-outline" label="Galeriden yükle" loading={uploading === 'gallery'} disabled={!!uploading} onPress={() => addPhoto(false)} />
            <Button kind="secondary" icon="camera-outline" label="Kamera ile çek" loading={uploading === 'camera'} disabled={!!uploading} onPress={() => addPhoto(true)} />
            {!!p.image_url && <Button small kind="ghost" icon="trash-outline" label="Resmi kaldır" onPress={() => set('image_url', null)} />}
          </View>
        </View>
        <T muted size={12}>Resim otomatik küçültülür (site hızlı kalsın). Kaydet'e basınca üründe görünür.</T>
      </Section>

      <Section title="Fiyat">
        <View style={styles.pair}>
          <NumField style={styles.half} label="Alış fiyatı" suffix="₺" value={supp} onChange={(v) => set('supplier_price', v)} hint="5 TL'nin katı · müşteri görmez" />
          <View style={[styles.half, styles.saleBox, { borderColor: t.border, backgroundColor: t.cardAlt }]}>
            <T size={12.5} bold muted>Satış fiyatı (otomatik)</T>
            {autoProfit != null ? (
              <T bold size={20} color={t.tint}>{money(supp + autoProfit)}</T>
            ) : (
              <T size={12.5} color={t.danger}>
                {supp > LAST_TIER_MAX ? `${LAST_TIER_MAX} ₺ üstü alış için kâr kademesi yok` : 'Alış fiyatını girin'}
              </T>
            )}
          </View>
        </View>
      </Section>

      <Section title="Durum">
        <Toggle label="Stokta" hint="Kapatınca müşteride 'Tükendi' görünür" value={p.in_stock} onChange={(v) => set('in_stock', v)} />
        <Toggle label="Aktif" hint="Kapatınca ürün müşteri sitesinde görünmez" value={p.active} onChange={(v) => set('active', v)} />
      </Section>

      <Section title="Kampanya (çok al az öde)">
        <View style={styles.pair}>
          <NumField style={styles.half} label="İndirim" suffix="%" value={p.campaign_discount_percent ?? 0} onChange={(v) => set('campaign_discount_percent', Math.min(90, v))} />
          <NumField style={styles.half} label="En az miktar" suffix={p.unit} value={p.campaign_min_qty ?? 0} onChange={(v) => set('campaign_min_qty', v)} />
        </View>
        <T muted size={12}>İkisi de doluysa kampanya aktif olur.</T>
      </Section>

      <Section
        title="Seçenekler (Boyut, Şekil…)"
        right={<Button small kind="secondary" icon="add" label="Grup ekle" onPress={() => setGroups([...groups, { title: '', choices: [{ label: 'İstemiyorum', price_delta: 0 }] }])} />}
      >
        <T muted size={12.5}>Ek fiyat kilo/adet başına satış fiyatına eklenir ve tamamen platformun olur. "İstemiyorum" / "Seçmiyorum" varsayılan seçimdir.</T>
        {groups.map((g, gi) => (
          <View key={gi} style={[styles.group, { borderColor: t.border }]}>
            <View style={styles.titleRow}>
              <Field style={styles.flex} label="Grup adı" placeholder="Boyut" value={g.title} onChangeText={(v) => setGroups(groups.map((x, i) => (i === gi ? { ...x, title: v } : x)))} />
              <Pressable onPress={() => setGroups(groups.filter((_, i) => i !== gi))} accessibilityLabel="Grubu sil" style={[styles.iconBtn, { backgroundColor: t.danger }]}>
                <Ionicons name="trash-outline" size={17} color="#fff" />
              </Pressable>
            </View>
            {/* Başlıklar bir kez; her seçenek tek satır: ad · ek fiyat · sil */}
            <View style={styles.choiceHead}>
              <T size={12} bold muted style={styles.flex}>Seçenek</T>
              <T size={12} bold muted style={styles.priceCol}>Ek fiyat (₺)</T>
              <View style={styles.iconSpace} />
            </View>
            {g.choices.map((c, ci) => (
              <View key={ci} style={styles.choiceRow}>
                <TextInput
                  value={c.label}
                  placeholder="Örn: Büyük"
                  placeholderTextColor={t.muted}
                  onChangeText={(v) => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, label: v } : y)) } : x)))}
                  style={[styles.cell, styles.flex, { backgroundColor: t.input, borderColor: t.border, color: t.text }]}
                />
                <TextInput
                  value={String(c.price_delta ?? 0)}
                  keyboardType="number-pad"
                  onChangeText={(v) => {
                    const n = Number(v.replace(/[^\d]/g, '')) || 0;
                    setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.map((y, j) => (j === ci ? { ...y, price_delta: n } : y)) } : x)));
                  }}
                  style={[styles.cell, styles.priceCol, { backgroundColor: t.input, borderColor: t.border, color: t.text, textAlign: 'center' }]}
                />
                <Pressable
                  onPress={() => setGroups(groups.map((x, i) => (i === gi ? { ...x, choices: x.choices.filter((_, j) => j !== ci) } : x)))}
                  accessibilityLabel="Seçeneği sil"
                  style={[styles.iconBtn, { backgroundColor: t.cardAlt }]}
                >
                  <Ionicons name="close" size={18} color={t.danger} />
                </Pressable>
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
  flex: { flex: 1 },
  // İki eşit sütun (dar ekranda da yan yana)
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  half: { flex: 1, minWidth: 0 },
  saleBox: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 2, marginTop: 20, minHeight: 42, justifyContent: 'center' },
  photoRow: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  photo: { width: 120, height: 120, borderRadius: 12, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoBtns: { flex: 1, minWidth: 170, gap: 8 },
  titleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  choiceHead: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 },
  choiceRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  cell: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, minWidth: 0 },
  priceCol: { width: 92 },
  iconBtn: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconSpace: { width: 38 },
  group: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
});
