import { Redirect, Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

export default function SorumluLayout() {
  const theme = useTheme();
  const { user, loading } = useAuth();
  // Oturum yoksa / düştüyse (çıkış, süre doldu, hareketsizlik) hiçbir sorumlu
  // ekranı açılmaz.
  if (!loading && (!user || user.role !== 'pazar_sorumlusu')) return <Redirect href="/giris" />;
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
    // Varsayılan alt çizgi koyu temada parlak beyaz görünüyordu.
    headerShadowVisible: false,
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Pazarım', ...headerOptions }} />
      <Stack.Screen name="siparisler" options={{ title: 'Sipariş Takip', ...headerOptions }} />
      <Stack.Screen name="siparis/[txId]" options={{ title: 'Sipariş Detayı', ...headerOptions }} />
      <Stack.Screen name="tedarikciler" options={{ title: 'Tedarikçiler', ...headerOptions }} />
      <Stack.Screen name="tedarikci-ekle" options={{ title: 'Pazara Tedarikçi Ata', ...headerOptions }} />
      <Stack.Screen name="kuryeler" options={{ title: 'Kuryeler', ...headerOptions }} />
    </Stack>
  );
}
