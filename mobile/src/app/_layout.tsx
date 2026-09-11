import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { ContractGate } from '@/components/contract-gate';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { ProductsProvider } from '@/lib/products-context';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: theme.backgroundElement },
    headerTintColor: theme.text,
    headerTitleStyle: { color: theme.text },
  };

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <ProductsProvider>
          <CartProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="urun/[id]" options={{ headerShown: true, title: 'Ürün', ...headerOptions }} />
              <Stack.Screen
                name="giris"
                options={{ presentation: 'modal', headerShown: true, title: 'Giriş Yap', ...headerOptions }}
              />
              <Stack.Screen
                name="kayit"
                options={{ presentation: 'modal', headerShown: true, title: 'Kayıt Ol', ...headerOptions }}
              />
              <Stack.Screen
                name="sifremi-unuttum"
                options={{ presentation: 'modal', headerShown: true, title: 'Şifremi Unuttum', ...headerOptions }}
              />
            </Stack>
            <ContractGate />
            <StatusBar style="auto" />
          </CartProvider>
        </ProductsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
