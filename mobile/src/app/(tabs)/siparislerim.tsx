import { FlatList, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { SAMPLE_ORDERS } from '@/data/sample';
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

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">Siparişlerim</ThemedText>
      </View>
      <FlatList
        style={styles.flex}
        data={SAMPLE_ORDERS}
        keyExtractor={(o) => o.tx_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }: { item: Order }) => (
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold">{item.tx_id}</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: theme.tintSoft }]}>
                <ThemedText type="small" themeColor="tint">
                  {STATUS_LABEL[item.order_status]}
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
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            Henüz siparişin yok.
          </ThemedText>
        }
      />
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
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
