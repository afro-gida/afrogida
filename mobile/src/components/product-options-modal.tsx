import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCart } from '@/lib/cart-context';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { Spacing } from '@/constants/theme';
import type { Product, SelectedOption } from '@/lib/types';

export const NONE_LABEL = 'İstemiyorum';

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
  const scheme = useColorScheme();
  const { addItem } = useCart();
  const [qty, setLocalQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!product) return;
    setLocalQty(initialQty ?? qtyStep(product.unit));
    const defaults: Record<string, string> = {};
    for (const g of product.customization_options ?? []) {
      const preset = initialSelectedOptions?.find((o) => o.title === g.title);
      if (preset) {
        defaults[g.title] = preset.label;
        continue;
      }
      const none = g.choices.find((c) => c.label === NONE_LABEL);
      defaults[g.title] = (none ?? g.choices[0])?.label ?? '';
    }
    setSelected(defaults);
  }, [product?.id]);

  if (!product) return null;

  const groups = product.customization_options ?? [];
  const step = qtyStep(product.unit);
  const selectedOptions: SelectedOption[] = groups.map((g) => {
    const label = selected[g.title];
    const choice = g.choices.find((c) => c.label === label) ?? g.choices[0];
    return { title: g.title, label: choice?.label ?? '', price_delta: choice?.price_delta ?? 0 };
  });
  const delta = selectedOptions.reduce((sum, o) => sum + (o.price_delta || 0), 0);
  const unitPrice = (product.gel_al_price ?? 0) + delta;
  const total = unitPrice * qty;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View
        style={[
          styles.modalSheet,
          { backgroundColor: scheme === 'dark' ? '#0d1210' : '#fff', borderColor: theme.tint },
        ]}
      >
        <View style={styles.modalHandle} />
        <View style={styles.modalHeaderRow}>
          <ThemedText type="subtitle" style={styles.flex} numberOfLines={1}>
            {product.name}
          </ThemedText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>
        <ThemedText themeColor="tint" type="smallBold" style={styles.modalPrice}>
          ₺{unitPrice.toFixed(2)}
          <ThemedText themeColor="textSecondary" type="small"> / {formatUnit(product.unit)}</ThemedText>
        </ThemedText>

        {groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <ThemedText type="smallBold" style={styles.groupTitle}>
              {group.title}
            </ThemedText>
            {group.choices.map((choice) => {
              const active = selected[group.title] === choice.label;
              return (
                <Pressable
                  key={choice.label}
                  onPress={() => setSelected((prev) => ({ ...prev, [group.title]: choice.label }))}
                  style={[
                    styles.choiceRow,
                    { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tintSoft : 'transparent' },
                  ]}
                >
                  <View style={styles.choiceLeft}>
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={active ? theme.tint : theme.textSecondary}
                    />
                    <ThemedText type="small">{choice.label}</ThemedText>
                  </View>
                  {choice.price_delta > 0 && (
                    <ThemedText themeColor="tint" type="small">
                      +₺{choice.price_delta.toFixed(2)}
                    </ThemedText>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={styles.modalFooterRow}>
          <View style={styles.qtyRowFull}>
            <Pressable
              onPress={() => setLocalQty((q) => Math.max(step, q - step))}
              style={[styles.qtyBtn, { backgroundColor: theme.tint }]}
            >
              <Ionicons name="remove" size={20} color="#fff" />
            </Pressable>
            <ThemedText type="smallBold" style={styles.qtyValue}>
              {formatQty(qty, product.unit)}
            </ThemedText>
            <Pressable onPress={() => setLocalQty((q) => q + step)} style={[styles.qtyBtn, { backgroundColor: theme.tint }]}>
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          </View>
          <Pressable
            style={[styles.addBtnFull, { backgroundColor: theme.tint }]}
            onPress={() => {
              if (onConfirm) {
                onConfirm(qty, selectedOptions);
              } else {
                addItem(product, qty, selectedOptions);
              }
              onClose();
            }}
          >
            <ThemedText style={{ color: '#fff' }} type="smallBold" numberOfLines={1}>
              {confirmLabel} · ₺{total.toFixed(2)}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0,
    paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, gap: Spacing.two,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', alignSelf: 'center' },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modalPrice: { fontSize: 20 },
  group: { gap: Spacing.one, marginTop: Spacing.one },
  groupTitle: { marginBottom: 2 },
  choiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
  },
  choiceLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modalFooterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  qtyRowFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 },
  qtyBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 24, textAlign: 'center' },
  addBtnFull: { flex: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
