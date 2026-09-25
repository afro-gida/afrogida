import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { orderStatusIcon } from '@/components/order-status-art';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { fetchOrders } from '@/lib/orders';
import { formatMoney } from '@/lib/format';
import { Spacing } from '@/constants/theme';
import type { Order, OrderStatus } from '@/lib/types';
import { formatQty, formatUnit } from '@/lib/units';

const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

const STATUS_LABEL: Record<OrderStatus, string> = {
  talep_alindi: 'Sipariş Alındı',
  hazirlik_bekliyor: 'Hazırlık Bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
};

export default function OrdersScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.flex}>Siparişlerim</ThemedText>
        <Image
          source={scheme === 'dark' ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT}
          style={styles.logoBadge}
          resizeMode="contain"
        />
      </View>

      {!authLoading && !user ? (
        <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="lock-closed-outline" size={48} color={theme.tint} />
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
          renderItem={({ item }: { item: Order }) => {
            // Online ödemesi alınamayan sipariş işleme alınmaz — "Sipariş Alındı" değil.
            const payFailed = item.payment_method === 'online_card' && item.payment_status === 'failed';
            const bad = payFailed || item.order_status === 'iptal_edildi';
            return (
            // Karta basınca sipariş takip ekranı (app/siparis/[tx].tsx) açılır.
            <Pressable
              onPress={() => router.push({ pathname: '/siparis/[tx]', params: { tx: item.tx_id } })}
              accessibilityLabel={`${item.tx_id} siparişini takip et`}
              style={({ pressed }) => [
                styles.card,
                { borderColor: theme.border, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.statusIcon, { backgroundColor: bad ? theme.backgroundSelected : theme.tintSoft }]}>
                  <MaterialCommunityIcons
                    name={payFailed ? 'credit-card-off-outline' : orderStatusIcon(item.order_status, item.delivery_type)}
                    size={20}
                    color={bad ? theme.danger : theme.tint}
                  />
                </View>
                <View style={styles.flex}>
                  <ThemedText type="smallBold" style={payFailed ? { color: theme.danger } : undefined}>
                    {payFailed ? 'Ödeme Alınamadı' : STATUS_LABEL[item.order_status] ?? item.order_status}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {item.delivery_type === 'gel_al' ? 'Gel-Al' : 'Eve Servis'} ·{' '}
                    {new Date(item.created_at).toLocaleDateString('tr-TR')}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">{formatMoney(item.amount)} ₺</ThemedText>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </View>
              <ThemedText type="small" numberOfLines={2}>
                {item.items.map((i) => `${i.name} (${formatQty(i.qty, i.unit)} ${formatUnit(i.unit)})`).join(', ')}
              </ThemedText>
            </Pressable>
            );
          }}
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  logoBadge: { width: 60, height: 60 },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six + Spacing.four },
  card: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statusIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  loadingSpinner: { marginTop: Spacing.five },
  emptyBox: { borderRadius: 16, padding: Spacing.four, marginHorizontal: Spacing.three, alignItems: 'center', gap: Spacing.two },
  emptyText: { textAlign: 'center' },
  loginBtn: { borderRadius: 999, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, marginTop: Spacing.one },
});
