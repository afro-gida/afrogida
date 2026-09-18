import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Market {
  id: string;
  name: string;
}

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
}

function money(n?: number | null) {
  if (n == null) return '—';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function profit(p: Product) {
  const sell = p.sale_price ?? p.price ?? 0;
  const buy = p.supplier_price ?? 0;
  if (p.profit_margin_amount) return p.profit_margin_amount;
  return sell - buy;
}

export default function SorumluTedarikcilerGozlem() {
  const theme = useTheme();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<Market[]>('/pazar-sorumlusu/markets'),
      api.get<SupplierEntry[]>('/pazar-sorumlusu/suppliers'),
    ])
      .then(([m, s]) => {
        setMarkets(m);
        setSuppliers(s);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  function marketName(id: string) {
    return markets.find((m) => m.id === id)?.name ?? id;
  }

  async function toggleProducts(group: string) {
    if (expandedGroup === group) {
      setExpandedGroup(null);
      setProducts(null);
      return;
    }
    setExpandedGroup(group);
    setProducts(null);
    try {
      const p = await api.get<Product[]>(`/pazar-sorumlusu/suppliers/${encodeURIComponent(group)}/products`);
      setProducts(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi');
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {suppliers.map((s) => (
          <View key={s.supplier_group} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{s.supplier_group}</ThemedText>
                <View style={styles.chipRow}>
                  {s.markets.map((mid) => (
                    <View key={mid} style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText type="small" themeColor="textSecondary">{marketName(mid)}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
              <Pressable onPress={() => toggleProducts(s.supplier_group)}>
                <ThemedText themeColor="tint" type="small">{expandedGroup === s.supplier_group ? 'Gizle' : 'Ürünleri Gör'}</ThemedText>
              </Pressable>
            </View>
            {expandedGroup === s.supplier_group && (
              <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 }}>
                {products === null && <ThemedText type="small" themeColor="textSecondary">Yükleniyor…</ThemedText>}
                {products && products.length === 0 && <ThemedText type="small" themeColor="textSecondary">Ürün yok.</ThemedText>}
                {products?.map((p) => (
                  <View key={p.id} style={styles.rowBetween}>
                    <ThemedText type="small">{p.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Alış: {money(p.supplier_price)} · Satış: {money(p.sale_price ?? p.price)} ·{' '}
                      <ThemedText type="small" themeColor="tint">Kâr: {money(profit(p))}</ThemedText>
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
        {!loading && suppliers.length === 0 && (
          <ThemedText themeColor="textSecondary">Pazarında bağlı tedarikçi yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
});
