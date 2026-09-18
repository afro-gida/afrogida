import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Market {
  id: string;
  name: string;
}

interface SupplierEntry {
  supplier_group: string;
  markets: string[]; // pazar ID'leri değil, ADLARI (bkz. backend pazar_sorumlusu.py)
}

export default function SorumluTedarikciEkle() {
  const theme = useTheme();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [supplierGroup, setSupplierGroup] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<Market[]>('/pazar-sorumlusu/markets'),
      api.get<SupplierEntry[]>('/pazar-sorumlusu/suppliers'),
    ])
      .then(([m, s]) => {
        setMarkets(m);
        setSuppliers(s);
        if (m.length === 1) setSelectedMarketId(m[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function marketName(id: string) {
    return markets.find((m) => m.id === id)?.name ?? id;
  }

  async function assign() {
    if (!supplierGroup.trim() || !selectedMarketId) {
      setFormError('Tedarikçi adı ve pazar seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/pazar-sorumlusu/suppliers/assign', {
        supplier_group: supplierGroup.trim(),
        market_id: selectedMarketId,
      });
      setSupplierGroup('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function unassign(group: string, marketId: string) {
    try {
      await api.post('/pazar-sorumlusu/suppliers/unassign', { supplier_group: group, market_id: marketId });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && <ThemedText themeColor="textSecondary">Yükleniyor…</ThemedText>}
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}

        <View style={[styles.card, { backgroundColor: theme.authCard }]}>
          <ThemedText type="smallBold">Pazara Tedarikçi Ata</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Tedarikçi Adı</ThemedText>
          <TextInput
            value={supplierGroup}
            onChangeText={setSupplierGroup}
            placeholder="Örn: Afro Sebze"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
          />
          {markets.length > 1 && (
            <>
              <ThemedText type="small" themeColor="textSecondary">Pazar</ThemedText>
              <View style={styles.chipRow}>
                {markets.map((m) => (
                  <Pressable
                    key={m.id}
                    style={[styles.chip, { borderColor: theme.tint, backgroundColor: selectedMarketId === m.id ? theme.tint : 'transparent' }]}
                    onPress={() => setSelectedMarketId(m.id)}
                  >
                    <ThemedText type="small" style={{ color: selectedMarketId === m.id ? '#fff' : theme.text }}>{m.name}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {formError && <ThemedText themeColor="danger" type="small">{formError}</ThemedText>}
          <Pressable style={[styles.smallBtn, { backgroundColor: theme.tint }]} onPress={assign} disabled={saving}>
            <ThemedText style={{ color: '#fff' }} type="smallBold">{saving ? 'Kaydediliyor…' : 'Ata'}</ThemedText>
          </Pressable>
        </View>

        {suppliers.map((s) => (
          <View key={s.supplier_group} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <ThemedText type="smallBold">{s.supplier_group}</ThemedText>
            <View style={styles.chipRow}>
              {s.markets.map((mid) => (
                <View key={mid} style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="small" themeColor="textSecondary">{marketName(mid)}</ThemedText>
                </View>
              ))}
            </View>
            <View style={styles.chipRow}>
              {s.markets.map((mid) => (
                <Pressable key={mid} onPress={() => unassign(s.supplier_group, mid)}>
                  <ThemedText type="small" themeColor="danger">{marketName(mid)}'dan kaldır</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {!loading && suppliers.length === 0 && (
          <ThemedText themeColor="textSecondary">Pazarında bağlı tedarikçi yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  smallBtn: { borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
});
