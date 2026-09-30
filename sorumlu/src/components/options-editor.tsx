import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { OPTION_PRESETS, presetFor } from '@/lib/option-presets';

export type Choice = { label: string; price_delta: number };
export type OptionGroup = { title: string; choices: Choice[] };

/** Her grubun en altında sabit, 0 TL, silinemeyen seçenek (sunucu da zorlar). */
export const NONE_CHOICE = 'İstemiyorum';
const NONE_LABELS = ['istemiyorum', 'seçmiyorum'];
const isNone = (label: string) => NONE_LABELS.includes(label.trim().toLocaleLowerCase('tr-TR'));

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
        // "İstemiyorum" düzenlenebilir listede tutulmaz; en altta kilitli gösterilir
        choices: (g.choices ?? [])
          .filter((c) => !isNone(c.label ?? ''))
          .map((c) => ({ label: c.label ?? '', price_delta: Number(c.price_delta) || 0 })),
      })),
    );
  }, [product]);

  async function save() {
    if (!product) return;
    const clean = groups.map((g) => ({ title: g.title.trim(), choices: g.choices.map((c) => ({ ...c, label: c.label.trim() })) }));
    if (clean.some((g) => !g.title || g.choices.length === 0 || g.choices.some((c) => !c.label || isNone(c.label)))) {
      return setError('Boş grup adı, boş seçenek ya da "İstemiyorum" dışında en az bir seçenek eksik');
    }
    for (const g of clean) g.choices.push({ label: NONE_CHOICE, price_delta: 0 });
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
  // Üründe zaten olan gruplar kısayollarda tekrar önerilmez
  const quickPresets = OPTION_PRESETS.filter((p) => !groups.some((g) => presetFor(g.title) === p));

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
              Müşteri ürünü seçerken boyut, kesim gibi bir seçim yapar. Ek fiyat kilo/adet başına eklenir. "İstemiyorum" (0 ₺) her grubun en altında sabittir ve varsayılandır.
            </ThemedText>
            {/* Kısayollar: dokununca grup seçenekleriyle (0 ₺) gelir */}
            {quickPresets.length > 0 && (
              <View style={styles.presetRow}>
                <ThemedText type="small" themeColor="textSecondary">Hızlı ekle:</ThemedText>
                {quickPresets.map((p) => (
                  <Pressable
                    key={p.title}
                    style={[styles.presetChip, { borderColor: theme.tint }]}
                    onPress={() => setGroups([...groups, { title: p.title, choices: p.choices.map((label) => ({ label, price_delta: 0 })) }])}
                  >
                    <Ionicons name="add" size={13} color={theme.tint} />
                    <ThemedText type="small" themeColor="tint">{p.title}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
            {groups.map((g, gi) => {
              const setGroup = (ng: OptionGroup) => setGroups(groups.map((x, i) => (i === gi ? ng : x)));
              // Başlık bir kısayola uyarsa ve seçenekler henüz boşsa kendiliğinden doldur
              const onTitle = (v: string) => {
                const preset = presetFor(v);
                const empty = g.choices.every((c) => !c.label.trim());
                setGroup(preset && empty ? { title: v, choices: preset.choices.map((label) => ({ label, price_delta: 0 })) } : { ...g, title: v });
              };
              return (
                <View key={gi} style={[styles.group, { borderColor: theme.border }]}>
                  <View style={styles.row}>
                    <TextInput value={g.title} onChangeText={onTitle} autoCapitalize="words" placeholder="Grup adı (örn: Boyut)" placeholderTextColor={theme.textSecondary} style={[input, styles.flex]} />
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
                        autoCapitalize="words" placeholder="Örn: Büyük"
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
                  {/* Sabit, kilitli: hep en altta, 0 TL, silinemez */}
                  <View style={styles.row}>
                    <View style={[input, styles.flex, styles.locked, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText type="small" themeColor="textSecondary">{NONE_CHOICE}</ThemedText>
                    </View>
                    <View style={[input, styles.delta, styles.locked, { backgroundColor: theme.backgroundSelected, alignItems: 'center' }]}>
                      <ThemedText type="small" themeColor="textSecondary">0</ThemedText>
                    </View>
                    <View style={[styles.iconBtn, { opacity: 0.6 }]}>
                      <Ionicons name="lock-closed" size={16} color={theme.textSecondary} />
                    </View>
                  </View>
                  <Pressable style={styles.link} onPress={() => setGroup({ ...g, choices: [...g.choices, { label: '', price_delta: 0 }] })}>
                    <Ionicons name="add" size={16} color={theme.tint} />
                    <ThemedText type="small" themeColor="tint">Seçenek ekle</ThemedText>
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              style={[styles.addGroup, { borderColor: theme.tint }]}
              onPress={() => setGroups([...groups, { title: '', choices: [{ label: '', price_delta: 0 }] }])}
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
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  locked: { justifyContent: 'center', minHeight: 38, borderStyle: 'dashed' },
  iconBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  addGroup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 10 },
  save: { borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
});
