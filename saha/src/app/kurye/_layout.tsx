import { Redirect, Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { BackButton } from '@/components/back-button';

export default function KuryeLayout() {
  const theme = useTheme();
  const { user, loading } = useAuth();
  // Çıkış yapılınca / oturum düşünce giriş ekranına dön
  if (!loading && (!user || user.role !== 'kurye')) return <Redirect href="/giris" />;
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
    // Varsayılan alt çizgi koyu temada parlak beyaz görünüyordu.
    headerShadowVisible: false,
    headerBackVisible: false,
    headerLeft: () => <BackButton fallback="/kurye" />,
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Kurye Paneli', ...headerOptions, headerLeft: undefined }} />
      <Stack.Screen name="gecmis" options={{ title: 'Teslim Geçmişi', ...headerOptions }} />
    </Stack>
  );
}
