import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';

export default function TedarikciLayout() {
  const theme = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Tedarikçi Paneli', ...headerOptions }} />
      <Stack.Screen name="urunlerim" options={{ title: 'Ürünlerim', ...headerOptions }} />
      <Stack.Screen name="satislarim" options={{ title: 'Satışlarım', ...headerOptions }} />
    </Stack>
  );
}
