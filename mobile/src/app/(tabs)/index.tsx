import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORIES, SAMPLE_PRODUCTS } from '@/data/sample';
import { Spacing } from '@/constants/theme';
import type { Product } from '@/lib/types';

export default function ProductsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>('Tümü');

  const products = useMemo(() => {
    if (activeCategory === 'Tümü') return SAMPLE_PRODUCTS;
    return SAMPLE_PRODUCTS.filter((p) => p.category === activeCategory);
  }, [activeCategory]);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Afro Gıda
        </ThemedText>
        <ThemedText themeColor="textSecondary">Tezgahtan sofraya, taze sebze &amp; meyve.</ThemedText>
      </View>

      <FlatList
        horizontal
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
                { borderColor: theme.border, backgroundColor: active ? theme.tint : 'transparent' },
              ]}
            >
              <ThemedText
                type="small"
                style={{ color: active ? '#fff' : theme.text }}
              >
                {item}
              </ThemedText>
            </Pressable>
          );
        }}
      />

      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <ProductCard product={item} onPress={() => router.push(`/urun/${item.id}`)} />
        )}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            Bu kategoride ürün yok.
          </ThemedText>
        }
      />
    </SafeAreaView>
  );
}

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const theme = useTheme();
  const outOfStock = !product.in_stock;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={[styles.cardImage, { backgroundColor: theme.tintSoft }]}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <ThemedText style={styles.cardImageFallback}>🥬</ThemedText>
        )}
        {outOfStock && (
          <View style={styles.outOfStockBadge}>
            <ThemedText type="small" style={{ color: '#fff' }}>
              Stokta yok
            </ThemedText>
          </View>
        )}
        {!!product.campaign_discount_percent && (
          <View style={[styles.discountBadge, { backgroundColor: theme.danger }]}>
            <ThemedText type="small" style={{ color: '#fff' }}>
              %{product.campaign_discount_percent} indirim
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
        {product.name}
      </ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        {product.gel_al_price ? `${product.gel_al_price.toFixed(0)} ₺ / ${product.unit}` : 'Fiyat yok'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: 2 },
  title: { fontSize: 28, lineHeight: 34 },
  chipRow: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999, borderWidth: 1 },
  grid: { padding: Spacing.two, gap: Spacing.two },
  row: { gap: Spacing.two },
  card: { flex: 1, borderRadius: 14, borderWidth: 1, padding: Spacing.two, gap: 4, marginBottom: Spacing.two },
  cardImage: { height: 100, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardImageFallback: { fontSize: 36 },
  cardTitle: { marginTop: 4 },
  outOfStockBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingVertical: 2, alignItems: 'center',
  },
  discountBadge: { position: 'absolute', top: 6, right: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
