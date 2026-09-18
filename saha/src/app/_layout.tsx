import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/hooks/use-theme';

/** Bir sayfa doğrudan (adres çubuğuna yazarak veya F5 ile) açıldığında, o
 * sayfanın kendi veri çekme effect'i AuthProvider'ın kayıtlı token'ı
 * AsyncStorage'dan geri yükleyip isteklere eklemesinden ÖNCE çalışabiliyordu
 * - bu da "Yetkilendirme gerekli" hatasıyla sonuçlanıyordu (kullanıcı
 * talimatıyla bulunan hata: sipariş detayını yenileyince görülüyordu).
 * Token yüklenene kadar hiçbir alt sayfa render edilmeyerek önleniyor. */
function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const theme = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="giris" />
            <Stack.Screen name="tedarikci" />
            <Stack.Screen name="kurye" />
          </Stack>
        </AuthGate>
        <StatusBar style="auto" />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
