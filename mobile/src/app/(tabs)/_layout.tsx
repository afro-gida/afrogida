import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart } from '@/lib/cart-context';
import { useTheme } from '@/hooks/use-theme';

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const theme = useTheme();
  const { totalQty } = useCart();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
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
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Pazarlar', tabBarIcon: () => <TabIcon symbol="🏪" /> }}
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
        name="hesabim"
        options={{ title: 'Hesabım', tabBarIcon: () => <TabIcon symbol="👤" /> }}
      />
    </Tabs>
  );
}
