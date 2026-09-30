import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, uploadImage } from '@/lib/api';
import { pickImage, shrinkImage } from '@/lib/image';
import { Spacing } from '@/constants/theme';

const UNIT_OPTIONS = ['Kg', 'Adet', 'File', 'Demet'];
/** Alış fiyatı 5 TL'nin katı (sunucu da denetler: backend/core/pricing.py). */
const PRICE_STEP = 5;

type Product = {
  id: string;
  name: string;
  category: string; // alt kategori (ör. "Domates")
  subcategory?: string; // ana kategori (ör. "Sebze")
  unit: string;
  supplier_price?: number | null; // tedarikçi sadece kendi fiyatını görür
  image_url?: string | null;
  description?: string | null;
  in_stock: boolean;
  active: boolean;
  pending_approval?: 'new' | 'update' | null;
  [k: string]: unknown;
};

type CatalogConfig = { categories: string[]; subcategories: Record<string, string[]> };
type Choice = { label: string; price_delta: number };
type OptionGroup = { title: string; choices: Choice[] };
/** Her grubun en altında sabit, 0 TL, silinemeyen seçenek (sunucu da zorlar). */
const NONE_CHOICE = 'İstemiyorum';
const isNone = (label: string) => ['istemiyorum', 'seçmiyorum', 'farketmez', 'fark etmez'].includes(label.trim().toLocaleLowerCase('tr-TR'));


/**
 * Ürün ekle / düzenle — tam ekran. Resim, ad, kategori, birim, kendi fiyatım,
 * stok. Müşteri fiyatını sunucu hesaplar (tedarikçi göremez / değiştiremez).
 */
export default function UrunDuzenle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'yeni';
  const router = useRouter();
  const theme = useTheme();
  const [catalog, setCatalog] = useState<CatalogConfig | null>(null);
  const [orig, setOrig] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [mainCat, setMainCat] = useState('');
  const [leafCat, setLeafCat] = useState('');
  const [unit, setUnit] = useState('Kg');
  const [price, setPrice] = useState('');
  const [inStock, setInStock] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [campaignPct, setCampaignPct] = useState('');
  const [campaignMin, setCampaignMin] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get<CatalogConfig>('/catalog-config'), isNew ? Promise.resolve([]) : api.get<Product[]>('/admin/products')])
      .then(([c, list]) => {
        setCatalog(c);
        if (isNew) {
          setMainCat(c.categories?.[0] ?? '');
          return;
        }
        const p = (list as Product[]).find((x) => x.id === id);
        if (!p) return setError('Ürün bulunamadı');
        setOrig(p);
        setName(p.name);
        const main = c.categories.find((m) => (c.subcategories[m] ?? []).includes(p.category)) || p.subcategory || c.categories[0] || '';
        setMainCat(main);
        setLeafCat(p.category);
        setUnit(p.unit || 'Kg');
        setPrice(p.supplier_price != null ? String(p.supplier_price) : '');
        setInStock(p.in_stock);
        setImageUrl(p.image_url ?? null);
        setDescription(p.description ?? '');
        setGroups(((p.customization_options as OptionGroup[] | null) ?? []).map((g) => ({
          title: g.title ?? '',
          choices: (g.choices ?? [])
            .filter((c) => !isNone(c.label ?? ''))
            .map((c) => ({ label: c.label ?? '', price_delta: Number(c.price_delta) || 0 })),
        })));
        setCampaignPct(p.campaign_discount_percent ? String(p.campaign_discount_percent) : '');
        setCampaignMin(p.campaign_min_qty ? String(p.campaign_min_qty) : '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // 5'er TL artır / azalt; 5'in katı olmayan değerden en yakın kata yuvarlar
  function stepPrice(delta: number) {
    const cur = Number(price) || 0;
    const base = delta > 0 ? Math.floor(cur / PRICE_STEP) * PRICE_STEP : Math.ceil(cur / PRICE_STEP) * PRICE_STEP;
    setPrice(String(Math.max(0, base + delta)));
  }

  // Galeri / kamera -> cihazda küçült (1200 px) -> yükle; sunucu ayrıca 600 px WebP yapar
  async function changePhoto(camera = false) {
    if (Platform.OS !== 'web') return; // uygulamaya çevrilince yerel kamera/galeri eklenecek
    const file = await pickImage(camera);
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const small = await shrinkImage(file);
      setImageUrl(await uploadImage(small, 'urun.jpg'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fotoğraf yüklenemedi');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim() || !mainCat || !leafCat) return setError('Ürün adı, ana kategori ve alt kategori zorunlu');
    const num = price.trim() === '' ? 0 : Number(price);
    if (!Number.isFinite(num) || num < 0) return setError('Fiyatı rakamla gir (ör. 45)');
    const priceChanged = num !== Number(orig?.supplier_price ?? 0);
    if (priceChanged && num % PRICE_STEP !== 0) return setError('Fiyat 5 TL\'nin katı olmalı (5, 10, 15, 20 …)');
    const cleanGroups = groups.map((g) => ({ title: g.title.trim(), choices: g.choices.map((c) => ({ ...c, label: c.label.trim() })) }));
    if (cleanGroups.some((g) => !g.title || g.choices.length === 0 || g.choices.some((c) => !c.label || isNone(c.label)))) {
      return setError('Seçeneklerde boş grup adı, boş seçenek ya da "İstemiyorum" dışında seçeneği olmayan grup var');
    }
    for (const g of cleanGroups) g.choices.push({ label: NONE_CHOICE, price_delta: 0 });
    const pct = Math.min(90, Number(campaignPct) || 0);
    const minQty = Number(campaignMin.replace(',', '.')) || 0;
    setSaving(true);
    setError('');
    // Mevcut ürünün tüm alanları + değişiklikler (resim/seçenekler vb. korunur)
    const payload = {
      ...(orig ?? {}),
      name: name.trim(),
      category: leafCat,
      subcategory: mainCat,
      unit,
      supplier_price: num,
      in_stock: inStock,
      image_url: imageUrl,
      description: description.trim() || null,
      customization_options: cleanGroups.length ? cleanGroups : null,
      campaign_discount_percent: pct,
      campaign_min_qty: minQty,
    };
    // Sunucunun tuttuğu alanlar geri gönderilmez (aktiflik yöneticide)
    for (const k of ['id', 'active', 'pending_approval', 'created_at', 'updated_at']) delete (payload as Record<string, unknown>)[k];
    try {
      const saved = isNew
        ? await api.post<Product>('/admin/products', payload)
        : await api.put<Product>(`/admin/products/${id}`, payload);
      if (saved?.pending_approval && Platform.OS === 'web') {
        window.alert(isNew ? 'Ürün yönetici onayına gönderildi. Onaylanınca satışa açılır.' : 'Değişiklik yönetici onayına gönderildi. Onaylanınca geçerli olur. (Stok durumu hemen geçerli.)');
      }
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (Platform.OS === 'web' && !window.confirm(`"${name}" silinsin mi?`)) return;
    try {
      await api.del(`/admin/products/${id}`);
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  const leafOptions = catalog?.subcategories?.[mainCat] ?? [];
  const inputStyle = [styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }];
  const chip = (on: boolean) => [styles.chip, { borderColor: theme.tint, backgroundColor: on ? theme.tint : 'transparent' }];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: isNew ? 'Yeni Ürün' : 'Ürünü Düzenle' }} />
      {loading ? (
        <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.five }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, { backgroundColor: theme.authCard }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#D97706" />
            <ThemedText type="small" style={{ flex: 1 }}>
              {orig?.pending_approval === 'new'
                ? 'Bu ürün yönetici onayı bekliyor. Onaylanınca satışa açılır.'
                : orig?.pending_approval === 'update'
                  ? 'Değişikliğin yönetici onayı bekliyor. Aşağıda gönderdiğin hali görüyorsun.'
                  : 'Ekleme ve değişiklikler yönetici onayından sonra geçerli olur. Stok durumu hemen değişir.'}
            </ThemedText>
          </View>
          {/* Ürün resmi */}
          <Pressable onPress={() => changePhoto(false)} style={[styles.photo, { backgroundColor: theme.authCard, borderColor: theme.border }]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <Ionicons name="image-outline" size={44} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">Ürün resmi yok</ThemedText>
              </View>
            )}
            {uploading && (
              <View style={styles.photoBusy}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>
          <View style={styles.photoBtns}>
            <Pressable style={[styles.outlineBtn, styles.flex, { borderColor: theme.tint }]} onPress={() => changePhoto(false)} disabled={uploading}>
              <Ionicons name="images-outline" size={18} color={theme.tint} />
              <ThemedText themeColor="tint" type="smallBold">Galeri</ThemedText>
            </Pressable>
            <Pressable style={[styles.outlineBtn, styles.flex, { borderColor: theme.tint }]} onPress={() => changePhoto(true)} disabled={uploading}>
              <Ionicons name="camera-outline" size={18} color={theme.tint} />
              <ThemedText themeColor="tint" type="smallBold">Kamera</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary">Ürün Adı</ThemedText>
          <TextInput value={name} onChangeText={setName} placeholder="Örn: Kırmızı Köy Domatesi" placeholderTextColor={theme.textSecondary} style={inputStyle} />

          <ThemedText type="small" themeColor="textSecondary">Ana Kategori</ThemedText>
          <View style={styles.chipRow}>
            {(catalog?.categories ?? []).map((c) => (
              <Pressable key={c} style={chip(mainCat === c)} onPress={() => { setMainCat(c); setLeafCat(''); }}>
                <ThemedText type="small" style={{ color: mainCat === c ? '#fff' : theme.text }}>{c}</ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">Alt Kategori</ThemedText>
          <View style={styles.chipRow}>
            {leafOptions.map((s) => (
              <Pressable key={s} style={chip(leafCat === s)} onPress={() => setLeafCat(s)}>
                <ThemedText type="small" style={{ color: leafCat === s ? '#fff' : theme.text }}>{s}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary">Birim</ThemedText>
          <View style={styles.chipRow}>
            {UNIT_OPTIONS.map((u) => (
              <Pressable key={u} style={chip(unit === u)} onPress={() => setUnit(u)}>
                <ThemedText type="small" style={{ color: unit === u ? '#fff' : theme.text }}>{u}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary">Fiyatım (₺ / {unit.toLowerCase()})</ThemedText>
          <View style={styles.stepRow}>
            <Pressable style={[styles.stepBtn, { borderColor: theme.tint }]} onPress={() => stepPrice(-PRICE_STEP)} accessibilityLabel="5 TL azalt">
              <Ionicons name="remove" size={22} color={theme.tint} />
            </Pressable>
            <TextInput
              value={price}
              onChangeText={(v) => setPrice(v.replace(/[^\d]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              style={[inputStyle, styles.stepInput]}
            />
            <Pressable style={[styles.stepBtn, { borderColor: theme.tint }]} onPress={() => stepPrice(PRICE_STEP)} accessibilityLabel="5 TL artır">
              <Ionicons name="add" size={22} color={theme.tint} />
            </Pressable>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Fiyat 5 TL'nin katı olmalı (5, 10, 15, 20 …). Fiyatını günde bir kez değiştirebilirsin.
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary">Açıklama (isteğe bağlı)</ThemedText>
          <TextInput value={description} onChangeText={setDescription} multiline placeholder="Örn: Günlük taze, köy domatesi" placeholderTextColor={theme.textSecondary} style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]} />

          {/* Kampanya: çok al az öde */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>Kampanya (çok al az öde)</ThemedText>
          <View style={styles.pair}>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary">İndirim (%)</ThemedText>
              <TextInput value={campaignPct} onChangeText={(v) => setCampaignPct(v.replace(/[^\d]/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="0" placeholderTextColor={theme.textSecondary} style={inputStyle} />
            </View>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary">En az miktar ({unit.toLowerCase()})</ThemedText>
              <TextInput value={campaignMin} onChangeText={(v) => setCampaignMin(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={theme.textSecondary} style={inputStyle} />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">İkisi de doluysa kampanya açılır. Örn: 3 kg ve üzeri %10 indirim.</ThemedText>

          {/* Seçenekler: Boyut, Şekil … */}
          <View style={styles.sectionRow}>
            <ThemedText type="smallBold" style={[styles.sectionTitle, styles.flex]}>Seçenekler (Boyut, Şekil …)</ThemedText>
            <Pressable
              style={[styles.smallBtn, { borderColor: theme.tint }]}
              onPress={() => setGroups([...groups, { title: '', choices: [{ label: '', price_delta: 0 }] }])}
            >
              <Ionicons name="add" size={16} color={theme.tint} />
              <ThemedText type="small" themeColor="tint">Grup ekle</ThemedText>
            </Pressable>
          </View>
          {groups.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">Müşteri ürünü seçerken boyut, kesim gibi bir seçim yapsın istiyorsan grup ekle. "İstemiyorum" (0 ₺) her grubun en altında sabittir ve varsayılandır.</ThemedText>
          )}
          {groups.map((g, gi) => {
            const setGroup = (ng: OptionGroup) => setGroups(groups.map((x, i) => (i === gi ? ng : x)));
            return (
              <View key={gi} style={[styles.group, { borderColor: theme.border }]}>
                <View style={styles.pair}>
                  <TextInput value={g.title} onChangeText={(v) => setGroup({ ...g, title: v })} placeholder="Grup adı (örn: Boyut)" placeholderTextColor={theme.textSecondary} style={[inputStyle, styles.flex]} />
                  <Pressable style={[styles.iconBtn, { backgroundColor: theme.danger }]} onPress={() => setGroups(groups.filter((_, i) => i !== gi))} accessibilityLabel="Grubu sil">
                    <Ionicons name="trash-outline" size={17} color="#fff" />
                  </Pressable>
                </View>
                <View style={styles.pair}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>Seçenek</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.deltaCol}>Ek fiyat ₺</ThemedText>
                  <View style={{ width: 38 }} />
                </View>
                {g.choices.map((c, ci) => (
                  <View key={ci} style={styles.pair}>
                    <TextInput
                      value={c.label}
                      onChangeText={(v) => setGroup({ ...g, choices: g.choices.map((y, j) => (j === ci ? { ...y, label: v } : y)) })}
                      placeholder="Örn: Büyük"
                      placeholderTextColor={theme.textSecondary}
                      style={[inputStyle, styles.flex]}
                    />
                    <TextInput
                      value={String(c.price_delta || '')}
                      onChangeText={(v) => setGroup({ ...g, choices: g.choices.map((y, j) => (j === ci ? { ...y, price_delta: Number(v.replace(/[^\d]/g, '')) || 0 } : y)) })}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={theme.textSecondary}
                      style={[inputStyle, styles.deltaCol, { textAlign: 'center' }]}
                    />
                    <Pressable style={[styles.iconBtn, { backgroundColor: theme.inputBg }]} onPress={() => setGroup({ ...g, choices: g.choices.filter((_, j) => j !== ci) })} accessibilityLabel="Seçeneği sil">
                      <Ionicons name="close" size={18} color={theme.danger} />
                    </Pressable>
                  </View>
                ))}
                {/* Sabit, kilitli: hep en altta, 0 TL, silinemez */}
                <View style={styles.pair}>
                  <View style={[styles.input, styles.flex, styles.locked, { borderColor: theme.border, backgroundColor: theme.authCard }]}>
                    <ThemedText type="small" themeColor="textSecondary">{NONE_CHOICE}</ThemedText>
                  </View>
                  <View style={[styles.input, styles.deltaCol, styles.locked, { borderColor: theme.border, backgroundColor: theme.authCard, alignItems: 'center' }]}>
                    <ThemedText type="small" themeColor="textSecondary">0</ThemedText>
                  </View>
                  <View style={[styles.iconBtn, { opacity: 0.6 }]}>
                    <Ionicons name="lock-closed" size={16} color={theme.textSecondary} />
                  </View>
                </View>
                <Pressable style={styles.addChoice} onPress={() => setGroup({ ...g, choices: [...g.choices, { label: '', price_delta: 0 }] })}>
                  <Ionicons name="add" size={16} color={theme.tint} />
                  <ThemedText type="small" themeColor="tint">Seçenek ekle</ThemedText>
                </Pressable>
              </View>
            );
          })}

          <Pressable style={[styles.stockRow, { backgroundColor: theme.authCard }]} onPress={() => setInStock((v) => !v)}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>Stokta</ThemedText>
            <ThemedText type="smallBold" themeColor={inStock ? 'tint' : 'danger'}>{inStock ? 'Var' : 'Tükendi'}</ThemedText>
          </Pressable>

          {!!error && <ThemedText themeColor="danger" type="small">{error}</ThemedText>}
          <Pressable style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={save} disabled={saving || uploading}>
            {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={{ color: '#fff' }} type="smallBold">Kaydet</ThemedText>}
          </Pressable>
          {!isNew && (
            <Pressable style={[styles.outlineBtn, { borderColor: theme.danger }]} onPress={remove}>
              <ThemedText themeColor="danger" type="smallBold">Ürünü Sil</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photoEmpty: { alignItems: 'center', gap: 6 },
  photoBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  outlineBtn: { flexDirection: 'row', gap: 8, borderWidth: 1.5, borderRadius: 999, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  flex: { flex: 1 },
  photoBtns: { flexDirection: 'row', gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  sectionTitle: { marginTop: Spacing.two },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  group: { borderWidth: 1, borderRadius: 12, padding: Spacing.two, gap: 8 },
  deltaCol: { width: 84 },
  locked: { justifyContent: 'center', minHeight: 40, borderStyle: 'dashed' },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addChoice: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 12, padding: Spacing.two },
  stockRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: Spacing.three, marginTop: Spacing.one },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
});
