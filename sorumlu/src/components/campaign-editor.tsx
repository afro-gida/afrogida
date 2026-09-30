import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';

export type CampaignProduct = {
  id: string;
  name: string;
  unit?: string;
  sale_price?: number | null;
  price?: number | null;
  supplier_price?: number | null;
  campaign_discount_percent?: number | null;
  campaign_min_qty?: number | null;
};

/**
 * "Çok al az öde" kampanyası (en az miktar + % indirim). Sadece sorumlu /
 * yönetici ayarlar; indirim tedarikçinin alacağından düşer, platform kârı
 * sabit kalır (PUT /pazar-sorumlusu/products/{id}/campaign).
 */
export function CampaignEditor({
  product,
  onClose,
  onSaved,
}: {
  product: CampaignProduct | null;
  onClose: () => void;
  onSaved: (v: { campaign_discount_percent: number; campaign_min_qty: number }) => void;
}) {
  const theme = useTheme();
  const [pct, setPct] = useState('');
  const [min, setMin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setPct(product?.campaign_discount_percent ? String(product.campaign_discount_percent) : '');
    setMin(product?.campaign_min_qty ? String(product.campaign_min_qty) : '');
  }, [product]);

  const unit = (product?.unit || 'kg').toLowerCase();
  const p = Math.min(90, Number(pct) || 0);
  const m = Number(min.replace(',', '.')) || 0;
  const sale = product?.sale_price ?? product?.price ?? 0;
  const buy = product?.supplier_price ?? 0;
  // Örnek: eşik miktarında müşterinin indirimi = tedarikçiden düşen tutar
  const exampleDiscount = Math.round(sale * m * p) / 100;

  async function save(values: { campaign_discount_percent: number; campaign_min_qty: number }) {
    if (!product) return;
    if ((values.campaign_discount_percent > 0) !== (values.campaign_min_qty > 0)) {
      return setError('İndirim ve en az miktarı birlikte gir (kapatmak için ikisini de boş bırak)');
    }
    setSaving(true);
    setError('');
    try {
      const r = await api.put<{ campaign_discount_percent: number; campaign_min_qty: number }>(
        `/pazar-sorumlusu/products/${product.id}/campaign`,
        values,
      );
      onSaved({ campaign_discount_percent: r.campaign_discount_percent, campaign_min_qty: r.campaign_min_qty });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const input = [styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }];
  const hasCampaign = !!product?.campaign_discount_percent && !!product?.campaign_min_qty;

  return (
    <Modal visible={!!product} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.authCard }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">Kampanya (çok al az öde)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{product?.name}</ThemedText>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat">
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.row}>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary">En az miktar ({unit})</ThemedText>
              <TextInput value={min} onChangeText={(v) => setMin(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="Örn: 3" placeholderTextColor={theme.textSecondary} style={input} />
            </View>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary">İndirim (%)</ThemedText>
              <TextInput value={pct} onChangeText={(v) => setPct(v.replace(/[^\d]/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="Örn: 10" placeholderTextColor={theme.textSecondary} style={input} />
            </View>
          </View>

          <View style={[styles.info, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="information-circle-outline" size={17} color={theme.tint} />
            <ThemedText type="small" style={{ flex: 1 }}>
              İndirim <ThemedText type="smallBold">tedarikçinin alacağından</ThemedText> düşer, bizim kârımız değişmez.
              {p > 0 && m > 0 && sale > 0
                ? ` Örn: ${m} ${unit} alana ${exampleDiscount.toLocaleString('tr-TR')} ₺ indirim; tedarikçi ${(Math.round((buy * m - exampleDiscount) * 100) / 100).toLocaleString('tr-TR')} ₺ alır.`
                : ''}
            </ThemedText>
          </View>

          {!!error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
          <Pressable style={[styles.save, { backgroundColor: theme.tint }]} onPress={() => save({ campaign_discount_percent: p, campaign_min_qty: m })} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <ThemedText type="smallBold" style={{ color: '#fff' }}>Kaydet</ThemedText>}
          </Pressable>
          {hasCampaign && (
            <Pressable style={styles.off} onPress={() => save({ campaign_discount_percent: 0, campaign_min_qty: 0 })} disabled={saving}>
              <ThemedText type="small" themeColor="danger">Kampanyayı kapat</ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.three },
  sheet: { borderRadius: 18, padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: 480, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 16 },
  info: { flexDirection: 'row', gap: 6, borderRadius: 10, padding: 10, alignItems: 'flex-start' },
  save: { borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  off: { alignItems: 'center', paddingVertical: 4 },
});
