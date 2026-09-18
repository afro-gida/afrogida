import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';

export default function KuryeLayout() {
  const theme = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: theme.authCard },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
  };
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Kurye Paneli', ...headerOptions }} />
      <Stack.Screen name="gecmis" options={{ title: 'Teslim Geçmişi', ...headerOptions }} />
    </Stack>
  );
}
