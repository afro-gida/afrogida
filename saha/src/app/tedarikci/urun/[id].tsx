import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, uploadImage } from '@/lib/api';
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
  [k: string]: unknown;
};

type CatalogConfig = { categories: string[]; subcategories: Record<string, string[]> };

/** Web'de dosya seçici (telefonda "Fotoğraf çek / Galeri" seçeneği çıkar). */
function pickImageWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

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

  async function changePhoto() {
    if (Platform.OS !== 'web') return; // uygulamaya çevrilince kamera/galeri eklenecek
    const file = await pickImageWeb();
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      setImageUrl(await uploadImage(file, file.name));
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
      active: true,
      image_url: imageUrl,
      description: description.trim() || null,
    };
    delete (payload as Record<string, unknown>).id;
    try {
      if (isNew) await api.post('/admin/products', payload);
      else await api.put(`/admin/products/${id}`, payload);
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
          {/* Ürün resmi */}
          <Pressable onPress={changePhoto} style={[styles.photo, { backgroundColor: theme.authCard, borderColor: theme.border }]}>
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
          <Pressable style={[styles.outlineBtn, { borderColor: theme.tint }]} onPress={changePhoto} disabled={uploading}>
            <Ionicons name="camera-outline" size={18} color={theme.tint} />
            <ThemedText themeColor="tint" type="smallBold">{imageUrl ? 'Fotoğrafı Değiştir' : 'Fotoğraf Ekle'}</ThemedText>
          </Pressable>

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
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  stockRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: Spacing.three, marginTop: Spacing.one },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
});
