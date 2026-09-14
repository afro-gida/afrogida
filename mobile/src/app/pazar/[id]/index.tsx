import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORIES } from '@/data/sample';
import { useProducts } from '@/lib/products-context';
import { useMarkets } from '@/lib/markets-context';
import { useCart } from '@/lib/cart-context';
import { fetchSettings, type StoreSettings } from '@/lib/settings';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Product } from '@/lib/types';

export default function MarketProductsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>('Tümü');
  const { products: allProducts, loading } = useProducts();
  const { markets } = useMarkets();
  const market = markets.find((m) => m.id === id);
  const [settings, setSettings] = useState<StoreSettings>({});

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  const infoItems = useMemo(() => {
    const items: string[] = ['🕐 Gel-Al: 11:00-19:00'];
    if (settings.free_delivery_min_amount) {
      items.push(`🎁 ${settings.free_delivery_min_amount.toFixed(0)}₺ üzeri ücretsiz teslimat`);
    }
    if (settings.delivery_fee) {
      items.push(`🚚 Teslimat ücreti: ${settings.delivery_fee.toFixed(0)}₺`);
    }
    return items;
  }, [settings]);

  const products = useMemo(() => {
    if (activeCategory === 'Tümü') return allProducts;
    return allProducts.filter((p) => p.category === activeCategory);
  }, [allProducts, activeCategory]);

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.header, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.replace('/')} hitSlop={12} style={styles.backBtn}>
            <ThemedText style={styles.backArrow}>←</ThemedText>
          </Pressable>
          <View style={styles.flex}>
            <ThemedText type="subtitle">{market?.name ?? 'Ürünler'}</ThemedText>
            {market && (
              <ThemedText themeColor="textSecondary" type="small">
                {market.day} · {market.location}
              </ThemedText>
            )}
          </View>
        </View>
      </View>

      <FlatList
        horizontal
        style={styles.infoList}
        showsHorizontalScrollIndicator={false}
        data={infoItems}
        keyExtractor={(t) => t}
        contentContainerStyle={styles.infoRow}
        renderItem={({ item }) => (
          <View style={[styles.infoPill, { backgroundColor: withAlpha(theme.backgroundElement, 0.6), borderColor: theme.tint }]}>
            <ThemedText type="small" numberOfLines={1}>
              {item}
            </ThemedText>
          </View>
        )}
      />

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
  const { addItem } = useCart();
  const outOfStock = !product.in_stock;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.image_url && !imageFailed;
  // Buzlu cam kart: yarı saydam zemin + (web'de) arkadan duvar kağıdının
  // bulanık görünmesi için backdrop-filter — bkz. DESIGN-BRIEF.md 4. madde.
  const glassStyle: any =
    Platform.OS === 'web' ? { backdropFilter: 'blur(14px) saturate(1.3)' } : null;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        glassStyle,
        { backgroundColor: withAlpha(theme.backgroundElement, 0.72), borderColor: theme.tint },
      ]}
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
      </View>
      {!!product.campaign_discount_percent && (
        <View style={[styles.discountBadge, { backgroundColor: theme.accentOrange }]}>
          <ThemedText type="small" style={styles.discountBadgeText}>
            %{product.campaign_discount_percent}
          </ThemedText>
        </View>
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>
        {product.name}
      </ThemedText>
      <View style={styles.cardBottomRow}>
        <ThemedText themeColor="tint" type="smallBold">
          {product.gel_al_price ? `${product.gel_al_price.toFixed(0)} ₺` : 'Fiyat yok'}
          <ThemedText themeColor="textSecondary" type="small">
            {' '}
            / {product.unit}
          </ThemedText>
        </ThemedText>
        {!outOfStock && (
          <Pressable
            onPress={() => addItem(product)}
            hitSlop={8}
            style={[styles.addBtn, { backgroundColor: theme.tint }]}
          >
            <ThemedText style={styles.addBtnText}>+ Ekle</ThemedText>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: Spacing.three, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  infoList: { flexGrow: 0, flexShrink: 0, height: 44, marginTop: Spacing.two },
  infoRow: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  infoPill: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    height: 32,
    justifyContent: 'center',
    borderWidth: 1,
  },
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
  grid: { padding: Spacing.two, gap: Spacing.two, paddingBottom: Spacing.six + Spacing.four },
  row: { gap: Spacing.two },
  card: { flex: 1, borderRadius: 16, borderWidth: 1.5, padding: Spacing.two, gap: 4 },
  cardImageWrap: { height: 110, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardImageFallback: { fontSize: 36 },
  cardTitle: { marginTop: 4 },
  cardBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  badgeText: { color: '#fff', fontWeight: '700' },
  outOfStockBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingVertical: 3, alignItems: 'center',
  },
  // Görsel köşesine binen yuvarlak indirim rozeti (kartın kendisine, resim
  // katmanının üstüne bindirilmiş — bkz. hedef site tasarımı).
  discountBadge: {
    position: 'absolute', top: Spacing.one, right: Spacing.one,
    minWidth: 30, height: 22, borderRadius: 11, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  discountBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  addBtn: { borderRadius: 999, paddingHorizontal: Spacing.two, height: 26, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.two },
});
