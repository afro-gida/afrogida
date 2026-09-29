import { Redirect, Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

export default function TedarikciLayout() {
  const theme = useTheme();
  const { user, loading } = useAuth();
  // Çıkış yapılınca / oturum düşünce giriş ekranına dön (eskiden ekran kalıyordu)
  if (!loading && (!user || !['esnaf', 'supplier'].includes(user.role))) return <Redirect href="/giris" />;
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
    // Varsayılan alt çizgi koyu temada parlak beyaz görünüyordu.
    headerShadowVisible: false,
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Tedarikçi Paneli', ...headerOptions }} />
      <Stack.Screen name="urunlerim" options={{ title: 'Ürünlerim', ...headerOptions }} />
      <Stack.Screen name="urun/[id]" options={{ title: 'Ürün', ...headerOptions }} />
      <Stack.Screen name="satislarim" options={{ title: 'Satışlarım', ...headerOptions }} />
    </Stack>
  );
}
