import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Product {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  unit: string;
  // Tedarikçi sadece kendi (alış/tezgah) fiyatını görür; müşteri fiyatı ve kâr
  // marjı sunucuda hesaplanır ve bu uca hiç gelmez.
  supplier_price?: number | null;
  image_url?: string | null;
  in_stock: boolean;
  active: boolean;
}

/** Ürünlerim: resimli liste; ürüne dokununca tam ekran düzenleme açılır. */
export default function UrunlerimScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Düzenlemeden dönünce liste güncellensin
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError('');
      api
        .get<Product[]>('/admin/products')
        .then((p) => alive && setProducts(p))
        .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi'))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable style={[styles.addBtn, { backgroundColor: theme.tint }]} onPress={() => router.push('/tedarikci/urun/yeni')}>
          <ThemedText style={{ color: '#fff' }} type="smallBold">+ Ürün Ekle</ThemedText>
        </Pressable>

        {loading && <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.three }} />}
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {products.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => router.push({ pathname: '/tedarikci/urun/[id]', params: { id: p.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: theme.authCard, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={[styles.thumb, { backgroundColor: theme.inputBg }]}>
              {p.image_url ? (
                <Image source={{ uri: p.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <Ionicons name="image-outline" size={22} color={theme.textSecondary} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText type="smallBold" numberOfLines={1}>{p.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {p.subcategory ?? '—'} › {p.category}
              </ThemedText>
              <ThemedText type="small">
                ₺{p.supplier_price ?? 0} / {p.unit.toLowerCase()}
                {!p.in_stock ? '  ' : ''}
                {!p.in_stock && <ThemedText type="small" themeColor="danger">Tükendi</ThemedText>}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        ))}
        {!loading && !error && products.length === 0 && (
          <ThemedText themeColor="textSecondary">Henüz ürün eklemedin.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  addBtn: { borderRadius: 999, paddingVertical: Spacing.two, alignItems: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, borderRadius: 16, padding: Spacing.two + 2 },
  thumb: { width: 60, height: 60, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
