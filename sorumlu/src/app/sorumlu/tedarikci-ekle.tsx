import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Market {
  id: string;
  name: string;
  day?: string;
}

interface SupplierEntry {
  supplier_group: string;
  markets: string[]; // pazar ADLARI (bkz. backend pazar_sorumlusu.py)
}

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/**
 * Pazarlarıma tedarikçi ata: her pazarın altında sistemdeki TÜM tedarikçiler
 * listelenir; atanmış olanlar işaretli. Dokununca atanır / kaldırılır.
 * Yeni tedarikçiyi yönetici tanımlar (sorumlu sadece listeden seçer).
 */
export default function SorumluTedarikciEkle() {
  const theme = useTheme();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [all, setAll] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<SupplierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function load() {
    setError('');
    Promise.all([
      api.get<Market[]>('/pazar-sorumlusu/markets'),
      api.get<string[]>('/pazar-sorumlusu/all-suppliers'),
      api.get<SupplierEntry[]>('/pazar-sorumlusu/suppliers'),
    ])
      .then(([m, a, s]) => {
        setMarkets(m);
        setAll(a);
        setAssigned(s);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const isAssigned = (group: string, market: Market) =>
    assigned.some((s) => s.supplier_group === group && s.markets.some((n) => norm(n) === norm(market.name)));

  async function toggle(group: string, market: Market) {
    const on = isAssigned(group, market);
    const key = `${market.id}::${group}`;
    setBusyKey(key);
    setError('');
    try {
      await api.post(on ? '/pazar-sorumlusu/suppliers/unassign' : '/pazar-sorumlusu/suppliers/assign', {
        supplier_group: group,
        market_id: market.id,
      });
      const s = await api.get<SupplierEntry[]>('/pazar-sorumlusu/suppliers');
      setAssigned(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="small" themeColor="textSecondary">
          Pazarında satış yapacak tedarikçilere dokun. İşaretli olanların ürünleri o pazarda müşterilere görünür.
          Listede olmayan yeni bir tedarikçiyi yönetici ekler.
        </ThemedText>
        {loading && <ActivityIndicator color={theme.tint} style={{ marginTop: Spacing.three }} />}
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {markets.map((m) => {
          const count = all.filter((g) => isAssigned(g, m)).length;
          return (
            <View key={m.id} style={[styles.card, { backgroundColor: theme.authCard }]}>
              <View style={styles.titleRow}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>
                  {m.name}{m.day ? ` · ${m.day}` : ''}
                </ThemedText>
                <ThemedText type="small" themeColor={count ? 'tint' : 'danger'}>{count} tedarikçi</ThemedText>
              </View>
              <View style={styles.chipRow}>
                {all.map((g) => {
                  const on = isAssigned(g, m);
                  const busy = busyKey === `${m.id}::${g}`;
                  return (
                    <Pressable
                      key={g}
                      disabled={!!busyKey}
                      onPress={() => toggle(g, m)}
                      style={[styles.chip, { borderColor: theme.tint, backgroundColor: on ? theme.tint : 'transparent', opacity: busyKey && !busy ? 0.6 : 1 }]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={on ? '#fff' : theme.tint} />
                      ) : (
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text, fontWeight: '700' }}>
                          {on ? '✓ ' : ''}{g}
                        </ThemedText>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
        {!loading && all.length === 0 && <ThemedText themeColor="textSecondary">Sistemde henüz tedarikçi yok.</ThemedText>}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
});
