import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// Gerçek sitenin alt menüsü gibi: koyu, YARI SAYDAM buzlu-cam zemin (arkadan
// duvar kağıdı hafif seçilir), belirgin renkli bir kenarlık YOK — sadece
// aktif sekmenin ikonu aksan rengine (turuncu/yeşil) boyanıyor.
const TAB_BAR_BG_DARK = 'rgba(8, 10, 9, 0.6)';
const TAB_BAR_BG_LIGHT = 'rgba(255, 255, 255, 0.6)';
const TAB_ICON_INACTIVE_DARK = 'rgba(130, 136, 133, 0.9)';
const TAB_ICON_INACTIVE_LIGHT = 'rgba(20, 30, 25, 0.6)';

const TABS: { name: string; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'kampanyalar', title: 'Kampanyalar', icon: 'megaphone' },
  { name: 'index', title: 'Ürünler', icon: 'leaf' },
  { name: 'sepet', title: 'Sepet', icon: 'basket' },
  { name: 'siparislerim', title: 'Siparişlerim', icon: 'receipt' },
  { name: 'profil', title: 'Profil', icon: 'person' },
];

/**
 * Alt menüyü React Navigation'ın varsayılan `tabBarStyle`/`tabBarItemStyle`
 * ayarlarıyla değil, TAMAMEN KENDİ satırımızı çizerek üretiyoruz — birkaç
 * denemede kütüphanenin varsayılan iç boşluk/hizalama davranışı web'de
 * beklendiği gibi çalışmadı (ikonlar aralarında boşluk bırakmadan
 * kümelendi). Bu bileşen `<Tabs tabBar={...}>` ile devreye giriyor; ikon
 * aralığı, ortalama ve boyut BURADA, düz bir flex satırıyla, garanti
 * şekilde kontrol ediliyor.
 *
 * `props`'un tam tipi (`BottomTabBarProps`) expo-router'ın iç
 * (react-navigation/bottom-tabs) modülünden geliyor ve dışa açık değil; SDK
 * sürümleri arasında kırılgan bir iç yola import etmemek için `any`
 * kullanıyoruz — sadece `state`, `navigation` ve `insets` alanlarını
 * okuyoruz.
 */
function CustomTabBar({ state, navigation, insets }: any) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const glassStyle: any =
    Platform.OS === 'web' ? { backdropFilter: 'blur(14px) saturate(1.3)' } : null;

  return (
    <View
      style={[
        {
          position: 'absolute',
          left: Spacing.three,
          right: Spacing.three,
          bottom: Spacing.three + insets.bottom,
          height: 60,
          borderRadius: 30,
          borderWidth: 1,
          borderColor: theme.tint,
          backgroundColor: isDark ? TAB_BAR_BG_DARK : TAB_BAR_BG_LIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-evenly',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 10,
        },
        glassStyle,
        Platform.OS === 'web'
          ? // Web'de geniş masaüstü penceresinde şerit de üstteki içerik
            // sütunuyla aynı telefon genişliğinde ortalanır.
            ({ maxWidth: MaxContentWidth - Spacing.three * 2, marginHorizontal: 'auto' } as any)
          : null,
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        const color = focused ? theme.tint : isDark ? TAB_ICON_INACTIVE_DARK : TAB_ICON_INACTIVE_LIGHT;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            hitSlop={8}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={tab.icon} size={32} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Bir pazara "Siparişe Başla" ile girince açılan alışveriş bölümü.
 * Sekme sırası: Kampanyalar / Ürünler / Sepet / Siparişlerim / Profil.
 * Varsayılan (giriş) sekme yine Ürünler (index) — initialRouteName ile
 * sekme sırasından bağımsız ayarlanır.
 */
export default function ShopTabsLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enterMarket } = useCart();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (id) enterMarket(id);
  }, [id]);

  // Ürünleri görmek/sipariş vermek için üyelik zorunlu (kullanıcı talimatı) —
  // doğrudan bağlantıyla (deep link) girişi de burada engelliyoruz, sadece
  // pazar listesindeki butonu değil. Oturum kontrolü bitene kadar (authLoading)
  // sekmeleri hiç göstermiyoruz ki üye olmayan biri anlık bir yanıp sönme ile
  // ürünleri görmesin.
  if (authLoading) return null;
  if (!user) return <Redirect href="/giris" />;

  return (
    <Tabs
      initialRouteName="index"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
      ))}
    </Tabs>
  );
}
