import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
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
      <ProductsProvider>
        <CartProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="urun/[id]" options={{ headerShown: true, title: 'Ürün', ...headerOptions }} />
            <Stack.Screen
              name="giris"
              options={{ presentation: 'modal', headerShown: true, title: 'Giriş Yap', ...headerOptions }}
            />
          </Stack>
          <StatusBar style="auto" />
        </CartProvider>
      </ProductsProvider>
    </ThemeProvider>
  );
}
