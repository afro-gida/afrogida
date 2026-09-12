import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchOrders } from '@/lib/orders';
import { Spacing } from '@/constants/theme';
import type { Order, OrderStatus } from '@/lib/types';

const STATUS_LABEL: Record<OrderStatus, string> = {
  talep_alindi: 'Talep Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};

export default function OrdersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchOrders().then((res) => {
      setOrders(res.orders);
      setError(res.error);
      setLoading(false);
    });
  }, [user]);

  // Sekmeye her dönüşte tazele (yeni sipariş verilmiş olabilir).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Siparişlerim</ThemedText>
      </View>

      {!authLoading && !user ? (
        <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={{ fontSize: 32 }}>🔒</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Siparişlerini görmek için giriş yapmalısın.
          </ThemedText>
          <Pressable style={[styles.loginBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/giris')}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">
              Giriş Yap
            </ThemedText>
          </Pressable>
        </View>
      ) : loading ? (
        <ActivityIndicator style={styles.loadingSpinner} color={theme.tint} />
      ) : (
        <FlatList
          style={styles.flex}
          data={orders}
          keyExtractor={(o) => o.tx_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: Order }) => (
            <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHeader}>
                <ThemedText type="smallBold">{item.tx_id}</ThemedText>
                <View style={[styles.statusPill, { backgroundColor: theme.tintSoft }]}>
                  <ThemedText type="small" themeColor="tint">
                    {STATUS_LABEL[item.order_status] ?? item.order_status}
                  </ThemedText>
                </View>
              </View>
              <ThemedText themeColor="textSecondary" type="small">
                {item.delivery_type === 'gel_al' ? 'Gel-Al' : 'Eve Servis'} ·{' '}
                {new Date(item.created_at).toLocaleDateString('tr-TR')}
              </ThemedText>
              <ThemedText type="small">
                {item.items.map((i) => `${i.name} (${i.qty} ${i.unit})`).join(', ')}
              </ThemedText>
              <ThemedText type="smallBold">{item.amount.toFixed(2)} ₺</ThemedText>
            </View>
          )}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText themeColor="textSecondary" style={styles.emptyText}>
                {error ? error : 'Henüz siparişin yok.'}
              </ThemedText>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.four },
  card: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  loadingSpinner: { marginTop: Spacing.five },
  emptyBox: { borderRadius: 16, padding: Spacing.four, marginHorizontal: Spacing.three, alignItems: 'center', gap: Spacing.two },
  emptyText: { textAlign: 'center' },
  loginBtn: { borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, marginTop: Spacing.one },
});
