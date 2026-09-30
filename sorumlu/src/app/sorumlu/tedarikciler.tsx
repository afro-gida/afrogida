import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { OptionsEditor, type OptionGroup } from '@/components/options-editor';

interface SupplierEntry {
  supplier_group: string;
  markets: string[];
}

interface Product {
  id: string;
  name: string;
  supplier_price?: number | null;
  sale_price?: number | null;
  price?: number | null;
  profit_margin_amount?: number | null;
  in_stock?: boolean;
  active?: boolean;
  hidden?: boolean;
  customization_options?: OptionGroup[] | null;
}

type Row = SupplierEntry & { products: Product[] };

const sell = (p: Product) => p.sale_price ?? p.price ?? 0;
const profit = (p: Product) => p.profit_margin_amount || sell(p) - (p.supplier_price ?? 0);
// Dar ekranda sütunlar sığsın: kuruşsuz tutarlarda ",00" yazılmaz
const tl = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const norm = (s: string) => s.toLocaleLowerCase('tr-TR');

/**
 * Tedarikçiler (salt okunur denetim): pazarındaki tedarikçiler, ürünleri ve
 * fiyatları. Ürün değişiklikleri "Ürün Talepleri"nden onaylanır.
 */
export default function SorumluTedarikciler() {
  const theme = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [requests, setRequests] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null>(null);

  // Seçenekler kaydedilince listedeki ürünü yerinde güncelle
  function optionsSaved(options: OptionGroup[] | null) {
    const id = editing?.id;
    setRows((prev) => prev?.map((r) => ({ ...r, products: r.products.map((p) => (p.id === id ? { ...p, customization_options: options } : p)) })) ?? null);
    setEditing(null);
  }

  useEffect(() => {
    (async () => {
      try {
        const suppliers = await api.get<SupplierEntry[]>('/pazar-sorumlusu/suppliers');
        const withProducts = await Promise.all(
          suppliers.map(async (s) => ({
            ...s,
            products: await api
              .get<Product[]>(`/pazar-sorumlusu/suppliers/${encodeURIComponent(s.supplier_group)}/products`)
              .catch(() => [] as Product[]),
          })),
        );
        setRows(withProducts.sort((a, b) => a.supplier_group.localeCompare(b.supplier_group, 'tr')));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Yüklenemedi');
      }
      // Onay bekleyen talep sayıları (tedarikçi başına)
      api
        .get<{ supplier_group?: string }[]>('/pazar-sorumlusu/product-requests')
        .then((r) => {
          const c: Record<string, number> = {};
          for (const x of r) if (x.supplier_group) c[x.supplier_group] = (c[x.supplier_group] ?? 0) + 1;
          setRequests(c);
        })
        .catch(() => {});
    })();
  }, []);

  const q = norm(query.trim());
  const visible = useMemo(() => {
    if (!rows) return [];
    if (!q) return rows;
    return rows
      .map((r) => (norm(r.supplier_group).includes(q) ? r : { ...r, products: r.products.filter((p) => norm(p.name).includes(q)) }))
      .filter((r) => norm(r.supplier_group).includes(q) || r.products.length > 0);
  }, [rows, q]);

  const all = rows?.flatMap((r) => r.products) ?? [];
  const outCount = all.filter((p) => !p.in_stock).length;

  const toggle = (g: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {!rows && !error && <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.three }} />}

        {rows && (
          <>
            {/* Özet */}
            <View style={styles.stats}>
              {[
                { label: 'Tedarikçi', value: rows.length },
                { label: 'Ürün', value: all.length },
                { label: 'Tükendi', value: outCount, danger: outCount > 0 },
              ].map((s) => (
                <View key={s.label} style={[styles.stat, { backgroundColor: theme.authCard }]}>
                  <ThemedText type="subtitle" style={[styles.statValue, s.danger ? { color: theme.danger } : null]}>{s.value}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{s.label}</ThemedText>
                </View>
              ))}
            </View>

            {/* Arama */}
            <View style={[styles.search, { backgroundColor: theme.authCard, borderColor: theme.border }]}>
              <Ionicons name="search" size={17} color={theme.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Ürün veya tedarikçi ara"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, { color: theme.text }]}
              />
              {!!query && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
          </>
        )}

        {visible.map((s) => {
          const isOpen = !!q || open.has(s.supplier_group);
          const pending = requests[s.supplier_group] ?? 0;
          const out = s.products.filter((p) => !p.in_stock).length;
          return (
            <View key={s.supplier_group} style={[styles.card, { backgroundColor: theme.authCard }]}>
              <Pressable style={styles.head} onPress={() => toggle(s.supplier_group)}>
                <View style={[styles.avatar, { backgroundColor: theme.tintSoft }]}>
                  <Ionicons name="storefront-outline" size={18} color={theme.tint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText type="smallBold">{s.supplier_group}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {s.products.length} ürün{out ? ` · ${out} tükendi` : ''} · {s.markets.join(', ')}
                  </ThemedText>
                </View>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
              </Pressable>

              {pending > 0 && (
                <Pressable style={[styles.pendingBar, { backgroundColor: '#FEF3C7' }]} onPress={() => router.push('/sorumlu/urun-talepleri')}>
                  <Ionicons name="time-outline" size={15} color="#B45309" />
                  <ThemedText type="small" style={{ color: '#B45309', flex: 1, fontWeight: '700' }}>{pending} ürün talebi onay bekliyor</ThemedText>
                  <Ionicons name="chevron-forward" size={15} color="#B45309" />
                </Pressable>
              )}

              {isOpen && (
                <View style={[styles.table, { borderTopColor: theme.border }]}>
                  {s.products.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">Ürün yok.</ThemedText>
                  ) : (
                    <>
                      <View style={[styles.tr, { paddingHorizontal: 4 }]}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.nameCol}>Ürün</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.numCol}>Alış</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.numCol}>Satış</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.numCol}>Kâr</ThemedText>
                      </View>
                      {s.products.map((p, i) => {
                        const off = p.active === false || p.hidden;
                        return (
                          <View key={p.id} style={[styles.tr, styles.row, i % 2 === 1 && { backgroundColor: theme.backgroundSelected }]}>
                            <View style={styles.nameCol}>
                              <ThemedText type="small" style={off ? { opacity: 0.55 } : undefined}>{p.name}</ThemedText>
                              {(!p.in_stock || off) && (
                                <ThemedText style={[styles.tag, { color: off ? theme.textSecondary : theme.danger }]}>
                                  {off ? 'Satışta değil' : 'Tükendi'}
                                </ThemedText>
                              )}
                              <Pressable style={[styles.optBtn, { borderColor: theme.tint }]} onPress={() => setEditing(p)} hitSlop={6}>
                                <Ionicons name="options-outline" size={12} color={theme.tint} />
                                <ThemedText style={[styles.optText, { color: theme.tint }]}>
                                  {p.customization_options?.length ? `Seçenekler (${p.customization_options.length})` : 'Seçenek ekle'}
                                </ThemedText>
                              </Pressable>
                            </View>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.numCol}>{tl(p.supplier_price)}</ThemedText>
                            <ThemedText type="smallBold" style={styles.numCol}>{tl(sell(p))}</ThemedText>
                            <ThemedText type="small" themeColor="tint" style={styles.numCol}>{tl(profit(p))}</ThemedText>
                          </View>
                        );
                      })}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {rows && rows.length === 0 && <ThemedText themeColor="textSecondary">Pazarında bağlı tedarikçi yok.</ThemedText>}
        {rows && rows.length > 0 && visible.length === 0 && <ThemedText themeColor="textSecondary">"{query}" bulunamadı.</ThemedText>}
      </ScrollView>
      <OptionsEditor product={editing} onClose={() => setEditing(null)} onSaved={optionsSaved} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  statValue: { fontSize: 22, lineHeight: 26 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15 },
  card: { borderRadius: 16, padding: Spacing.three, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pendingBar: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  table: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 2 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  nameCol: { flex: 1, minWidth: 0 },
  numCol: { width: 54, textAlign: 'right' },
  tag: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7, marginTop: 3 },
  optText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
});
