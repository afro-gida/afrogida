import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { createOrder } from '@/lib/orders';
import { Spacing } from '@/constants/theme';
import type { CartLine } from '@/lib/types';

export default function CartScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { lines, setQty, removeItem, clear, totalPrice } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    if (!user) {
      router.push('/giris');
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await createOrder(lines.map((l) => ({ id: l.product.id, qty: l.qty })));
    setSubmitting(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    clear();
    router.push(`/pazar/${id}/siparislerim`);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Sepetim</ThemedText>
      </View>

      {lines.length === 0 ? (
        <View style={[styles.emptyWrap, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={{ fontSize: 40 }}>🛒</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Sepetin boş. Ürünlere göz atarak alışverişe başlayabilirsin.
          </ThemedText>
        </View>
      ) : (
        <>
          <FlatList
            style={styles.flex}
            data={lines}
            keyExtractor={(l) => l.product.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }: { item: CartLine }) => (
              <View style={[styles.line, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
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
          <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            {!user && (
              <ThemedText themeColor="textSecondary" type="small">
                Sipariş verebilmek için giriş yapmalısın.
              </ThemedText>
            )}
            {error && (
              <ThemedText themeColor="danger" type="small">
                {error}
              </ThemedText>
            )}
            <View style={styles.totalRow}>
              <ThemedText type="smallBold">Toplam</ThemedText>
              <ThemedText type="smallBold">{totalPrice.toFixed(2)} ₺</ThemedText>
            </View>
            <Pressable
              style={[styles.checkoutBtn, { backgroundColor: theme.tint }]}
              onPress={handleCheckout}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText style={{ color: '#fff' }} type="smallBold">
                  {user ? 'Siparişi Ver (Gel-Al · Tezgahta Ödeme)' : 'Giriş Yap ve Devam Et'}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  emptyWrap: {
    marginHorizontal: Spacing.three, marginTop: Spacing.five, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five,
  },
  emptyText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.two },
  lineInfo: { flex: 1, gap: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  footer: { borderRadius: 16, margin: Spacing.three, marginTop: 0, padding: Spacing.three, gap: Spacing.two },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  checkoutBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
