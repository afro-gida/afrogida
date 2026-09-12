import { Tabs, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart } from '@/lib/cart-context';
import { useTheme } from '@/hooks/use-theme';

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

/**
 * Bir pazara "Siparişe Başla" ile girince açılan alışveriş bölümü.
 * Sekme sırası: Kampanyalar / Ürünler / Sepet / Siparişlerim / Profil.
 * Varsayılan (giriş) sekme yine Ürünler (index) — initialRouteName ile
 * sekme sırasından bağımsız ayarlanır.
 */
export default function ShopTabsLayout() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { totalQty, enterMarket } = useCart();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (id) enterMarket(id);
  }, [id]);

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
          height: 54 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="kampanyalar"
        options={{ title: 'Kampanyalar', tabBarIcon: () => <TabIcon symbol="🎉" /> }}
      />
      <Tabs.Screen
        name="index"
        options={{ title: 'Ürünler', tabBarIcon: () => <TabIcon symbol="🥬" /> }}
      />
      <Tabs.Screen
        name="sepet"
        options={{
          title: 'Sepet',
          tabBarIcon: () => <TabIcon symbol="🛒" />,
          tabBarBadge: totalQty > 0 ? totalQty : undefined,
        }}
      />
      <Tabs.Screen
        name="siparislerim"
        options={{ title: 'Siparişlerim', tabBarIcon: () => <TabIcon symbol="📦" /> }}
      />
      <Tabs.Screen
        name="profil"
        options={{ title: 'Profil', tabBarIcon: () => <TabIcon symbol="👤" /> }}
      />
    </Tabs>
  );
}
