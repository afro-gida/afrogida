import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORIES } from '@/data/sample';
import { useProducts } from '@/lib/products-context';
import { useMarkets } from '@/lib/markets-context';
import { Spacing } from '@/constants/theme';
import type { Product } from '@/lib/types';

export default function MarketProductsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>('Tümü');
  const { products: allProducts, loading } = useProducts();
  const { markets } = useMarkets();
  const market = markets.find((m) => m.id === id);

  const products = useMemo(() => {
    if (activeCategory === 'Tümü') return allProducts;
    return allProducts.filter((p) => p.category === activeCategory);
  }, [allProducts, activeCategory]);

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="subtitle">{market?.name ?? 'Ürünler'}</ThemedText>
        {market && (
          <ThemedText themeColor="textSecondary" type="small">
            {market.day} · {market.location}
          </ThemedText>
        )}
      </View>

      <FlatList
        horizontal
        style={styles.chipList}
        showsHorizontalScrollIndicator={false}
        data={['Tümü', ...CATEGORIES]}
        keyExtractor={(c) => c}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item }) => {
          const active = item === activeCategory;
          return (
            <Pressable
              onPress={() => setActiveCategory(item)}
              style={[
                styles.chip,
                {
                  borderColor: active ? theme.tint : theme.border,
                  backgroundColor: active ? theme.tint : theme.backgroundElement,
                },
              ]}
            >
              <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                {item}
              </ThemedText>
            </Pressable>
          );
        }}
      />

      <FlatList
        style={styles.flex}
        data={loading ? [] : products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <ProductCard product={item} onPress={() => router.push(`/urun/${item.id}`)} />
        )}
        ListEmptyComponent={
          <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">{loading ? 'Yükleniyor…' : 'Bu kategoride ürün yok.'}</ThemedText>
          </View>
        }
      />
    </Screen>
  );
}

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const theme = useTheme();
  const outOfStock = !product.in_stock;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.image_url && !imageFailed;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={[styles.cardImageWrap, { backgroundColor: theme.tintSoft }]}>
        {showImage ? (
          <Image
            source={{ uri: product.image_url! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ThemedText style={styles.cardImageFallback}>🥬</ThemedText>
        )}
        {outOfStock && (
          <View style={styles.outOfStockBadge}>
            <ThemedText type="small" style={styles.badgeText}>
              Stokta yok
            </ThemedText>
          </View>
        )}
        {!!product.campaign_discount_percent && (
          <View style={[styles.discountBadge, { backgroundColor: theme.accentOrange }]}>
            <ThemedText type="small" style={styles.badgeText}>
              %{product.campaign_discount_percent} indirim
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
        {product.name}
      </ThemedText>
      <ThemedText themeColor="tint" type="smallBold">
        {product.gel_al_price ? `${product.gel_al_price.toFixed(0)} ₺` : 'Fiyat yok'}
        <ThemedText themeColor="textSecondary" type="small">
          {' '}
          / {product.unit}
        </ThemedText>
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: Spacing.three, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, gap: 2 },
  chipList: { flexGrow: 0, flexShrink: 0, height: 48 },
  chipRow: { paddingHorizontal: Spacing.three, gap: Spacing.two, alignItems: 'center', height: 48 },
  chip: {
    paddingHorizontal: Spacing.three,
    height: 36,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { padding: Spacing.two, gap: Spacing.two, paddingBottom: Spacing.six },
  row: { gap: Spacing.two },
  card: { flex: 1, borderRadius: 16, borderWidth: 1, padding: Spacing.two, gap: 4 },
  cardImageWrap: { height: 110, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardImageFallback: { fontSize: 36 },
  cardTitle: { marginTop: 4 },
  badgeText: { color: '#fff', fontWeight: '700' },
  outOfStockBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingVertical: 3, alignItems: 'center',
  },
  discountBadge: { position: 'absolute', top: 6, right: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.two },
});
