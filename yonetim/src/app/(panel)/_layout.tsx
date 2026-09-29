import { Ionicons } from '@expo/vector-icons';
import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Loading, T, type IconName } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Özet', icon: 'grid-outline' },
  { href: '/siparisler', label: 'Siparişler', icon: 'receipt-outline' },
  { href: '/pazarlar', label: 'Pazarlar', icon: 'storefront-outline' },
  { href: '/urunler', label: 'Ürünler', icon: 'nutrition-outline' },
  { href: '/urun-talepleri', label: 'Ürün Talepleri', icon: 'git-pull-request-outline' },
  { href: '/personel', label: 'Personel', icon: 'people-circle-outline' },
  { href: '/uyeler', label: 'Üyeler', icon: 'people-outline' },
  { href: '/destek', label: 'Destek', icon: 'help-buoy-outline' },
];

/** Giriş + authenticator zorunluluğu burada denetlenir; panelin hiçbir
 *  ekranı bunlar olmadan açılmaz. */
export default function PanelLayout() {
  const t = useTheme();
  const { ready, token, user, signOut } = useSession();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();

  if (!ready) return <Loading />;
  if (!token || !user) return <Redirect href="/giris" />;
  if (!user.totp_enabled) return <Redirect href="/guvenlik" />;

  const wide = width >= 900;
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const items = NAV.map((n) => {
    const on = isActive(n.href);
    return (
      <Pressable
        key={n.href}
        onPress={() => router.navigate(n.href as any)}
        style={[wide ? styles.sideItem : styles.tabItem, on && { backgroundColor: t.tint }]}
      >
        <Ionicons name={n.icon} size={18} color={on ? t.tintText : t.text} />
        <Text style={{ color: on ? t.tintText : t.text, fontWeight: '600', fontSize: 14 }}>{n.label}</Text>
      </Pressable>
    );
  });

  const logout = (
    <Pressable onPress={() => signOut()} style={wide ? styles.sideItem : styles.tabItem}>
      <Ionicons name="log-out-outline" size={18} color={t.danger} />
      <Text style={{ color: t.danger, fontWeight: '600', fontSize: 14 }}>Çıkış</Text>
    </Pressable>
  );

  if (wide) {
    return (
      <SafeAreaView style={[styles.row, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <View style={[styles.side, { backgroundColor: t.card, borderRightColor: t.border }]}>
          <View style={styles.brand}>
            <T bold size={17}>Afro Gıda</T>
            <T muted size={12}>Yönetim · {user.name || 'Yönetici'}</T>
          </View>
          <View style={{ gap: 4 }}>{items}</View>
          <View style={{ flex: 1 }} />
          {logout}
        </View>
        <View style={styles.flex}>
          <Slot />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.tabs, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsInner}>
          {items}
          {logout}
        </ScrollView>
      </View>
      <View style={styles.flex}>
        <Slot />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  side: { width: 210, padding: 12, gap: 14, borderRightWidth: StyleSheet.hairlineWidth },
  brand: { paddingHorizontal: 8, paddingVertical: 6, gap: 2 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8 },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabsInner: { gap: 4, padding: 8 },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
});
