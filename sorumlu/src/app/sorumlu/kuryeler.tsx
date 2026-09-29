import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

interface Courier {
  user_id: string;
  name: string;
  phone: string;
  is_online: boolean;
  markets: string[]; // pazar ADLARI
}

interface Market {
  id: string;
  name: string;
  day?: string;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/** Kuryeler: pazarımdaki kuryeler + telefonla kurye ekle / pazarımdan çıkar. */
export default function SorumluKuryeler() {
  const theme = useTheme();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [marketId, setMarketId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState('');

  function load() {
    Promise.all([api.get<Courier[]>('/pazar-sorumlusu/couriers'), api.get<Market[]>('/pazar-sorumlusu/markets')])
      .then(([c, m]) => {
        setCouriers(c);
        setMarkets(m);
        setMarketId((cur) => cur || m[0]?.id || '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function add() {
    setError('');
    setDone('');
    if (phone.trim().length < 10) return setError('Kuryenin telefon numarasını gir (05xx…)');
    if (!marketId) return setError('Pazar seç');
    setBusy('add');
    try {
      await api.post('/pazar-sorumlusu/couriers/assign', { identifier: phone.trim(), market_id: marketId });
      setPhone('');
      setDone('Kurye eklendi.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eklenemedi');
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: Courier, m: Market) {
    if (Platform.OS === 'web' && !window.confirm(`${c.name || 'Kurye'} ${m.name} pazarından çıkarılsın mı?`)) return;
    setBusy(c.user_id + m.id);
    setError('');
    try {
      await api.post('/pazar-sorumlusu/couriers/unassign', { user_id: c.user_id, market_id: m.id });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Çıkarılamadı');
    } finally {
      setBusy(null);
    }
  }

  const chip = (on: boolean) => [styles.chip, { borderColor: theme.tint, backgroundColor: on ? theme.tint : 'transparent' }];

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: theme.authCard }]}>
          <ThemedText type="smallBold">Kurye Ekle</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Kişi önce Afro Gıda sitesinden üye olmuş olmalı.</ThemedText>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Telefon (05xx xxx xx xx)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
          />
          {markets.length > 1 && (
            <View style={styles.chipRow}>
              {markets.map((m) => (
                <Pressable key={m.id} style={chip(marketId === m.id)} onPress={() => setMarketId(m.id)}>
                  <ThemedText type="small" style={{ color: marketId === m.id ? '#fff' : theme.text }}>
                    {m.name}{m.day ? ` · ${m.day}` : ''}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable style={[styles.btn, { backgroundColor: theme.tint }]} onPress={add} disabled={busy === 'add'}>
            {busy === 'add' ? <ActivityIndicator color="#fff" /> : <ThemedText style={{ color: '#fff' }} type="smallBold">Kurye Ekle</ThemedText>}
          </Pressable>
          {!!done && <ThemedText type="small" themeColor="tint">{done}</ThemedText>}
        </View>

        {loading && <ActivityIndicator color={theme.tint} />}
        {!!error && <ThemedText themeColor="danger">{error}</ThemedText>}

        {couriers.map((c) => (
          <View key={c.user_id} style={[styles.card, { backgroundColor: theme.authCard }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{c.name || 'Kurye'}</ThemedText>
              <View style={[styles.badge, { backgroundColor: c.is_online ? theme.tintSoft : theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor={c.is_online ? 'tint' : 'textSecondary'}>
                  {c.is_online ? 'Çevrimiçi' : 'Çevrimdışı'}
                </ThemedText>
              </View>
            </View>
            {!!c.phone && <ThemedText type="small" themeColor="textSecondary">{c.phone}</ThemedText>}
            {markets
              .filter((m) => c.markets.some((n) => norm(n) === norm(m.name)))
              .map((m) => (
                <View key={m.id} style={styles.rowBetween}>
                  <ThemedText type="small">{m.name}</ThemedText>
                  <Pressable onPress={() => remove(c, m)} disabled={busy === c.user_id + m.id}>
                    <ThemedText type="small" themeColor="danger">
                      {busy === c.user_id + m.id ? 'Çıkarılıyor…' : 'Pazardan çıkar'}
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
          </View>
        ))}
        {!loading && couriers.length === 0 && (
          <ThemedText themeColor="textSecondary">Pazarında kayıtlı kurye yok.</ThemedText>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  btn: { borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
});
