import { Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useProducts } from '@/lib/products-context';
import { useCart } from '@/lib/cart-context';
import { Spacing } from '@/constants/theme';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { addItem } = useCart();
  const { getById } = useProducts();

  const product = getById(id);

  if (!product) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: theme.background }]}>
        <ThemedText>Ürün bulunamadı.</ThemedText>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['bottom']}>
      <View style={[styles.image, { backgroundColor: theme.tintSoft }]}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={styles.image} resizeMode="cover" />
        ) : (
          <ThemedText style={{ fontSize: 64 }}>🥬</ThemedText>
        )}
      </View>

      <View style={styles.body}>
        <ThemedText type="title" style={styles.name}>
          {product.name}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{product.category}</ThemedText>

        <View style={styles.priceRow}>
          <View>
            <ThemedText themeColor="textSecondary" type="small">
              Gel-Al
            </ThemedText>
            <ThemedText type="subtitle" style={styles.price}>
              {product.gel_al_price} ₺
            </ThemedText>
          </View>
          <View>
            <ThemedText themeColor="textSecondary" type="small">
              Eve Servis
            </ThemedText>
            <ThemedText type="subtitle" style={styles.price}>
              {product.eve_servis_price} ₺
            </ThemedText>
          </View>
          <ThemedText themeColor="textSecondary">/ {product.unit}</ThemedText>
        </View>

        {product.description && <ThemedText style={styles.description}>{product.description}</ThemedText>}

        {!product.in_stock && (
          <ThemedText themeColor="danger" type="smallBold">
            Şu an stokta yok.
          </ThemedText>
        )}
      </View>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Pressable
          disabled={!product.in_stock}
          style={[styles.addBtn, { backgroundColor: product.in_stock ? theme.tint : theme.border }]}
          onPress={() => {
            addItem(product);
            router.back();
          }}
        >
          <ThemedText style={{ color: '#fff' }} type="smallBold">
            Sepete Ekle
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  image: { height: 220, alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.three, gap: Spacing.two, flex: 1 },
  name: { fontSize: 26, lineHeight: 32 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.four, marginTop: Spacing.one },
  price: { fontSize: 22, lineHeight: 26 },
  description: { marginTop: Spacing.two },
  footer: { borderTopWidth: 1, padding: Spacing.three },
  addBtn: { borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center' },
});
