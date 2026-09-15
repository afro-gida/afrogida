import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ContractGate } from '@/components/contract-gate';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { MarketsProvider } from '@/lib/markets-context';
import { ProductsProvider } from '@/lib/products-context';
import { ThemePreferenceProvider } from '@/lib/theme-preference';

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <RootLayoutInner />
    </ThemePreferenceProvider>
  );
}

function RootLayoutInner() {
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
        <MarketsProvider>
          <ProductsProvider>
            <CartProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="pazar/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="urun/[id]" options={{ headerShown: true, title: 'Ürün', ...headerOptions }} />
                <Stack.Screen name="giris" options={{ presentation: 'modal', headerShown: false }} />
                <Stack.Screen name="kayit" options={{ presentation: 'modal', headerShown: false }} />
                <Stack.Screen
                  name="sifremi-unuttum"
                  options={{ presentation: 'modal', headerShown: true, title: 'Şifremi Unuttum', ...headerOptions }}
                />
              </Stack>
              <ContractGate />
              <StatusBar style="auto" />
            </CartProvider>
          </ProductsProvider>
        </MarketsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
