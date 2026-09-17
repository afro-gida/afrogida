import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

const UNIT_OPTIONS = ['Kg', 'Adet', 'File', 'Demet'];

interface Product {
  id: string;
  name: string;
  category: string; // alt kategori (ör. "Domates")
  subcategory?: string; // ana kategori (ör. "Sebze")
  unit: string;
  price?: number | null;
  in_stock: boolean;
  active: boolean;
}

interface CatalogConfig {
  categories: string[];
  subcategories: Record<string, string[]>;
}

interface Form {
  name: string;
  mainCategory: string;
  leafCategory: string;
  unit: string;
  price: string;
  in_stock: boolean;
}

function emptyForm(mainCategory: string): Form {
  return { name: '', mainCategory, leafCategory: '', unit: 'Kg', price: '', in_stock: true };
}

export default function UrunlerimScreen() {
  const theme = useTheme();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm(''));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([api.get<Product[]>('/admin/products'), api.get<CatalogConfig>('/catalog-config')])
      .then(([p, c]) => {
        setProducts(p);
        setCatalog(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function findMainCategory(leaf: string): string {
    if (!catalog) return '';
    for (const main of catalog.categories) {
      if ((catalog.subcategories[main] ?? []).includes(leaf)) return main;
    }
    return catalog.categories[0] ?? '';
  }

  function openNew() {
    setEditingId(null);
    setForm(emptyForm(catalog?.categories?.[0] ?? ''));
    setFormError('');
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditingId(p.id);
    const mainCategory = findMainCategory(p.category) || p.subcategory || catalog?.categories?.[0] || '';
    setForm({
      name: p.name,
      mainCategory,
      leafCategory: p.category,
      unit: p.unit,
      price: p.price != null ? String(p.price) : '',
      in_stock: p.in_stock,
    });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim() || !form.mainCategory || !form.leafCategory) {
      setFormError('Ürün adı, ana kategori ve alt kategori zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      category: form.leafCategory,
      subcategory: form.mainCategory,
      unit: form.unit,
      price: form.price === '' ? 0 : Number(form.price),
      sale_price: form.price === '' ? 0 : Number(form.price),
      in_stock: form.in_stock,
      active: true,
    };
    try {
      if (editingId) {
        await api.put(`/admin/products/${editingId}`, payload);
      } else {
        await api.post('/admin/products', payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/admin/products/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  const leafOptions = catalog?.subcategories?.[form.mainCategory] ?? [];

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable style={[styles.addBtn, { backgroundColor: theme.tint }]} onPress={openNew}>
          <ThemedText style={{ color: '#fff' }} type="smallBold">+ Ürün Ekle</ThemedText>
        </Pressable>

        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {showForm && (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{editingId ? 'Ürünü Düzenle' : 'Yeni Ürün'}</ThemedText>
              <Pressable onPress={() => setShowForm(false)}><ThemedText>✕</ThemedText></Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">Ürün Adı</ThemedText>
            <TextInput
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
            />
            <ThemedText type="small" themeColor="textSecondary">Ana Kategori</ThemedText>
            <View style={styles.chipRow}>
              {(catalog?.categories ?? []).map((c) => (
                <Pressable
                  key={c}
                  style={[styles.chip, { borderColor: theme.tint, backgroundColor: form.mainCategory === c ? theme.tint : 'transparent' }]}
                  onPress={() => setForm((f) => ({ ...f, mainCategory: c, leafCategory: '' }))}
                >
                  <ThemedText type="small" style={{ color: form.mainCategory === c ? '#fff' : theme.text }}>{c}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">Alt Kategori</ThemedText>
            <View style={styles.chipRow}>
              {leafOptions.map((s) => (
                <Pressable
                  key={s}
                  style={[styles.chip, { borderColor: theme.tint, backgroundColor: form.leafCategory === s ? theme.tint : 'transparent' }]}
                  onPress={() => setForm((f) => ({ ...f, leafCategory: s }))}
                >
                  <ThemedText type="small" style={{ color: form.leafCategory === s ? '#fff' : theme.text }}>{s}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">Birim</ThemedText>
            <View style={styles.chipRow}>
              {UNIT_OPTIONS.map((u) => (
                <Pressable
                  key={u}
                  style={[styles.chip, { borderColor: theme.tint, backgroundColor: form.unit === u ? theme.tint : 'transparent' }]}
                  onPress={() => setForm((f) => ({ ...f, unit: u }))}
                >
                  <ThemedText type="small" style={{ color: form.unit === u ? '#fff' : theme.text }}>{u}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">Fiyat (₺)</ThemedText>
            <TextInput
              value={form.price}
              onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
              keyboardType="numeric"
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
            />
            <Pressable style={styles.rowBetween} onPress={() => setForm((f) => ({ ...f, in_stock: !f.in_stock }))}>
              <ThemedText type="small">Stokta</ThemedText>
              <ThemedText type="small" themeColor={form.in_stock ? 'tint' : 'danger'}>{form.in_stock ? 'Evet' : 'Hayır'}</ThemedText>
            </Pressable>
            {formError && <ThemedText themeColor="danger" type="small">{formError}</ThemedText>}
            <Pressable style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={save} disabled={saving}>
              <ThemedText style={{ color: '#fff' }} type="smallBold">{saving ? 'Kaydediliyor…' : 'Kaydet'}</ThemedText>
            </Pressable>
          </View>
        )}

        {products.map((p) => (
          <View key={p.id} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{p.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {p.subcategory ?? '—'} › {p.category} · {p.unit} · ₺{p.price ?? 0}
                </ThemedText>
                {!p.in_stock && <ThemedText type="small" themeColor="danger">Stok Yok</ThemedText>}
              </View>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => openEdit(p)}><ThemedText themeColor="tint" type="small">Düzenle</ThemedText></Pressable>
                <Pressable onPress={() => remove(p.id)}><ThemedText themeColor="danger" type="small">Sil</ThemedText></Pressable>
              </View>
            </View>
          </View>
        ))}
        {!loading && products.length === 0 && (
          <ThemedText themeColor="textSecondary">Henüz ürün eklemedin.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  addBtn: { borderRadius: 999, paddingVertical: Spacing.two, alignItems: 'center' },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
});
