import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/api';
import { Spacing } from '@/constants/theme';

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

/** Web'de yeni sekmede açar (tıklama olayı içinde çağrılmalı, aksi halde
 * pop-up engelleyiciye takılabilir); native'de sistem tarayıcısına düşer. */
function openPdf(url: string) {
  const full = url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
  if (Platform.OS === 'web') {
    window.open(full, '_blank', 'noopener,noreferrer');
  } else {
    Linking.openURL(full);
  }
}

export default function TedarikciHome() {
  const theme = useTheme();
  const router = useRouter();
  const { user, logout, supplierContract, acceptSupplierContract } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Tedarikçi sözleşmesi onaylanmadan panele erişilemez - backend de
  // ilgili uçlarda 403 döner, burada da tam ekran kapı gösteriyoruz.
  const contractPending = supplierContract && !supplierContract.accepted && supplierContract.current_version;

  async function handleAccept() {
    setAccepting(true);
    setAcceptError(null);
    try {
      await acceptSupplierContract();
    } catch {
      setAcceptError('Onaylanamadı, tekrar dene.');
    } finally {
      setAccepting(false);
    }
  }

  if (contractPending) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={[styles.gateCard, { backgroundColor: theme.authCard }]}>
          <ThemedText type="title" style={{ fontSize: 22 }}>Tedarikçi Sözleşmesi</ThemedText>
          <ThemedText themeColor="textSecondary">
            Panele devam etmeden önce {supplierContract!.contract.title || 'Tedarikçi Sözleşmesi'}'ni okuyup
            onaylaman gerekiyor (sürüm {supplierContract!.current_version}).
          </ThemedText>
          {supplierContract!.contract.url && (
            <Pressable
              style={[styles.outlineBtn, { borderColor: theme.tint }]}
              onPress={() => openPdf(supplierContract!.contract.url!)}
            >
              <ThemedText themeColor="tint" type="smallBold">PDF'i Görüntüle</ThemedText>
            </Pressable>
          )}
          {acceptError && <ThemedText themeColor="danger" type="small">{acceptError}</ThemedText>}
          <Pressable style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={handleAccept} disabled={accepting}>
            {accepting ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">Okudum, Kabul Ediyorum</ThemedText>
            )}
          </Pressable>
          <Pressable onPress={logout}>
            <ThemedText themeColor="textSecondary" type="small" style={{ textAlign: 'center', marginTop: Spacing.two }}>
              Çıkış Yap
            </ThemedText>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <View style={styles.body}>
        <ThemedText type="title" style={{ fontSize: 22 }}>Merhaba, {user?.name}</ThemedText>
        <ThemedText themeColor="textSecondary">{user?.supplier_group ?? 'Tedarikçi'}</ThemedText>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/tedarikci/urunlerim')}>
          <ThemedText type="smallBold">📦 Ürünlerim</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Ürün ekle, fiyat/stok güncelle</ThemedText>
        </Pressable>

        <Pressable style={[styles.card, { backgroundColor: theme.authCard }]} onPress={() => router.push('/tedarikci/satislarim')}>
          <ThemedText type="smallBold">📊 Satışlarım</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">Tezgah fiyatından hesaplanan satış logu</ThemedText>
        </Pressable>

        <Pressable style={[styles.outlineBtn, { borderColor: theme.danger, marginTop: Spacing.four }]} onPress={logout}>
          <ThemedText themeColor="danger" type="smallBold">Çıkış Yap</ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  outlineBtn: { borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center' },
  submitBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
  gateCard: { flex: 1, margin: Spacing.three, borderRadius: 16, padding: Spacing.three, gap: Spacing.two, justifyContent: 'center' },
});
