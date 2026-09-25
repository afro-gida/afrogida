import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, Platform, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CART_BAR_COLLAPSED_SCALE,
  chromeCollapsed,
  setChromeCollapsed,
  showChrome,
  TAB_BAR_COLLAPSED_BOTTOM,
  TAB_BAR_COLLAPSED_SCALE,
} from '@/lib/chrome-autohide';

// Alt menünün yüksekliği (bkz. pazar/[id]/_layout.tsx CustomTabBar) ve menü
// küçülünce arkasındaki sepet çubuğunun üstten görünen payı.
const TAB_BAR_HEIGHT = 60;
const CART_PEEK = 20;
// Katlanan başlık + bilgi şeridi ~135 px. Kaydırılabilir mesafe bundan
// rahatça büyük değilse katlama yok (katlanınca içerik sığar, konum 0'a
// düşer, başlık açılır... döngü). En alttaki bu bölgede de yukarı "kayma"
// başlığı açmaz (katlanmanın yarattığı geri çekilme sanılmasın).
const COLLAPSE_MIN_SCROLL = 280;
// Kategori paneli ölçüleri (ana / alt kategori düğmesi yüksekliği, panel içi boşluk).
const CHIP_H = 30;
const SUB_CHIP_H = 26;
const CAT_GAP = 6;
// Bilgi kutuları (Pazar saati / Gel-Al saati) ile kategori paneli arası.
const INFO_GAP = 6;
const COLLAPSE_BOTTOM_ZONE = 180;
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CATEGORIES } from '@/data/sample';
import { useMarkets } from '@/lib/markets-context';
import { useCart } from '@/lib/cart-context';
import { fetchProducts } from '@/lib/products';
import { ProductOptionsModal } from '@/components/product-options-modal';
import { fetchSettings, withMarketSettings, type StoreSettings } from '@/lib/settings';
import { fetchCatalogConfig, type CatalogConfig } from '@/lib/catalog';
import { qtyStep, formatQty, formatUnit } from '@/lib/units';
import { formatMoney } from '@/lib/format';
import { Spacing, withAlpha } from '@/constants/theme';
import type { IoniconName } from '@/components/icon-badge';
import type { Product } from '@/lib/types';

const DISCOUNT_SECTION_KEY = '__indirimli';

// Pazar sepeti logosu: koyu temada yeşil çerçeveli, açık temada turuncu
// çerçeveli sürüm — kullanıcının gönderdiği görseller.
const MARKET_LOGO_DARK = require('@/assets/brand/market-logo-dark.png');
const MARKET_LOGO_LIGHT = require('@/assets/brand/market-logo-light.png');

// Kart zemini NÖTR (siyahımsı/beyazımsı) — eski sitedeki gibi; aksan rengi
// (yeşil/turuncu) sadece kenarlıkta kalıyor, zemine yeşil ton karışmıyor.
const CARD_BG_DARK = '#0e1411';
const CARD_BG_LIGHT = '#f8ebd6';
const CARD_IMAGE_HEIGHT = 128;
// Bilgi etiketleri + kategori panelinin zemini — kartlardan farklı olarak
// AÇIK TONDA ve daha şeffaf (koyu temada bile neredeyse siyah olmasın).
const OVERLAY_BG_DARK = 'rgba(22, 28, 25, 0.94)';
const OVERLAY_BG_LIGHT = 'rgba(241, 222, 190, 0.96)';
// Ürün listesinin arkasına hafif perde: desenli duvar kağıdı kenarlarda
// seçilmeye devam etsin ama başlıklar/yazılar üstünde net okunsun.
const LIST_SCRIM_DARK = 'rgba(0, 0, 0, 0.55)';
const LIST_SCRIM_LIGHT = 'rgba(232, 201, 158, 0.32)';

// Her alt kategori TEK bir satırdır: ürünler o satırda YANA kayar
// (Yemeksepeti / Uber Eats tarzı). SectionList'in her bölümünde tek "item"
// var — o bölümün tüm ürünleri; bölüm içi yatay liste bunu çizer.
type ProductSection = { title: string; key: string; parentMain: string; data: Product[][] };

// Yatay satırdaki kart genişliği: bir sonraki kartın kenardan biraz görünmesi
// ("yana kaydırılabilir" ipucu) için ekrana tam 2 kart sığmayacak şekilde.
const CARD_WIDTH = 164;

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
  // "market" sadece EŞLEŞME BULUNDUĞUNDA güncellenir, bulunamayınca eski
  // değerini korur. `markets.find(...)` doğrudan kullanılsaydı, `markets`
  // listesi ekran açıkken herhangi bir sebeple anlık olarak farklı bir
  // referansla yeniden render tetiklediğinde (ör. context'teki başka bir
  // güncelleme) `id` bir an için eşleşmeyebiliyor ve pazar bilgisi/ürün
  // listesi sıfırlanıp ekran "Yükleniyor…" durumunda takılı kalıyordu
  // (kullanıcı talimatıyla bulunan hata: "sayfada gezince pazar infosu
  // sıfırlanıyor"). Gerçekten FARKLI bir pazara geçildiğinde (id değişince)
  // ekran zaten yeniden mount olur ve bu state taze başlar.
  const [market, setMarket] = useState(() => markets.find((m) => m.id === id));
  useEffect(() => {
    const found = markets.find((m) => m.id === id);
    if (found) setMarket(found);
  }, [markets, id]);

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
  }, [market?.id]);

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
  const [globalSettings, setGlobalSettings] = useState<StoreSettings>({});
  const settings = useMemo(() => withMarketSettings(globalSettings, market), [globalSettings, market]);
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

  // Başlığın katlanması liste alanının boyunu değiştirir; en alttayken bu,
  // kaydırma konumunun geri çekilmesine (yukarı kaydırma gibi görünür) ->
  // başlığın tekrar açılmasına -> tekrar katlanmasına yol açıp ekranı
  // titretiyordu. iOS'un en alttaki esnemesi (bounce) de aynı etkiyi
  // yapıyordu. Korumalar: esneme bölgesindeki olaylar yok sayılır, her
  // geçişten sonra animasyon bitene kadar yeni geçiş yok, en alt bölgede
  // sadece gerçek yukarı kaydırma açar, kısa içerikte hiç katlanmaz.
  const collapsedRef = useRef(false);
  const toggleLockUntil = useRef(0);

  function handleListScroll(e: {
    nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } };
  }) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    const maxY = contentSize.height - layoutMeasurement.height;
    const delta = y - lastScrollY.current;
    lastScrollY.current = y;

    if (y < 0 || y > maxY) return; // iOS esnemesi
    const now = Date.now();
    if (now < toggleLockUntil.current) return;

    let next = collapsedRef.current;
    if (y <= 10) next = false;
    else if (delta > 6 && maxY > COLLAPSE_MIN_SCROLL) next = true;
    else if (delta < -6 && maxY - y > COLLAPSE_BOTTOM_ZONE) next = false;
    if (next === collapsedRef.current) return;

    collapsedRef.current = next;
    toggleLockUntil.current = now + 450;
    setPillsVisible(!next);
    setChromeCollapsed(next);
  }

  useEffect(() => {
    showChrome();
    collapsedRef.current = false;
  }, []);

  useEffect(() => {
    fetchSettings().then(setGlobalSettings);
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
      result.push({ title: 'Çok al az öde', key: DISCOUNT_SECTION_KEY, parentMain: 'İndirimli', data: [discounted] });
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
          if (items.length) result.push({ title: sub, key: `${main}::${sub}`, parentMain: main, data: [items] });
        }
      }
    } else {
      for (const cat of CATEGORIES) {
        const items = allProducts.filter((p) => p.category === cat);
        if (items.length) result.push({ title: cat, key: cat, parentMain: cat, data: [items] });
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

  // Çipe dokunulunca liste o bölüme kayarken, kaydırma sırasındaki görünürlük
  // güncellemeleri seçilen çipi geri değiştirmesin (son bölümler ekranın en
  // üstüne kadar kayamayabiliyor).
  const chipLockUntil = useRef(0);

  function scrollToSectionIndex(index: number) {
    if (index < 0) return;
    chipLockUntil.current = Date.now() + 900;
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
    if (Date.now() < chipLockUntil.current) return;
    const top = viewableItems.find((v) => v.section)?.section;
    if (!top) return;
    setActiveMain(top.parentMain);
    setActiveSub(top.key === DISCOUNT_SECTION_KEY ? '' : top.title);
  }).current;

  return (
    <Screen edges={['bottom']}>
      {/* Aşağı kaydırınca pazar başlığı da bilgi şeridiyle birlikte katlanır;
          ekranda sadece kategori şeridi + ürünler kalır (tam ekran hissi). */}
      <Animated.View
        style={{
          maxHeight: pillsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 90] }),
          opacity: pillsAnim,
          overflow: 'hidden',
        }}
      >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.replace('/')} hitSlop={12} style={styles.backBtn} accessibilityLabel="Pazarlara dön">
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <View style={styles.flex}>
            <ThemedText numberOfLines={1} style={styles.headerTitle}>
              {market ? market.name.replace(/\s*pazar[ıi]?\s*$/i, '') : 'Pazar'}
            </ThemedText>
            {!!market?.day && (
              <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
                {market.day} pazarı
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
      </Animated.View>

      <Animated.View
        style={{
          height: pillsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 38 + INFO_GAP] }),
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
            <View style={[styles.infoPill, { backgroundColor: scheme === 'dark' ? OVERLAY_BG_DARK : OVERLAY_BG_LIGHT }]}>
              <Ionicons name={item.icon} size={15} color={theme.tint} />
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
      <View style={[styles.listArea, { backgroundColor: scheme === 'dark' ? LIST_SCRIM_DARK : LIST_SCRIM_LIGHT }]}>
        <SectionList
          ref={sectionListRef}
          style={styles.flex}
          sections={loading ? [] : sections}
          keyExtractor={(row, index) =>
            Array.isArray(row) ? `${row.map((p) => p.id).join('-')}-${index}` : `row-${index}`
          }
          stickySectionHeadersEnabled={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              {section.key === DISCOUNT_SECTION_KEY && (
                <Ionicons name="pricetag" size={18} color={theme.tint} style={styles.sectionHeaderIcon} />
              )}
              <ThemedText style={[styles.flex, styles.sectionTitle]}>{section.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {section.data[0]?.length ?? 0} ürün
              </ThemedText>
            </View>
          )}
          renderItem={({ item: row }) =>
            Array.isArray(row) ? (
              <FlatList
                horizontal
                data={row}
                keyExtractor={(p) => p.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hRow}
                initialNumToRender={4}
                windowSize={3}
                renderItem={({ item: product }) => (
                  <ProductCard product={product} onSelect={() => setOptionsProduct(product)} />
                )}
              />
            ) : null
          }
          contentContainerStyle={[
            styles.grid,
            {
              paddingTop:
                CAT_GAP + CHIP_H + CAT_GAP + (subOptions.length > 0 ? SUB_CHIP_H + CAT_GAP : 0) + Spacing.two,
            },
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
                                            backgroundColor: active ? theme.tint : theme.backgroundSelected,
                    },
                  ]}
                >
                  {item === 'İndirimli' && (
                    <Ionicons name="pricetag" size={12} color={active ? '#fff' : theme.tint} style={styles.chipIcon} />
                  )}
                  <ThemedText style={[styles.chipText, { color: active ? '#fff' : theme.text }]}>
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
                                                backgroundColor: active ? theme.tint : theme.backgroundSelected,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.subChipText, { color: active ? '#fff' : theme.text }]}>
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
      {totalQty > 0 && (
        <CartBar
          count={lines.length}
          total={totalPrice}
          minAmount={settings.min_pickup_amount ?? 0}
          freeAmount={settings.free_delivery_min_amount}
          bottomInset={insets.bottom}
          onPress={() => router.push(`/pazar/${id}/sepet`)}
        />
      )}

      <ProductOptionsModal product={optionsProduct} onClose={() => setOptionsProduct(null)} />
    </Screen>
  );
}

function ProductCard({ product, onSelect }: { product: Product; onSelect: () => void }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const { lines, addItem, setQty } = useCart();
  const hasOptions = !!product.customization_options?.length;
  // Kartın hızlı "+"sı her zaman özelleştirmesiz (varsayılan) satırı
  // hedefler — bu satırın id'si ürünün kendi id'sidir (bkz. cart-context).
  const qty = lines.find((l) => l.lineId === product.id)?.qty ?? 0;
  const outOfStock = !product.in_stock;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.image_url && !imageFailed;
  const hasCampaign = !!product.campaign_discount_percent && !!product.campaign_min_qty;
  // "+" düğmesi görselin üstünde duran yüzey renginde bir daire — Getir /
  // Uber Eats kartlarındaki gibi; aksan rengi sadece ikonda.
  const floatBg = isDark ? '#0b0f0d' : '#fbf3e6';

  return (
    <View style={[styles.card, { backgroundColor: isDark ? CARD_BG_DARK : CARD_BG_LIGHT }, !isDark && styles.cardShadow]}>
      <View style={[styles.cardImageWrap, { backgroundColor: theme.tintSoft }]}>
        {showImage ? (
          <Image
            source={{ uri: product.image_url! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Ionicons name="leaf-outline" size={46} color={withAlpha(theme.tint, 0.55)} />
        )}

        {hasCampaign && (
          <View style={[styles.discountBadge, { backgroundColor: theme.tint }]}>
            <ThemedText style={styles.discountBadgeText}>%{product.campaign_discount_percent}</ThemedText>
          </View>
        )}

        {outOfStock ? (
          <View style={styles.soldOutVeil}>
            <ThemedText style={styles.soldOutText}>Tükendi</ThemedText>
          </View>
        ) : hasOptions ? (
          <Pressable
            onPress={onSelect}
            hitSlop={8}
            accessibilityLabel={`${product.name} seçeneklerini seç`}
            style={[styles.floatBtn, { backgroundColor: floatBg }]}
          >
            <Ionicons name="options-outline" size={17} color={theme.tint} />
          </Pressable>
        ) : qty === 0 ? (
          <Pressable
            onPress={() => addItem(product, qtyStep(product.unit))}
            hitSlop={8}
            accessibilityLabel={`${product.name} sepete ekle`}
            style={[styles.floatBtn, { backgroundColor: floatBg }]}
          >
            {/* Biraz daha kalın "+" (Ionicons'unki çok inceydi); düğme boyu aynı. */}
            <MaterialCommunityIcons name="plus" size={20} color={theme.tint} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.cardBody}>
        <ThemedText style={styles.cardPrice} themeColor="tint">
          {product.gel_al_price ? `₺${formatMoney(product.gel_al_price)}` : 'Fiyat yok'}
          <ThemedText themeColor="textSecondary" style={styles.cardUnit}>
            {' '}/ {formatUnit(product.unit).toLowerCase()}
          </ThemedText>
        </ThemedText>
        <ThemedText numberOfLines={2} style={styles.cardName}>
          {product.name}
        </ThemedText>
        {hasCampaign && (
          <ThemedText themeColor="tint" numberOfLines={1} style={styles.campaignLine}>
            {product.campaign_min_qty} {formatUnit(product.unit).toLowerCase()} ve üzeri %{product.campaign_discount_percent} indirim
          </ThemedText>
        )}
      </View>

      {!outOfStock && !hasOptions && qty > 0 && (
        <VerticalStepper
          qty={qty}
          unit={product.unit}
          name={product.name}
          floatBg={floatBg}
          isDark={isDark}
          onChange={(q) => setQty(product.id, q)}
        />
      )}
    </View>
  );
}

/**
 * Alt menünün üstünde yüzen sepet çubuğu: solda sepet ikonu + ürün sayısı,
 * sağda toplam; altta minimum sepet → ücretsiz teslimat için ince dolum
 * çubuğu. Aşağı kaydırınca menü gizlenir, çubuk yumuşakça alt kenara iner.
 */
function CartBar({ count, total, minAmount, freeAmount, bottomInset, onPress }: {
  count: number; total: number; minAmount: number; freeAmount?: number; bottomInset: number; onPress: () => void;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';

  // Önce minimum sepet hedefi, o tamamlanınca ücretsiz teslimat hedefi.
  let target = 0;
  let label: string | null = null;
  let done = false;
  if (minAmount > 0 && total < minAmount) {
    target = minAmount;
    label = `Minimum sepete ₺${formatMoney(minAmount - total)} kaldı`;
  } else if (freeAmount && total < freeAmount) {
    target = freeAmount;
    label = `Ücretsiz teslimata ₺${formatMoney(freeAmount - total)} kaldı`;
  } else if (freeAmount) {
    target = freeAmount;
    label = 'Ücretsiz teslimat kazandınız';
    done = true;
  }
  const ratio = target > 0 ? Math.min(1, total / target) : 1;

  const fill = useRef(new Animated.Value(ratio)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: ratio, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [ratio, fill]);

  // Normalde menünün (60) üstünde. Aşağı kaydırınca küçülüp menünün ARKASINA
  // iner: üst kenarı küçülmüş menünün üstünden CART_PEEK kadar görünür kalır
  // (üst üste iki kart). Ölçek alt kenara göre olduğu için kaydırma miktarı
  // çubuğun kendi yüksekliğine bağlı -> onLayout ile ölçülüyor.
  const [height, setHeight] = useState(0);
  const lift = TAB_BAR_HEIGHT + Spacing.two;
  const collapsedTabTop = TAB_BAR_COLLAPSED_BOTTOM + TAB_BAR_HEIGHT * TAB_BAR_COLLAPSED_SCALE;
  const collapsedBottom = collapsedTabTop + CART_PEEK - height * CART_BAR_COLLAPSED_SCALE;
  const translateY = chromeCollapsed.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Spacing.three + lift - collapsedBottom],
  });
  const scale = chromeCollapsed.interpolate({ inputRange: [0, 1], outputRange: [1, CART_BAR_COLLAPSED_SCALE] });

  // Çubuğun kendisi çok şeffaf; sepet doldukça soldan sağa farklı tonda bir
  // renkle doluyor (ayrı ilerleme çubuğu yok). Koyu tema: parlak yeşil;
  // açık tema: koyu turuncu (tema kuralı: açık temada yeşil yok).
  const fillColor = isDark ? withAlpha('#34e3a0', 0.5) : withAlpha('#f07416', 0.55);
  const fg = isDark ? '#fff' : theme.text;
  const fgSoft = isDark ? 'rgba(255,255,255,0.85)' : theme.textSecondary;

  return (
    <Animated.View
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={[
        styles.cartBar,
        {
          bottom: Spacing.three + bottomInset + lift,
          backgroundColor: withAlpha(theme.tint, 0.18),
          borderColor: withAlpha(theme.tint, 0.55),
          transformOrigin: 'bottom',
          transform: [{ translateY }, { scale }],
        },
        Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(1.3)' } as any) : null,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.cartBarFill,
          { backgroundColor: fillColor, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <Pressable onPress={onPress} accessibilityLabel="Sepete git" style={({ pressed }) => [styles.cartBarRow, { opacity: pressed ? 0.8 : 1 }]}>
        <View style={[styles.cartBarIcon, { backgroundColor: theme.tint }]}>
          <Ionicons name="basket" size={19} color="#fff" />
          <View style={[styles.cartBarBadge, { borderColor: theme.tint }]}>
            <ThemedText style={[styles.cartBarBadgeText, { color: theme.tint }]}>{count}</ThemedText>
          </View>
        </View>
        <View style={styles.flex}>
          <ThemedText style={[styles.cartBarTitle, { color: fg }]} numberOfLines={1}>Sepete Git</ThemedText>
          <View style={styles.cartBarLabelRow}>
            {done && <Ionicons name="checkmark-circle" size={13} color={theme.tint} />}
            <ThemedText style={[styles.cartBarSub, { color: fgSoft }]} numberOfLines={1}>
              {label ?? `${count} ürün`}
            </ThemedText>
          </View>
        </View>
        <ThemedText style={[styles.cartBarTotal, { color: fg }]}>{formatMoney(total)} ₺</ThemedText>
        <Ionicons name="chevron-forward" size={20} color={fg} />
      </Pressable>
    </Animated.View>
  );
}

// Sepetteyken "+" yerinde kalır, altına doğru miktar ve "−" açılır (dikey,
// şeffaf sütun; kartın yazı kısmının üstüne biner, kart boyu değişmez).
// İnce sütun (32); ekleme öncesindeki 36'lık "+" ile aynı merkezde durur.
const STEPPER_BTN = 32;
const FLOAT_BTN = 36;
const STEPPER_OPEN_HEIGHT = STEPPER_BTN + 32 + 30;

function VerticalStepper({ qty, unit, name, floatBg, isDark, onChange }: {
  qty: number; unit: string; name: string; floatBg: string; isDark: boolean; onChange: (q: number) => void;
}) {
  const theme = useTheme();
  const step = qtyStep(unit);
  const open = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Yavaş, yumuşak geçiş: 36'lık "+" 32'ye incelirken sütun aşağı açılır.
    Animated.timing(open, {
      toValue: 1, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [open]);

  // "+" düğmesinin çapı 36 -> 32; merkez yerinde kalsın diye konum da kayar.
  const size = open.interpolate({ inputRange: [0, 1], outputRange: [FLOAT_BTN, STEPPER_BTN] });
  const inset = open.interpolate({ inputRange: [0, 1], outputRange: [0, (FLOAT_BTN - STEPPER_BTN) / 2] });
  const height = open.interpolate({ inputRange: [0, 1], outputRange: [FLOAT_BTN, STEPPER_OPEN_HEIGHT] });
  const reveal = open.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });

  return (
    <Animated.View
      style={[
        styles.vStepper,
        {
          width: size, height, borderRadius: Animated.divide(size, 2),
          right: Animated.add(inset, Spacing.two), top: Animated.add(inset, CARD_IMAGE_HEIGHT - Spacing.two - FLOAT_BTN),
          backgroundColor: withAlpha(floatBg, isDark ? 0.55 : 0.6),
        },
      ]}
    >
      <Animated.View style={[styles.vStepperPlus, { width: size, height: size, borderRadius: Animated.divide(size, 2), backgroundColor: floatBg }]}>
        <Pressable
          onPress={() => onChange(qty + step)}
          hitSlop={6}
          accessibilityLabel={`${name} artır`}
          style={styles.vStepperPlusHit}
        >
          <MaterialCommunityIcons name="plus" size={18} color={theme.tint} />
        </Pressable>
      </Animated.View>
      <Animated.View style={[styles.vStepperRest, { opacity: reveal }]}>
        <View style={styles.vStepperQty}>
          <ThemedText style={[styles.vStepperQtyNum, { color: theme.text }]}>{formatQty(qty, unit)}</ThemedText>
          <ThemedText style={[styles.vStepperQtyUnit, { color: theme.textSecondary }]}>
            {formatUnit(unit).toLowerCase()}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => onChange(qty - step)}
          hitSlop={6}
          accessibilityLabel={`${name} azalt`}
          style={styles.vStepperMinus}
        >
          <MaterialCommunityIcons
            name={qty <= step ? 'trash-can-outline' : 'minus'}
            size={qty <= step ? 16 : 18}
            color={theme.tint}
          />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingVertical: 2, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  // Ağırlıklar ThemedText'te bir kademe yükseltiliyor (700 -> 800).
  headerTitle: { fontSize: 21, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  logoBadge: { width: 60, height: 60 },
  // Etiket satırı (30) + üstte 8 = 38; sarmalayıcı 38 + INFO_GAP -> bilgi
  // kutuları ile kategori paneli arasında küçük bir ayrım kalır.
  infoList: { flexGrow: 0, flexShrink: 0, height: 30, marginTop: Spacing.two },
  infoRow: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    height: 30,
    justifyContent: 'center',
  },
  listArea: { flex: 1, position: 'relative' },
  // Kategori paneli: üstte ve altta eşit boşluk (CAT_GAP), satırlar arası da
  // aynı — alt kategoriler panelin alt kenarına yapışık bitmiyor.
  categoryOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: CAT_GAP, paddingBottom: CAT_GAP, gap: CAT_GAP },
  chipList: { flexGrow: 0, flexShrink: 0, height: CHIP_H },
  chipRow: { paddingHorizontal: Spacing.three, gap: Spacing.two - 2, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.two + 4,
    height: CHIP_H,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  chipIcon: { marginRight: 4 },
  subChipList: { flexGrow: 0, flexShrink: 0, height: SUB_CHIP_H },
  subChip: {
    paddingHorizontal: Spacing.two + 2,
    height: SUB_CHIP_H,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subChipText: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  // Bölüm başlığı: kutu/çerçeve yok — büyük kalın başlık + sağda ürün sayısı.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  sectionHeaderIcon: { marginRight: 6, alignSelf: 'center' },
  sectionTitle: { fontSize: 20, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  // Liste kenardan kenara; yatay satırlar kendi iç boşluğunu veriyor ki
  // kartlar ekranın kenarına kadar kayabilsin.
  grid: { paddingTop: Spacing.one, paddingBottom: Spacing.six + Spacing.six },
  hRow: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two + 4, alignItems: 'flex-start' },
  // Kart: çerçevesiz dolu yüzey; görsel kenardan kenara üstte, aksiyonlar
  // görselin üstünde yüzüyor (kart boyu sepete ekleyince değişmiyor).
  card: { width: CARD_WIDTH, borderRadius: 18, overflow: 'hidden' },
  cardShadow: {
    shadowColor: '#7a4a1c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  cardImageWrap: { height: CARD_IMAGE_HEIGHT, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardBody: { paddingHorizontal: Spacing.two + 4, paddingTop: Spacing.two, paddingBottom: Spacing.two + 4, gap: 2 },
  cardPrice: { fontSize: 18, lineHeight: 22, fontWeight: '700' },
  cardUnit: { fontSize: 13, fontWeight: '500' },
  cardName: { fontSize: 15, lineHeight: 19, fontWeight: '600' },
  campaignLine: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 2 },
  discountBadge: {
    position: 'absolute', top: Spacing.two, left: Spacing.two,
    height: 22, borderRadius: 11, paddingHorizontal: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  discountBadgeText: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 16 },
  floatBtn: {
    position: 'absolute', right: Spacing.two, bottom: Spacing.two,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 3,
  },
  // Dikey şeffaf sütun: üstü "+" düğmesiyle aynı yerde (görselin sağ alt
  // köşesi), aşağı doğru açılıp kartın yazı kısmına biner. Şeffaf zeminde
  // gölge/elevation (Android'de) gri leke bıraktığı için gölge yok.
  // Boyut/konum VerticalStepper içinde canlandırılıyor (36'lık "+" -> 32).
  vStepper: { position: 'absolute', overflow: 'hidden', alignItems: 'center' },
  vStepperPlus: { overflow: 'hidden' },
  vStepperPlusHit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vStepperRest: { alignItems: 'center' },
  vStepperQty: { height: 32, alignItems: 'center', justifyContent: 'center' },
  vStepperQtyNum: { fontSize: 12, lineHeight: 14, fontWeight: '800' },
  vStepperQtyUnit: { fontSize: 9, lineHeight: 11, fontWeight: '700' },
  vStepperMinus: { width: STEPPER_BTN, height: 30, alignItems: 'center', justifyContent: 'center' },
  soldOutVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  soldOutText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyBox: { borderRadius: 14, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.two, marginHorizontal: Spacing.three },
  // Sepet çubuğu (CartBar): alt menünün üstünde yüzen tek kart.
  // Şeffaf zeminde gölge/elevation Android'de gri leke bırakır -> gölge yok.
  cartBar: {
    position: 'absolute', left: Spacing.three, right: Spacing.three, borderRadius: 20,
    borderWidth: 1, overflow: 'hidden',
  },
  // Dolum: çubuğun kendisi soldan sağa dolar (sepet tutarı / hedef).
  cartBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  cartBarRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three - 4, paddingVertical: Spacing.two + 2,
  },
  cartBarIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cartBarBadge: {
    position: 'absolute', top: -4, right: -6, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 4,
    backgroundColor: '#fff', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  cartBarBadgeText: { fontSize: 11, lineHeight: 13, fontWeight: '900' },
  cartBarTitle: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  cartBarSub: { fontSize: 12, lineHeight: 15, fontWeight: '700', flexShrink: 1 },
  cartBarTotal: { fontSize: 19, lineHeight: 23, fontWeight: '900', letterSpacing: -0.3 },
  cartBarLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
