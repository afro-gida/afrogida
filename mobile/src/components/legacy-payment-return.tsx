import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import { loadLatestPendingPayment } from '@/lib/pending-payment';

/**
 * Sunucu PayTR dönüş adresini henüz eski biçimde (/my-orders, /cart)
 * veriyorsa müşteriyi bekleyen ödemenin bekleme ekranına yönlendirir;
 * bekleyen ödeme yoksa ana sayfaya.
 */
export function LegacyPaymentReturn({ result }: { result: 'tamam' | 'hata' }) {
  const theme = useTheme();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    loadLatestPendingPayment().then((p) => {
      if (cancelled) return;
      if (p) router.replace({ pathname: '/odeme/[tx]', params: { tx: p.txId, sonuc: result } });
      else router.replace('/');
    });
    return () => {
      cancelled = true;
    };
  }, [result, router]);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
