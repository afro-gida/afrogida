import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/hooks/use-theme';

export default function Index() {
  const { user, loading } = useAuth();
  const theme = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }

  if (!user) return <Redirect href="/giris" />;
  if (user.role === 'esnaf' || user.role === 'supplier') return <Redirect href="/tedarikci" />;
  if (user.role === 'kurye') return <Redirect href="/kurye" />;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.background }}>
      <ThemedText>Bu hesap için tanımlı bir rol bulunamadı ({user.role}).</ThemedText>
    </View>
  );
}
