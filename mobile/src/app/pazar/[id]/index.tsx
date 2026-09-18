import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, Modal, Platform, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CATEGORIES } from '@/data/sample';
import { useMarkets } from '@/lib/markets-context';
import { useCart } from '@/lib/cart-context';
import { fetchProducts } from '@/lib/products';
import { fetchSettings, type StoreSettings } from '@/lib/settings';
import { fetchCatalogConfig, type CatalogConfig } from '@/lib/catalog';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { IconGreen, Spacing, withAlpha } from '@/constants/theme';
import type { IoniconName } from '@/components/icon-badge';
import type { Product, SelectedOption } from '@/lib/types';

const NONE_LABEL = 'İstemiyorum';

const DISCOUNT_SECTION_KEY = '__indirimli';

// Pazar sepeti logosu: koyu temada yeşil çerçeveli, açık temada turuncu
// çerçeveli sürüm — kullanıcının gönderdiği görseller.
const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

// Kart zemini NÖTR (siyahımsı/beyazımsı) — eski sitedeki gibi; aksan rengi
// (yeşil/turuncu) sadece kenarlıkta kalıyor, zemine yeşil ton karışmıyor.
const CARD_BG_DARK = 'rgba(10, 12, 11, 0.78)';
const CARD_BG_LIGHT = 'rgba(255, 255, 255, 0.82)';
// Bilgi etiketleri + kategori panelinin zemini — kartlardan farklı olarak
// AÇIK TONDA ve daha şeffaf (koyu temada bile neredeyse siyah olmasın).
const OVERLAY_BG_DARK = 'rgba(50, 55, 53, 0.55)';
const OVERLAY_BG_LIGHT = 'rgba(255, 255, 255, 0.55)';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type ProductSection = { title: string; key: string; parentMain: string; data: Product[][] };

export default function MarketProductsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  // Gerçek sitede "Tümü" filtresi yok — tüm ürünler hep tek bir uzun listede
  // açık duruyor; kategori/alt kategoriye dokununca liste o bölüme kayıyor,
  // kaydırdıkça da hangi bölümdeysen o kategori aktif (yeşil) yanıyor.
  const [activeMain, setActiveMain] = useState<string>('');
  const [activeSub, setActiveSub] = useState<string>('');
  const { markets, loading: marketsLoading, refetch: refetchMarkets } = useMarkets();
  const market = markets.find((m) => m.id === id);

  // Ürünler artık GLOBAL listeden değil, bu pazara özel çekiliyor — backend
  // /api/products?market=... sadece o pazara atanmış tedarikçilerin ürünlerini
  // döner (bkz. catalog_config.supplier_markets), böylece her pazarda farklı
  // ürün seti görünür.
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!market) return;
    let cancelled = false;
    setLoading(true);
    fetchProducts(market.name).then((result) => {
      if (cancelled) return;
      setAllProducts(result.products);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [market?.name]);

  // Bazı durumlarda (ör. ekran, pazar listesi backend'den henüz gelmeden
  // ilk kez açıldığında) pazar bulunamıyor ve isim boş kalıyordu, tekrar
  // girip çıkınca düzeliyordu. Burada bulunamazsa listeyi BİR KEZ otomatik
  // tazele (sonsuz döngüye girmesin diye tekrar denemiyoruz).
  const retriedMarkets = useRef(false);
  useEffect(() => {
    if (!market && !marketsLoading && id && !retriedMarkets.current) {
      retriedMarkets.current = true;
      refetchMarkets();
    }
  }, [market, marketsLoading, id]);
  const [settings, setSettings] = useState<StoreSettings>({});
  const [catalog, setCatalog] = useState<CatalogConfig>({});
  const sectionListRef = useRef<SectionList<Product[], ProductSection>>(null);
  const { lines, totalQty, totalPrice } = useCart();
  const insets = useSafeAreaInsets();
  // Özelleştirmesi (Boyut/Şekil vb.) olan bir üründe "Seç" butonuna
  // basılınca bu ürün için seçim modalı açılır.
  const [optionsProduct, setOptionsProduct] = useState<Product | null>(null);

  // Aşağı kaydırınca "Pazar saati/Gel-Al saati" bilgi şeridi yukarı kayıp
  // kayboluyor, yukarı kaydırınca geri geliyor — bkz. hedef site.
  const [pillsVisible, setPillsVisible] = useState(true);
  const pillsAnim = useRef(new Animated.Value(1)).current;
  const lastScrollY = useRef(0);

  useEffect(() => {
    Animated.timing(pillsAnim, { toValue: pillsVisible ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [pillsVisible, pillsAnim]);

  function handleListScroll(e: { nativeEvent: { contentOffset: { y: number } } }) {
    const y = e.nativeEvent.contentOffset.y;
    const delta = y - lastScrollY.current;
    if (y <= 10) setPillsVisible(true);
    else if (delta > 6) setPillsVisible(false);
    else if (delta < -6) setPillsVisible(true);
    lastScrollY.current = y;
  }

  useEffect(() => {
    fetchSettings().then(setSettings);
    fetchCatalogConfig().then(setCatalog);
  }, []);

  // Ana kategori → alt kategori ağacı admin panelinden geliyor
  // (backend/services/catalog.py, /api/catalog-config). Gelmezse/boşsa
  // eski düz (tek seviyeli) kategori listesine geri dönüyoruz.
  const hasCategoryTree = !!(catalog.categories?.length && catalog.subcategories);

  const infoItems = useMemo(() => {
    const items: { key: string; icon: IoniconName; label: string }[] = [
      { key: 'market_hours', icon: 'storefront-outline', label: `Pazar saati: ${settings.market_hours ?? '00:00-22:00'}` },
      { key: 'pickup_hours', icon: 'time-outline', label: `Gel-Al saati: ${settings.pickup_order_hours ?? '11:00-19:00'}` },
    ];
    if (settings.free_delivery_min_amount) {
      items.push({
        key: 'free_delivery',
        icon: 'gift-outline',
        label: `${settings.free_delivery_min_amount.toFixed(0)}₺ üzeri ücretsiz teslimat`,
      });
    }
    if (settings.min_pickup_amount) {
      items.push({
        key: 'min_amount',
        icon: 'receipt-outline',
        label: `Minimum sepet tutarı: ${settings.min_pickup_amount.toFixed(0)}₺`,
      });
    }
    return items;
  }, [settings]);

  // Ürünler hiç filtrelenmiyor — kategori sırasına göre BÖLÜMLERE ayrılıyor.
  const sections = useMemo<ProductSection[]>(() => {
    const result: ProductSection[] = [];
    // "İndirimli" bölümü, sadece hem indirim yüzdesi HEM minimum miktar
    // dolu olan ürün varsa açılıyor (kullanıcı talimatı) — biri eksikse o
    // ürün indirimli sayılmıyor, hiçbiri yoksa bölüm hiç görünmüyor.
    const discounted = allProducts.filter((p) => !!p.campaign_discount_percent && !!p.campaign_min_qty);
    if (discounted.length) {
      result.push({ title: 'Çok al az öde', key: DISCOUNT_SECTION_KEY, parentMain: 'İndirimli', data: chunk(discounted, 2) });
    }
    if (hasCategoryTree) {
      for (const main of catalog.categories!) {
        for (const sub of catalog.subcategories?.[main] ?? []) {
          // "Diğer" gibi alt kategori isimleri birden fazla ana kategoride
          // tekrar edebiliyor — sadece alt kategoriye (category) değil, ana
          // kategoriye (subcategory) göre de eşleştirmezsek aynı ürün her
          // ana kategoride tekrar tekrar görünür (bkz. "Limon" iki kez
          // çıkması ve React'in "duplicate key" uyarısı).
          const items = allProducts.filter((p) => p.category === sub && p.subcategory === main);
          if (items.length) result.push({ title: sub, key: `${main}::${sub}`, parentMain: main, data: chunk(items, 2) });
        }
      }
    } else {
      for (const cat of CATEGORIES) {
        const items = allProducts.filter((p) => p.category === cat);
        if (items.length) result.push({ title: cat, key: cat, parentMain: cat, data: chunk(items, 2) });
      }
    }
    return result;
  }, [allProducts, hasCategoryTree, catalog]);

  // Sadece şu an gerçekten ürünü OLAN ana/alt kategoriler ve "İndirimli"
  // gösteriliyor — boş kategoriler için tıklanacak bir çip olmasın.
  const rawMainOptions = hasCategoryTree ? catalog.categories! : CATEGORIES;
  const mainOptions = rawMainOptions.filter((m) => sections.some((s) => s.parentMain === m));
  const hasDiscount = sections.some((s) => s.key === DISCOUNT_SECTION_KEY);
  const subOptions =
    hasCategoryTree && activeMain && activeMain !== 'İndirimli'
      ? (catalog.subcategories![activeMain] ?? []).filter((sub) =>
          sections.some((s) => s.parentMain === activeMain && s.title === sub)
        )
      : [];

  function scrollToSectionIndex(index: number) {
    if (index < 0) return;
    sectionListRef.current?.scrollToLocation({ sectionIndex: index, itemIndex: 0, viewPosition: 0, animated: true });
  }

  function selectMain(item: string) {
    setActiveMain(item);
    setActiveSub('');
    const idx =
      item === 'İndirimli'
        ? sections.findIndex((s) => s.key === DISCOUNT_SECTION_KEY)
        : sections.findIndex((s) => s.parentMain === item);
    scrollToSectionIndex(idx);
  }

  function selectSub(item: string) {
    setActiveSub(item);
    scrollToSectionIndex(sections.findIndex((s) => s.parentMain === activeMain && s.title === item));
  }

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { section?: ProductSection }[] }) => {
    const top = viewableItems.find((v) => v.section)?.section;
    if (!top) return;
    setActiveMain(top.parentMain);
    setActiveSub(top.key === DISCOUNT_SECTION_KEY ? '' : top.title);
  }).current;

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.replace('/')} hitSlop={12} style={styles.backBtn}>
            <ThemedText style={styles.backArrow}>←</ThemedText>
          </Pressable>
          <View style={[styles.flex, styles.headerTitleRow]}>
            <ThemedText type="smallBold" style={styles.headerTitle}>
              Pazar
            </ThemedText>
            {market && (
              <ThemedText themeColor="tint" type="small" numberOfLines={1} style={[styles.flex, styles.headerMarketName]}>
                · {market.name.replace(/\s*pazar[ıi]?\s*$/i, '')}
              </ThemedText>
            )}
          </View>
          <Image
            source={scheme === 'dark' ? MARKET_LOGO_DARK : MARKET_LOGO_LIGHT}
            style={styles.logoBadge}
            resizeMode="contain"
          />
        </View>
      </View>

      <Animated.View
        style={{
          height: pillsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 44] }),
          opacity: pillsAnim,
          overflow: 'hidden',
        }}
      >
        <FlatList
          horizontal
          style={styles.infoList}
          showsHorizontalScrollIndicator={false}
          data={infoItems}
          keyExtractor={(t) => t.key}
          contentContainerStyle={styles.infoRow}
          renderItem={({ item }) => (
            <View style={[styles.infoPill, { backgroundColor: scheme === 'dark' ? OVERLAY_BG_DARK : OVERLAY_BG_LIGHT, borderColor: theme.tint }]}>
              <Ionicons name={item.icon} size={15} color={IconGreen} />
              <ThemedText type="small" numberOfLines={1}>
                {item.label}
              </ThemedText>
            </View>
          )}
        />
      </Animated.View>

      {/* Kategori/alt kategori satırları artık ürün listesinin ÜSTÜNDE yüzen,
          buzlu-cam (yarı saydam + blur) bir panel — altından kaydırılan
          ürünler bulanık şekilde seçiliyor (kullanıcının işaretlediği
          bölge). "Ürünler" başlığı ve bilgi etiketleri bundan etkilenmiyor,
          normal akışta kalıyor. */}
      <View style={styles.listArea}>
        <SectionList
          ref={sectionListRef}
          style={styles.flex}
          sections={loading ? [] : sections}
          keyExtractor={(row, index) =>
            Array.isArray(row) ? `${row.map((p) => p.id).join('-')}-${index}` : `row-${index}`
          }
          stickySectionHeadersEnabled={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          renderSectionHeader={({ section }) => (
            <View
              style={[
                styles.sectionHeader,
                { backgroundColor: withAlpha(theme.backgroundElement, 0.6), borderColor: theme.tint },
              ]}
            >
              {section.key === DISCOUNT_SECTION_KEY && (
                <Ionicons name="pricetag-outline" size={21} color={IconGreen} style={styles.sectionHeaderIcon} />
              )}
              <ThemedText type="smallBold">{section.title}</ThemedText>
            </View>
          )}
          renderItem={({ item: row }) =>
            Array.isArray(row) ? (
              <View style={styles.row}>
                {row.map((product) => (
                  <ProductCard key={product.id} product={product} onSelect={() => setOptionsProduct(product)} />
                ))}
                {row.length === 1 && <View style={styles.flex} />}
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.grid,
            { paddingTop: (subOptions.length > 0 ? 88 : 48) + Spacing.two },
          ]}
          ListEmptyComponent={
            <View style={[styles.emptyBox, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText themeColor="textSecondary">{loading ? 'Yükleniyor…' : 'Ürün yok.'}</ThemedText>
            </View>
          }
        />

        <View
          style={[
            styles.categoryOverlay,
            { backgroundColor: scheme === 'dark' ? OVERLAY_BG_DARK : OVERLAY_BG_LIGHT },
          ]}
        >
          <FlatList
            horizontal
            style={styles.chipList}
            showsHorizontalScrollIndicator={false}
            data={[...(hasDiscount ? ['İndirimli'] : []), ...mainOptions]}
            keyExtractor={(c) => c}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item }) => {
              const active = item === activeMain;
              return (
                <Pressable
                  onPress={() => selectMain(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.tint : theme.border,
                      backgroundColor: active ? theme.tint : (scheme === 'dark' ? OVERLAY_BG_DARK : OVERLAY_BG_LIGHT),
                    },
                  ]}
                >
                  {item === 'İndirimli' && (
                    <Ionicons name="pricetag" size={14} color={active ? '#fff' : theme.tint} style={styles.chipIcon} />
                  )}
                  <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                    {item}
                  </ThemedText>
                </Pressable>
              );
            }}
          />

          {subOptions.length > 0 && (
            <FlatList
              horizontal
              style={styles.subChipList}
              showsHorizontalScrollIndicator={false}
              data={subOptions}
              keyExtractor={(c) => c}
              contentContainerStyle={styles.chipRow}
              renderItem={({ item }) => {
                const active = item === activeSub;
                return (
                  <Pressable
                    onPress={() => selectSub(item)}
                    style={[
                      styles.subChip,
                      {
                        borderColor: active ? theme.tint : theme.border,
                        backgroundColor: active ? theme.tint : (scheme === 'dark' ? OVERLAY_BG_DARK : OVERLAY_BG_LIGHT),
                      },
                    ]}
                  >
                    <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                      {item}
                    </ThemedText>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>

      {/* Sepette ürün varken, alt menünün hemen üstünde yüzen "Siparişi
          Tamamla" çubuğu — hedef sitedeki gibi her zaman yeşil, buzlu-cam
          (yarı saydam + web'de blur). Altında, minimum sepet tutarına ve
          ücretsiz teslimata ne kadar kaldığını gösteren aşamalı bir satır
          var. */}
      {totalQty > 0 && (() => {
        const minAmount = settings.min_pickup_amount ?? 0;
        const freeAmount = settings.free_delivery_min_amount;
        let progressMsg: string | null = null;
        let progressDone = false;
        if (minAmount > 0 && totalPrice < minAmount) {
          progressMsg = `Minimum sepet tutarı için ₺${(minAmount - totalPrice).toFixed(2)} daha ekleyin`;
        } else if (freeAmount && totalPrice < freeAmount) {
          progressMsg = `Ücretsiz teslimat için ₺${(freeAmount - totalPrice).toFixed(2)} daha ekleyin`;
        } else if (freeAmount && totalPrice >= freeAmount) {
          progressMsg = 'Ücretsiz teslimat';
          progressDone = true;
        }
        return (
          <Pressable
            onPress={() => router.push(`/pazar/${id}/sepet`)}
            style={[
              styles.confirmBar,
              {
                bottom: Spacing.three + insets.bottom + 60 + Spacing.two,
                backgroundColor: withAlpha('#14B67E', 0.75),
                borderWidth: 1,
                borderColor: withAlpha('#14B67E', 0.9),
              },
              Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(1.3)' } as any) : null,
            ]}
          >
            <View style={styles.confirmIconWrap}>
              <Ionicons name="basket" size={22} color="#fff" />
              <View style={[styles.confirmBadge, { backgroundColor: theme.danger }]}>
                <ThemedText style={styles.confirmBadgeText}>{lines.length}</ThemedText>
              </View>
            </View>
            <View style={styles.confirmMiddle}>
              <ThemedText style={styles.confirmText} numberOfLines={1}>
                Siparişi Tamamla
              </ThemedText>
              {progressMsg && (
                <View style={styles.confirmProgressRow}>
                  {progressDone && <Ionicons name="checkmark-circle" size={12} color="#fff" />}
                  <ThemedText style={styles.confirmProgress} numberOfLines={1}>
                    {progressMsg}
                  </ThemedText>
                </View>
              )}
            </View>
            <ThemedText style={styles.confirmPrice}>{totalPrice.toFixed(2)} ₺</ThemedText>
          </Pressable>
        );
      })()}

      <ProductOptionsModal product={optionsProduct} onClose={() => setOptionsProduct(null)} />
    </Screen>
  );
}

/** Özelleştirmesi (Boyut/Şekil vb.) olan bir ürün için "Seç"e basılınca
 *  açılan alttan kayan seçim ekranı — tam sayfa ürün detayı yerine bu. */
function ProductOptionsModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { addItem } = useCart();
  const [qty, setLocalQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});

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
              addItem(product, qty, selectedOptions);
              onClose();
            }}
          >
            <ThemedText style={{ color: '#fff' }} type="smallBold" numberOfLines={1}>
              Sepete Ekle · ₺{total.toFixed(2)}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ProductCard({ product, onSelect }: { product: Product; onSelect: () => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const { lines, addItem, setQty } = useCart();
  const hasOptions = !!product.customization_options?.length;
  // Kartın hızlı "Ekle"si her zaman özelleştirmesiz (varsayılan) satırı
  // hedefler — bu satırın id'si ürünün kendi id'sidir (bkz. cart-context).
  const qty = lines.find((l) => l.lineId === product.id)?.qty ?? 0;
  const outOfStock = !product.in_stock;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.image_url && !imageFailed;

  // "Ekle"ye basılınca miktar seçici satırı yavaşça kayarak/açılarak
  // görünüyor (ani sıçrama yok). Her kartın kendi animasyon durumu var.
  const qtyRowAnim = useRef(new Animated.Value(qty > 0 ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(qtyRowAnim, {
      toValue: qty > 0 ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [qty > 0]);
  // Buzlu cam kart: yarı saydam NÖTR zemin + (web'de) arkadan duvar
  // kağıdının bulanık görünmesi için backdrop-filter — bkz. DESIGN-BRIEF.md
  // 4. madde. Zemin eski sitedeki gibi siyahımsı/beyazımsı, aksan rengi
  // (yeşil/turuncu) sadece kenarlıkta.
  const glassStyle: any =
    Platform.OS === 'web' ? { backdropFilter: 'blur(14px) saturate(1.3)' } : null;
  return (
    <View
      style={[
        styles.card,
        glassStyle,
        { backgroundColor: scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT, borderColor: theme.tint },
      ]}
    >
      <View style={[styles.cardImageWrap, { backgroundColor: theme.tintSoft }]}>
        {showImage ? (
          <Image
            source={{ uri: product.image_url! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Ionicons name="leaf-outline" size={54} color={IconGreen} />
        )}
        {outOfStock && (
          <View style={styles.outOfStockBadge}>
            <ThemedText type="small" style={styles.badgeText}>
              Stokta yok
            </ThemedText>
          </View>
        )}
        {/* Özelleştirmesi olan ürünler için resmin üzerinde yeşil "Seç"
            rozeti — kullanıcı daha dokunmadan seçim gerektiğini görüyor. */}
        {hasOptions && (
          <View style={styles.selectBadge}>
            <ThemedText type="small" style={styles.selectBadgeText}>
              Seç
            </ThemedText>
          </View>
        )}
      </View>
      {!!product.campaign_discount_percent && !!product.campaign_min_qty && (
        <View style={[styles.discountBadge, { backgroundColor: theme.accentOrange }]}>
          <ThemedText type="small" style={styles.discountBadgeText}>
            %{product.campaign_discount_percent}
          </ThemedText>
        </View>
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={[styles.cardTitle, styles.cardTitleBig]}>
        {product.name}
      </ThemedText>
      {!!product.campaign_discount_percent && !!product.campaign_min_qty && (
        <ThemedText themeColor="tint" type="small" numberOfLines={1} style={styles.campaignLine}>
          {product.campaign_min_qty} {formatUnit(product.unit)} ve üzeri %{product.campaign_discount_percent}
        </ThemedText>
      )}
      <View style={styles.priceEkleRow}>
        <ThemedText themeColor="tint" type="smallBold" style={styles.cardPriceBig}>
          {product.gel_al_price ? `₺${product.gel_al_price.toFixed(2)}` : 'Fiyat yok'}
          <ThemedText themeColor="textSecondary" type="small">
            {' '}
            / {formatUnit(product.unit)}
          </ThemedText>
        </ThemedText>
        {!outOfStock && hasOptions && (
          <Pressable onPress={onSelect} hitSlop={6} style={[styles.addBtnCompact, { backgroundColor: theme.tint }]}>
            <Ionicons name="options-outline" size={14} color="#fff" style={styles.chipIcon} />
            <ThemedText style={styles.addBtnText}>Seç</ThemedText>
          </Pressable>
        )}
        {!outOfStock && !hasOptions && qty === 0 && (
          <Pressable
            onPress={() => addItem(product, qtyStep(product.unit))}
            hitSlop={6}
            style={[styles.addBtnCompact, { backgroundColor: theme.tint }]}
          >
            <Ionicons name="cart-outline" size={14} color="#fff" style={styles.chipIcon} />
            <ThemedText style={styles.addBtnText}>Ekle</ThemedText>
          </Pressable>
        )}
      </View>

      {/* "Ekle"ye basılınca "Ekle" kayboluyor, yerine miktar seçici yavaşça
          kayarak/açılarak beliriyor. Özelleştirmesi olan ürünlerde miktar
          modalda seçildiği için burada gösterilmiyor. */}
      {!outOfStock && !hasOptions && (
        <Animated.View
          style={{
            overflow: 'hidden',
            height: qtyRowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 48] }),
            opacity: qtyRowAnim,
            transform: [{ translateY: qtyRowAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
          }}
        >
          <View style={[styles.cardDivider, { backgroundColor: theme.border }]} />
          <View style={styles.qtyRowFull}>
            <Pressable
              onPress={() => setQty(product.id, qty - qtyStep(product.unit))}
              hitSlop={6}
              style={[styles.qtyBtn, { backgroundColor: theme.tint }]}
            >
              <Ionicons name="remove" size={22} color="#fff" />
            </Pressable>
            <ThemedText type="smallBold" style={styles.qtyValue}>
              {formatQty(qty, product.unit)}
            </ThemedText>
            <Pressable
              onPress={() => setQty(product.id, qty + qtyStep(product.unit))}
              hitSlop={6}
              style={[styles.qtyBtn, { backgroundColor: theme.tint }]}
            >
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingVertical: 2, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  headerTitle: { fontSize: 18 },
  headerMarketName: { fontSize: 15 },
  logoBadge: { width: 60, height: 60 },
  infoList: { flexGrow: 0, flexShrink: 0, height: 34, marginTop: Spacing.two },
  infoRow: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 9,
    paddingHorizontal: Spacing.two - 2,
    height: 30,
    justifyContent: 'center',
    borderWidth: 1,
  },
  listArea: { flex: 1, position: 'relative' },
  categoryOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  chipList: { flexGrow: 0, flexShrink: 0, height: 48 },
  chipRow: { paddingHorizontal: Spacing.three, gap: Spacing.two, alignItems: 'center', height: 48 },
  chip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    height: 36,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIcon: { marginRight: 4 },
  subChipList: { flexGrow: 0, flexShrink: 0, height: 40 },
  subChip: {
    paddingHorizontal: Spacing.two,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bölüm başlığı bandı — DESIGN-BRIEF.md'de "henüz uygulanmadı" diye
  // işaretli hedef efektlerden biri (buzlu-cam + ince aksan kenarlık).
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  sectionHeaderIcon: { marginRight: 6 },
  grid: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, paddingBottom: Spacing.six + Spacing.six },
  // alignItems:'flex-start' olmazsa varsayılan 'stretch' iki kartı da
  // birbirine eşit yüksekliğe zorluyor — bir kartın miktar satırı açılınca
  // yanındaki de aynı boyda görünüyordu. Artık her kart kendi yüksekliğinde.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  card: { flex: 1, borderRadius: 16, borderWidth: 1.5, padding: Spacing.two, paddingBottom: Spacing.two + 4, gap: 6 },
  cardImageWrap: { height: 130, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardTitle: { marginTop: 4 },
  cardTitleBig: { fontSize: 16, lineHeight: 20 },
  cardPriceBig: { fontSize: 19 },
  campaignLine: { fontWeight: '700' },
  // Fiyat + "Ekle" aynı satırda; "Ekle"ye basılınca aşağıda miktar seçici
  // açılıyor, bu ayraç sadece o zaman (fiyat satırıyla arasında) görünüyor.
  priceEkleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cardDivider: { height: 1, marginVertical: 2, opacity: 0.5 },
  badgeText: { color: '#fff', fontWeight: '700' },
  outOfStockBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingVertical: 3, alignItems: 'center',
  },
  // Görsel köşesine binen yuvarlak indirim rozeti (kartın kendisine, resim
  // katmanının üstüne bindirilmiş — bkz. hedef site tasarımı).
  discountBadge: {
    position: 'absolute', top: Spacing.one, right: Spacing.one,
    minWidth: 30, height: 22, borderRadius: 11, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  discountBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  addBtnCompact: {
    flexDirection: 'row',
    borderRadius: 999,
    height: 32,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Kartın kendi üzerinde miktar seçici — sepete eklendikten sonra "Ekle"
  // butonunun yerini alıyor (hedef sitedeki gibi). Parmakla rahat
  // dokunulabilsin diye butonlar en az ~32dp. Fiyat satırından ayrı, ince
  // bir çizgiyle bölünmüş kendi (tam genişlik) satırında duruyor.
  qtyRowFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 },
  qtyBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { minWidth: 24, textAlign: 'center' },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.two },
  // Sepette ürün varken alt menünün hemen üstünde yüzen onay çubuğu.
  confirmBar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  // İkon + sayı rozeti tek bir bütün gibi görünüyor (rozet ikonun köşesine
  // biniyor) — alt menüdeki sepet ikonuyla aynı mantık. İkon/rozet boyutu
  // sabit kalıyor, sadece çubuğun dikey boşluğu sıkıştırılıyor.
  confirmIconWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  confirmBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  // Başlık + ilerleme satırı, ikon ile fiyat arasında ortalanmış sütun —
  // ikisi arasındaki boşluk sıfıra indirildi (metin boyutları aynı kaldı).
  confirmMiddle: { flex: 1, gap: 0 },
  confirmText: { color: '#fff', fontWeight: '700' },
  confirmPrice: { color: '#fff', fontWeight: '700', fontSize: 20 },
  // Minimum sepet tutarı / ücretsiz teslimat için kalan tutar aşamalı satırı.
  confirmProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  confirmProgress: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  // Özelleştirmesi olan ürünün resminde duran yeşil "Seç" rozeti.
  selectBadge: {
    position: 'absolute', top: Spacing.one, left: Spacing.one,
    backgroundColor: '#14B67E', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  selectBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  // "Seç" seçim modalı — alttan kayan sayfa (bottom sheet).
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
  addBtnFull: { flex: 1, borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center' },
});
