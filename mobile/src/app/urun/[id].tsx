import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
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
  const [imageFailed, setImageFailed] = useState(false);

  const product = getById(id);

  if (!product) {
    return (
      <Screen edges={['bottom']}>
        <View style={[styles.flex, styles.center]}>
          <ThemedText>Ürün bulunamadı.</ThemedText>
        </View>
      </Screen>
    );
  }

  const showImage = product.image_url && !imageFailed;

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.image, { backgroundColor: theme.tintSoft }]}>
          {showImage ? (
            <Image
              source={{ uri: product.image_url! }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ThemedText style={{ fontSize: 64 }}>🥬</ThemedText>
          )}
        </View>

        <View style={[styles.body, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="title" style={styles.name}>
            {product.name}
          </ThemedText>
          <ThemedText themeColor="textSecondary">{product.category}</ThemedText>

          <View style={styles.priceRow}>
            <View>
              <ThemedText themeColor="textSecondary" type="small">
                Gel-Al
              </ThemedText>
              <ThemedText type="subtitle" themeColor="tint" style={styles.price}>
                {product.gel_al_price ?? '—'} ₺
              </ThemedText>
            </View>
            <View>
              <ThemedText themeColor="textSecondary" type="small">
                Eve Servis
              </ThemedText>
              <ThemedText type="subtitle" themeColor="tint" style={styles.price}>
                {product.eve_servis_price ?? '—'} ₺
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
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1 },
  image: { height: 220, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  body: { padding: Spacing.three, gap: Spacing.two, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -20 },
  name: { fontSize: 26, lineHeight: 32 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.four, marginTop: Spacing.one },
  price: { fontSize: 22, lineHeight: 26 },
  description: { marginTop: Spacing.two },
  footer: { borderTopWidth: 1, padding: Spacing.three },
  addBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
