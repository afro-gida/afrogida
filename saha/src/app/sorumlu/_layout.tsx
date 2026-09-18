import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';

export default function SorumluLayout() {
  const theme = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Pazarım', ...headerOptions }} />
      <Stack.Screen name="siparisler" options={{ title: 'Sipariş Takip', ...headerOptions }} />
      <Stack.Screen name="tedarikciler" options={{ title: 'Tedarikçiler', ...headerOptions }} />
      <Stack.Screen name="tedarikci-ekle" options={{ title: 'Pazara Tedarikçi Ata', ...headerOptions }} />
      <Stack.Screen name="kuryeler" options={{ title: 'Kuryeler', ...headerOptions }} />
    </Stack>
  );
}
