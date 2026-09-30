import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { formatMoney as money } from '@/lib/format';
import { Spacing } from '@/constants/theme';
import { OptionsEditor, type OptionGroup } from '@/components/options-editor';

type RequestProduct = {
  id: string;
  name: string;
  category?: string;
  subcategory?: string | null;
  supplier_group?: string | null;
  unit?: string;
  supplier_price?: number | null;
  price?: number | null;
  image_url?: string | null;
  description?: string | null;
  [k: string]: unknown;
  pending_approval: {
    type: 'new' | 'update';
    changes: Record<string, unknown>;
    requested_at?: string;
    requested_by_name?: string;
  };
};

/** Talepte gösterilen alanlar (türeyen fiyat alanları "Satış fiyatı" satırında). */
const FIELD_LABELS: Record<string, string> = {
  name: 'Ad',
  subcategory: 'Ana kategori',
  category: 'Alt kategori',
  unit: 'Birim',
  supplier_price: 'Alış fiyatı',
  price: 'Satış fiyatı',
  description: 'Açıklama',
  customization_options: 'Seçenekler',
};
const MONEY_FIELDS = new Set(['supplier_price', 'price']);

function show(field: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (MONEY_FIELDS.has(field)) return money(Number(v));
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (Array.isArray(v)) return v.map((g: any) => g?.title ?? '').filter(Boolean).join(', ') || `${v.length} grup`;
  return String(v);
}

function when(iso?: string) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Ürün Talepleri: pazarındaki tedarikçilerin eklediği yeni ürünler ve mevcut
 * ürünlerde yaptığı değişiklikler burada bekler; onaylanınca satışa / canlıya
 * geçer. Önce tedarikçiler (talep sayısıyla), tedarikçiye basınca talepler.
 */
export default function UrunTalepleri() {
  const theme = useTheme();
  const [rows, setRows] = useState<RequestProduct[] | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; customization_options: OptionGroup[] | null } | null>(null);

  const load = useCallback(() => {
    setError('');
    api
      .get<RequestProduct[]>('/pazar-sorumlusu/product-requests')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'));
  }, []);
  useEffect(load, [load]);

  const bySupplier = useMemo(() => {
    const map = new Map<string, RequestProduct[]>();
    for (const p of rows ?? []) {
      const k = p.supplier_group || 'Tedarikçisiz';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [rows]);

  const list = supplier ? bySupplier.find(([k]) => k === supplier)?.[1] ?? [] : [];

  async function decide(p: RequestProduct, approve: boolean) {
    const isNew = p.pending_approval.type === 'new';
    if (!approve && Platform.OS === 'web') {
      const msg = isNew ? `"${p.name}" reddedilsin mi? Yeni ürün silinir.` : `"${p.name}" değişikliği reddedilsin mi? Ürün eski haliyle kalır.`;
      if (!window.confirm(msg)) return;
    }
    setBusy(p.id);
    setError('');
    try {
      await api.post(`/pazar-sorumlusu/product-requests/${p.id}/${approve ? 'approve' : 'reject'}`);
      setRows((r) => r?.filter((x) => x.id !== p.id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'İşlem yapılamadı');
    } finally {
      setBusy(null);
    }
  }

  const imgStyle = [styles.img, { borderColor: theme.border }];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: supplier ?? 'Ürün Talepleri' }} />
      <ScrollView contentContainerStyle={styles.body}>
        {supplier && (
          <Pressable style={styles.backRow} onPress={() => setSupplier(null)}>
            <Ionicons name="chevron-back" size={18} color={theme.tint} />
            <ThemedText type="smallBold" themeColor="tint">Tedarikçiler</ThemedText>
          </Pressable>
        )}
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {!rows && !error && <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.three }} />}

        {rows && !supplier && (bySupplier.length ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Tedarikçilerin eklediği ve değiştirdiği ürünler onayını bekler. Onaylayınca satışa geçer.
            </ThemedText>
            {bySupplier.map(([name, items]) => (
              <Pressable key={name} style={[styles.card, styles.rowCenter, { backgroundColor: theme.authCard }]} onPress={() => setSupplier(name)}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>{name}</ThemedText>
                <View style={[styles.countPill, { backgroundColor: theme.tint }]}>
                  <ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>{items.length} talep</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Pressable>
            ))}
          </>
        ) : (
          <ThemedText themeColor="textSecondary">Bekleyen talep yok.</ThemedText>
        ))}

        {rows && supplier && list.length === 0 && (
          <ThemedText themeColor="textSecondary">Bu tedarikçinin bekleyen talebi kalmadı.</ThemedText>
        )}
        {rows && supplier && list.map((p) => {
          const pa = p.pending_approval;
          const isNew = pa.type === 'new';
          const changes = pa.changes ?? {};
          const newImage = 'image_url' in changes ? (changes.image_url as string | null) : undefined;
          const fields = Object.keys(FIELD_LABELS).filter((f) => f in changes);
          // Geçerli seçenekler: talepte değiştiyse talepteki, yoksa üründeki
          const options = ('customization_options' in changes ? changes.customization_options : p.customization_options) as OptionGroup[] | null | undefined;
          return (
            <View key={p.id} style={[styles.card, { backgroundColor: theme.authCard }]}>
              <View style={styles.rowCenter}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>{p.name}</ThemedText>
                <View style={[styles.countPill, { backgroundColor: isNew ? theme.tintSoft : '#FEF3C7' }]}>
                  <ThemedText type="small" style={{ color: isNew ? theme.tint : '#B45309', fontWeight: '700' }}>
                    {isNew ? 'Yeni ürün' : 'Güncelleme'}
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">{when(pa.requested_at)}</ThemedText>

              {isNew ? (
                <View style={styles.rowCenter}>
                  {p.image_url ? <Image source={{ uri: p.image_url }} style={imgStyle} /> : null}
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="small">{p.subcategory ?? '—'} › {p.category} · {p.unit}</ThemedText>
                    <ThemedText type="small">Alış {money(p.supplier_price)} → Satış {money(p.price)}</ThemedText>
                    {!!p.description && <ThemedText type="small" themeColor="textSecondary">{p.description}</ThemedText>}
                    {!p.image_url && <ThemedText type="small" themeColor="textSecondary">Resim yok</ThemedText>}
                  </View>
                </View>
              ) : (
                <>
                  {newImage !== undefined && (
                    <View style={styles.rowCenter}>
                      <View style={{ gap: 4 }}>
                        <ThemedText type="small" themeColor="textSecondary">Eski resim</ThemedText>
                        {p.image_url ? <Image source={{ uri: p.image_url }} style={imgStyle} /> : <ThemedText type="small">—</ThemedText>}
                      </View>
                      <View style={{ gap: 4 }}>
                        <ThemedText type="small" themeColor="textSecondary">Yeni resim</ThemedText>
                        {newImage ? <Image source={{ uri: newImage }} style={[styles.img, { borderColor: theme.tint }]} /> : <ThemedText type="small">Kaldırıldı</ThemedText>}
                      </View>
                    </View>
                  )}
                  {fields.map((f) => (
                    <View key={f} style={styles.change}>
                      <ThemedText type="small" themeColor="textSecondary" style={{ width: 92 }}>{FIELD_LABELS[f]}</ThemedText>
                      <ThemedText type="small" style={{ flex: 1 }}>
                        <ThemedText type="small" themeColor="textSecondary">{show(f, p[f])}</ThemedText>
                        {'  →  '}
                        <ThemedText type="smallBold">{show(f, changes[f])}</ThemedText>
                      </ThemedText>
                    </View>
                  ))}
                </>
              )}

              <Pressable
                style={[styles.optBtn, { borderColor: theme.tint }]}
                onPress={() => setEditing({ id: p.id, name: p.name, customization_options: options ?? null })}
              >
                <Ionicons name="options-outline" size={16} color={theme.tint} />
                <ThemedText type="smallBold" themeColor="tint" style={{ flex: 1 }}>
                  {options?.length ? `Seçenekler (${options.map((g) => g.title).join(', ')})` : 'Seçenek ekle'}
                </ThemedText>
                <Ionicons name="create-outline" size={16} color={theme.tint} />
              </Pressable>

              <View style={styles.actions}>
                <Pressable style={[styles.btn, { backgroundColor: theme.tint }]} disabled={!!busy} onPress={() => decide(p, true)}>
                  {busy === p.id ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <ThemedText type="smallBold" style={{ color: '#fff' }}>Onayla</ThemedText>
                    </>
                  )}
                </Pressable>
                <Pressable style={[styles.btn, styles.outline, { borderColor: theme.danger }]} disabled={!!busy} onPress={() => decide(p, false)}>
                  <Ionicons name="close" size={18} color={theme.danger} />
                  <ThemedText type="smallBold" themeColor="danger">Reddet</ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
      {/* Seçenekler hemen kaydedilir; talepteki seçenek değişikliği düşer (liste tazelenir) */}
      <OptionsEditor product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  countPill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  img: { width: 80, height: 80, borderRadius: 10, borderWidth: 1 },
  change: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { flex: 1, flexDirection: 'row', gap: 6, borderRadius: 999, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1.5 },
  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
});
