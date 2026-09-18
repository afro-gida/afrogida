import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useProducts } from '@/lib/products-context';
import { useCart } from '@/lib/cart-context';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { formatMoney } from '@/lib/format';
import { IconGreen, Spacing } from '@/constants/theme';
import type { SelectedOption } from '@/lib/types';

const NONE_LABEL = 'İstemiyorum';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { addItem } = useCart();
  const { getById } = useProducts();
  const [imageFailed, setImageFailed] = useState(false);
  const [qty, setLocalQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const product = getById(id);

  useEffect(() => {
    if (!product) return;
    setLocalQty(qtyStep(product.unit));
    const defaults: Record<string, string> = {};
    for (const g of product.customization_options ?? []) {
      const none = g.choices.find((c) => c.label === NONE_LABEL);
      defaults[g.title] = (none ?? g.choices[0])?.label ?? '';
    }
    setSelected(defaults);
  }, [product?.id]);

  if (!product) {
    return (
      <Screen edges={['bottom']}>
        <View style={[styles.flex, styles.center]}>
          <ThemedText>Ürün bulunamadı.</ThemedText>
        </View>
      </Screen>
    );
  }

  const showImage = product.image_url && !imageFailed;
  const groups = product.customization_options ?? [];

  const selectedOptions: SelectedOption[] = groups.map((g) => {
    const label = selected[g.title];
    const choice = g.choices.find((c) => c.label === label) ?? g.choices[0];
    return { title: g.title, label: choice?.label ?? '', price_delta: choice?.price_delta ?? 0 };
  });
  const delta = selectedOptions.reduce((sum, o) => sum + (o.price_delta || 0), 0);
  const unitPrice = (product.gel_al_price ?? 0) + delta;
  const step = qtyStep(product.unit);
  const total = unitPrice * qty;

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.image, { backgroundColor: theme.tintSoft }]}>
          {showImage ? (
            <Image
              source={{ uri: product.image_url! }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Ionicons name="leaf-outline" size={96} color={IconGreen} />
          )}
        </View>

        <View style={[styles.body, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="title" style={styles.name}>
            {product.name}
          </ThemedText>
          <ThemedText themeColor="tint" type="subtitle" style={styles.price}>
            ₺{formatMoney(unitPrice)}
            <ThemedText themeColor="textSecondary" type="small"> / {formatUnit(product.unit)}</ThemedText>
          </ThemedText>

          {!!product.description && <ThemedText style={styles.description}>{product.description}</ThemedText>}

          {!product.in_stock && (
            <ThemedText themeColor="danger" type="smallBold">
              Şu an stokta yok.
            </ThemedText>
          )}

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
                        +₺{formatMoney(choice.price_delta)}
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.qtyRow}>
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
          disabled={!product.in_stock}
          style={[styles.addBtn, { backgroundColor: product.in_stock ? theme.tint : theme.border }]}
          onPress={() => {
            addItem(product, qty, selectedOptions);
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        >
          <ThemedText style={{ color: '#fff' }} type="smallBold" numberOfLines={1}>
            Sepete Ekle · ₺{formatMoney(total)}
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1 },
  image: { height: 220, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  body: { padding: Spacing.three, gap: Spacing.two, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -20 },
  name: { fontSize: 26, lineHeight: 32 },
  price: { fontSize: 22, marginTop: Spacing.one },
  description: { marginTop: Spacing.two },
  group: { marginTop: Spacing.two, gap: Spacing.one },
  groupTitle: { marginBottom: 2 },
  choiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
  },
  choiceLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  footer: { flexDirection: 'row', gap: Spacing.two, borderTopWidth: 1, padding: Spacing.three, alignItems: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 26, textAlign: 'center' },
  addBtn: { flex: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
