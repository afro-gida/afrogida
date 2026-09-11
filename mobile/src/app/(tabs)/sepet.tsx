import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart-context';
import { Spacing } from '@/constants/theme';
import type { CartLine } from '@/lib/types';

export default function CartScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { lines, setQty, removeItem, totalPrice } = useCart();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Sepetim</ThemedText>
      </View>

      {lines.length === 0 ? (
        <View style={styles.emptyWrap}>
          <ThemedText style={{ fontSize: 40 }}>🛒</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Sepetin boş. Ürünlere göz atarak alışverişe başlayabilirsin.
          </ThemedText>
        </View>
      ) : (
        <>
          <FlatList
            data={lines}
            keyExtractor={(l) => l.product.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }: { item: CartLine }) => (
              <View style={[styles.line, { borderColor: theme.border }]}>
                <View style={styles.lineInfo}>
                  <ThemedText type="smallBold">{item.product.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {item.product.gel_al_price} ₺ / {item.product.unit}
                  </ThemedText>
                </View>
                <View style={styles.qtyRow}>
                  <Pressable
                    style={[styles.qtyBtn, { borderColor: theme.border }]}
                    onPress={() => setQty(item.product.id, item.qty - 1)}
                  >
                    <ThemedText>−</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.qtyValue}>{item.qty}</ThemedText>
                  <Pressable
                    style={[styles.qtyBtn, { borderColor: theme.border }]}
                    onPress={() => setQty(item.product.id, item.qty + 1)}
                  >
                    <ThemedText>+</ThemedText>
                  </Pressable>
                </View>
                <Pressable onPress={() => removeItem(item.product.id)}>
                  <ThemedText themeColor="danger" type="small">
                    Kaldır
                  </ThemedText>
                </Pressable>
              </View>
            )}
          />
          <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <View style={styles.totalRow}>
              <ThemedText type="smallBold">Toplam</ThemedText>
              <ThemedText type="smallBold">{totalPrice.toFixed(2)} ₺</ThemedText>
            </View>
            <Pressable
              style={[styles.checkoutBtn, { backgroundColor: theme.tint }]}
              onPress={() => router.push('/giris')}
            >
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Ödemeye Geç
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.five },
  emptyText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: 1, paddingBottom: Spacing.two },
  lineInfo: { flex: 1, gap: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  footer: { borderTopWidth: 1, padding: Spacing.three, gap: Spacing.two },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  checkoutBtn: { borderRadius: 12, paddingVertical: Spacing.two, alignItems: 'center' },
});
