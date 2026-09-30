import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export type Choice = { label: string; price_delta: number };
export type OptionGroup = { title: string; choices: Choice[] };

/**
 * Bir ürünün seçeneklerini (Boyut, Şekil …) düzenleme penceresi. Sorumlu
 * onay veren kişi olduğu için kaydedince doğrudan geçerli olur
 * (PUT /pazar-sorumlusu/products/{id}/options).
 */
export function OptionsEditor({
  product,
  onClose,
  onSaved,
}: {
  product: { id: string; name: string; customization_options?: OptionGroup[] | null } | null;
  onClose: () => void;
  onSaved: (options: OptionGroup[] | null) => void;
}) {
  const theme = useTheme();
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setGroups(
      (product?.customization_options ?? []).map((g) => ({
        title: g.title ?? '',
        choices: (g.choices ?? []).map((c) => ({ label: c.label ?? '', price_delta: Number(c.price_delta) || 0 })),
      })),
    );
  }, [product]);

  async function save() {
    if (!product) return;
    const clean = groups.map((g) => ({ title: g.title.trim(), choices: g.choices.map((c) => ({ ...c, label: c.label.trim() })) }));
    if (clean.some((g) => !g.title || g.choices.length === 0 || g.choices.some((c) => !c.label))) {
      return setError('Boş grup adı veya boş seçenek var');
    }
    setSaving(true);
    setError('');
    try {
      const r = await api.put<{ customization_options: OptionGroup[] | null }>(`/pazar-sorumlusu/products/${product.id}/options`, {
        customization_options: clean,
      });
      onSaved(r.customization_options);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const input = [styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }];

  return (
    <Modal visible={!!product} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.authCard }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">Seçenekler</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{product?.name}</ThemedText>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat">
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: Spacing.two }} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              Müşteri ürünü seçerken boyut, kesim gibi bir seçim yapar. İlk seçenek varsayılandır; ek fiyat kilo/adet başına eklenir.
            </ThemedText>
            {groups.map((g, gi) => {
              const setGroup = (ng: OptionGroup) => setGroups(groups.map((x, i) => (i === gi ? ng : x)));
              return (
                <View key={gi} style={[styles.group, { borderColor: theme.border }]}>
                  <View style={styles.row}>
                    <TextInput value={g.title} onChangeText={(v) => setGroup({ ...g, title: v })} placeholder="Grup adı (örn: Boyut)" placeholderTextColor={theme.textSecondary} style={[input, styles.flex]} />
                    <Pressable style={[styles.iconBtn, { backgroundColor: theme.danger }]} onPress={() => setGroups(groups.filter((_, i) => i !== gi))} accessibilityLabel="Grubu sil">
                      <Ionicons name="trash-outline" size={17} color="#fff" />
                    </Pressable>
                  </View>
                  <View style={styles.row}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>Seçenek</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.delta}>Ek fiyat ₺</ThemedText>
                    <View style={{ width: 38 }} />
                  </View>
                  {g.choices.map((c, ci) => (
                    <View key={ci} style={styles.row}>
                      <TextInput
                        value={c.label}
                        onChangeText={(v) => setGroup({ ...g, choices: g.choices.map((y, j) => (j === ci ? { ...y, label: v } : y)) })}
                        placeholder="Örn: Büyük"
                        placeholderTextColor={theme.textSecondary}
                        style={[input, styles.flex]}
                      />
                      <TextInput
                        value={c.price_delta ? String(c.price_delta) : ''}
                        onChangeText={(v) => setGroup({ ...g, choices: g.choices.map((y, j) => (j === ci ? { ...y, price_delta: Number(v.replace(/[^\d]/g, '')) || 0 } : y)) })}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={theme.textSecondary}
                        style={[input, styles.delta, { textAlign: 'center' }]}
                      />
                      <Pressable style={[styles.iconBtn, { backgroundColor: theme.backgroundSelected }]} onPress={() => setGroup({ ...g, choices: g.choices.filter((_, j) => j !== ci) })} accessibilityLabel="Seçeneği sil">
                        <Ionicons name="close" size={18} color={theme.danger} />
                      </Pressable>
                    </View>
                  ))}
                  <Pressable style={styles.link} onPress={() => setGroup({ ...g, choices: [...g.choices, { label: '', price_delta: 0 }] })}>
                    <Ionicons name="add" size={16} color={theme.tint} />
                    <ThemedText type="small" themeColor="tint">Seçenek ekle</ThemedText>
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              style={[styles.addGroup, { borderColor: theme.tint }]}
              onPress={() => setGroups([...groups, { title: '', choices: [{ label: 'İstemiyorum', price_delta: 0 }, { label: '', price_delta: 0 }] }])}
            >
              <Ionicons name="add" size={18} color={theme.tint} />
              <ThemedText type="smallBold" themeColor="tint">Grup ekle</ThemedText>
            </Pressable>
          </ScrollView>

          {!!error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
          <Pressable style={[styles.save, { backgroundColor: theme.tint }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <ThemedText type="smallBold" style={{ color: '#fff' }}>Kaydet</ThemedText>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.three },
  sheet: { borderRadius: 18, padding: Spacing.three, gap: Spacing.two, maxHeight: '90%', width: '100%', maxWidth: 520, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  group: { borderWidth: 1, borderRadius: 12, padding: Spacing.two, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  delta: { width: 78 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  addGroup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 10 },
  save: { borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
});
