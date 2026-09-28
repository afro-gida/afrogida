import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCart } from '@/lib/cart-context';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { formatMoney } from '@/lib/format';
import { Spacing, withAlpha } from '@/constants/theme';
import type { Product, SelectedOption } from '@/lib/types';

export const NONE_LABEL = 'İstemiyorum';

// Veride "hiçbiri" seçeneği farklı yazılabiliyor ("İstemiyorum", "Seçmiyorum").
const NONE_LABELS = ['istemiyorum', 'seçmiyorum', 'farketmez', 'fark etmez'];

export function isNoneLabel(label: string) {
  return NONE_LABELS.includes(label.trim().toLocaleLowerCase('tr-TR'));
}

/**
 * Varsayılan seçim: ek ücretsiz "İstemiyorum"; yoksa en ucuz seçenek (ücretli
 * bir seçim sessizce varsayılan olmasın). Kartın hızlı "+"sı da bunu kullanır.
 */
export function defaultChoiceLabel(choices: { label: string; price_delta?: number }[]) {
  // Veride küçük harfle ("istemiyorum") gelebildiği için harf duyarsız.
  const none = choices.find((c) => isNoneLabel(c.label));
  const cheapest = [...choices].sort((a, b) => (a.price_delta || 0) - (b.price_delta || 0))[0];
  return (none ?? cheapest)?.label ?? '';
}

export function defaultSelectedOptions(product: Product): SelectedOption[] {
  return (product.customization_options ?? []).map((g) => {
    const label = defaultChoiceLabel(g.choices);
    const choice = g.choices.find((c) => c.label === label);
    return { title: g.title, label, price_delta: choice?.price_delta ?? 0 };
  });
}

type Props = {
  product: Product | null;
  onClose: () => void;
  /** Sepetten düzenleme için: mevcut miktar/seçim başlangıç değeri olarak gösterilir. */
  initialQty?: number;
  initialSelectedOptions?: SelectedOption[];
  /** Verilmezse varsayılan davranış: sepete yeni satır ekler/miktarı arttırır.
   *  Sepet ekranından düzenlemede bunun yerine mevcut satırı güncelleyen bir
   *  fonksiyon verilir (bkz. cart-context.updateLine). */
  onConfirm?: (qty: number, selectedOptions: SelectedOption[]) => void;
  confirmLabel?: string;
};

// Veride seçenek adları küçük harfle geliyor ("boyut", "küçük") — Türkçe kurala göre ilk harfi büyüt.
function cap(s: string) {
  return s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : s;
}

/** Ürün özelleştirme seçenekleri (ör. "Boyut: Orta/Büyük") varsa "Ekle"ye
 *  basınca açılan alttan kayan seçim ekranı — tam sayfa ürün detayı yerine bu.
 *  Sepet ekranından bir satıra basınca da aynı ekran, mevcut seçimle önceden
 *  doldurulmuş şekilde açılıyor (kullanıcı talimatı). */
export function ProductOptionsModal({
  product,
  onClose,
  initialQty,
  initialSelectedOptions,
  onConfirm,
  confirmLabel = 'Sepete Ekle',
}: Props) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const { addItem } = useCart();
  const [qty, setLocalQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!product) return;
    setImageFailed(false);
    setLocalQty(initialQty ?? qtyStep(product.unit));
    const defaults: Record<string, string> = {};
    for (const g of product.customization_options ?? []) {
      const preset = initialSelectedOptions?.find((o) => o.title === g.title);
      if (preset) {
        defaults[g.title] = preset.label;
        continue;
      }
      defaults[g.title] = defaultChoiceLabel(g.choices);
    }
    setSelected(defaults);
  }, [product?.id]);

  if (!product) return null;

  const groups = product.customization_options ?? [];
  const step = qtyStep(product.unit);
  const unit = formatUnit(product.unit).toLowerCase();
  const selectedOptions: SelectedOption[] = groups.map((g) => {
    const label = selected[g.title];
    const choice = g.choices.find((c) => c.label === label) ?? g.choices[0];
    return { title: g.title, label: choice?.label ?? '', price_delta: choice?.price_delta ?? 0 };
  });
  const delta = selectedOptions.reduce((sum, o) => sum + (o.price_delta || 0), 0);
  const unitPrice = (product.gel_al_price ?? 0) + delta;
  const total = unitPrice * qty;
  const showImage = product.image_url && !imageFailed;
  const hasCampaign = !!product.campaign_discount_percent && !!product.campaign_min_qty;
  // Açık temada beyaz yüzey yok (tema kuralı): krem; koyu temada neredeyse siyah.
  const sheetBg = isDark ? '#0a0f0c' : theme.background;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: sheetBg, paddingBottom: Spacing.three + insets.bottom }]}>
        <ScrollView bounces={false} contentContainerStyle={styles.scroll}>
          {/* Görsel: kenardan kenara, üst köşeler yuvarlak */}
          <View style={[styles.hero, { backgroundColor: theme.tintSoft }]}>
            {showImage ? (
              <Image source={{ uri: product.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setImageFailed(true)} />
            ) : (
              <Ionicons name="leaf-outline" size={64} color={withAlpha(theme.tint, 0.6)} />
            )}
            <View style={[styles.grabber, { backgroundColor: 'rgba(255,255,255,0.7)' }]} />
            {hasCampaign && (
              <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                <ThemedText style={styles.badgeText}>%{product.campaign_discount_percent} indirim</ThemedText>
              </View>
            )}
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat" style={[styles.closeBtn, { backgroundColor: withAlpha(sheetBg, 0.92) }]}>
              <Ionicons name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <ThemedText style={styles.name}>{cap(product.name)}</ThemedText>
            <View style={styles.priceRow}>
              <ThemedText style={[styles.price, { color: theme.tint }]}>₺{formatMoney(unitPrice)}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.unit}>/ {unit}</ThemedText>
              {delta > 0 && (
                <ThemedText themeColor="textSecondary" style={styles.unit}>· seçimlerle</ThemedText>
              )}
            </View>
            {hasCampaign && (
              <ThemedText style={[styles.campaign, { color: theme.tint }]}>
                {product.campaign_min_qty} {unit} ve üzeri %{product.campaign_discount_percent} indirim
              </ThemedText>
            )}
            {!!product.description && (
              <ThemedText themeColor="textSecondary" style={styles.description}>{product.description}</ThemedText>
            )}

            {groups.map((group) => (
              <View key={group.title} style={styles.group}>
                <ThemedText style={styles.groupTitle}>{cap(group.title)}</ThemedText>
                {group.choices.map((choice) => {
                  const active = selected[group.title] === choice.label;
                  return (
                    <Pressable
                      key={choice.label}
                      onPress={() => setSelected((prev) => ({ ...prev, [group.title]: choice.label }))}
                      style={({ pressed }) => [
                        styles.choice,
                        {
                          backgroundColor: active ? withAlpha(theme.tint, 0.14) : withAlpha(theme.text, 0.05),
                          borderColor: active ? theme.tint : 'transparent',
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.check, active ? { backgroundColor: theme.tint, borderColor: theme.tint } : { borderColor: withAlpha(theme.text, 0.3) }]}>
                        {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <ThemedText style={[styles.choiceText, active && { color: theme.text }]}>{cap(choice.label)}</ThemedText>
                      {choice.price_delta > 0 && (
                        <ThemedText style={[styles.choiceDelta, { color: theme.tint }]}>+₺{formatMoney(choice.price_delta)}</ThemedText>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={[styles.stepper, { backgroundColor: withAlpha(theme.tint, 0.12) }]}>
            <Pressable onPress={() => setLocalQty((q) => Math.max(step, q - step))} hitSlop={6} style={styles.stepperBtn} accessibilityLabel="Azalt">
              <MaterialCommunityIcons name="minus" size={18} color={qty <= step ? withAlpha(theme.tint, 0.4) : theme.tint} />
            </Pressable>
            <View style={styles.stepperMid}>
              <ThemedText style={styles.stepperQty}>{formatQty(qty, product.unit)}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.stepperUnit}>{unit}</ThemedText>
            </View>
            <Pressable onPress={() => setLocalQty((q) => q + step)} hitSlop={6} style={styles.stepperBtn} accessibilityLabel="Artır">
              <MaterialCommunityIcons name="plus" size={18} color={theme.tint} />
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [styles.cta, { backgroundColor: theme.tint, opacity: pressed ? 0.88 : 1 }]}
            onPress={() => {
              if (onConfirm) {
                onConfirm(qty, selectedOptions);
              } else {
                addItem(product, qty, selectedOptions);
              }
              onClose();
            }}
          >
            <ThemedText style={styles.ctaText} numberOfLines={1}>{confirmLabel}</ThemedText>
            <ThemedText style={styles.ctaTotal}>₺{formatMoney(total)}</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden',
  },
  scroll: { paddingBottom: Spacing.two },
  hero: { height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  grabber: { position: 'absolute', top: 8, width: 40, height: 5, borderRadius: 3 },
  badge: { position: 'absolute', left: Spacing.three, bottom: Spacing.three, borderRadius: 999, paddingHorizontal: Spacing.two + 2, paddingVertical: 4 },
  badgeText: { color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '900' },
  closeBtn: { position: 'absolute', top: Spacing.three, right: Spacing.three, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: 4 },
  name: { fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.5 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  price: { fontSize: 22, lineHeight: 27, fontWeight: '900' },
  unit: { fontSize: 13, lineHeight: 17, fontWeight: '700' },
  campaign: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  description: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  group: { gap: Spacing.two, marginTop: Spacing.three },
  groupTitle: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: Spacing.three, height: 52 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  choiceText: { flex: 1, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  choiceDelta: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingHorizontal: Spacing.three, paddingTop: Spacing.three - 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, height: 54, paddingHorizontal: 4 },
  stepperBtn: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  stepperMid: { minWidth: 38, alignItems: 'center' },
  stepperQty: { fontSize: 16, lineHeight: 19, fontWeight: '900' },
  stepperUnit: { fontSize: 11, lineHeight: 13, fontWeight: '700' },
  cta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 999, height: 54, paddingHorizontal: Spacing.four },
  ctaText: { color: '#fff', fontSize: 15.5, lineHeight: 19, fontWeight: '900', flexShrink: 1 },
  ctaTotal: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '900' },
});
