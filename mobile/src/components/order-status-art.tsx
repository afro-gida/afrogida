import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/constants/theme';
import type { OrderStatus } from '@/lib/types';

/**
 * Sipariş durumunun hareketli çizimi (takip ekranı, app/siparis/[tx].tsx).
 *  - Sipariş Alındı: kağıda sipariş listesi yazılıyor
 *  - Hazırlanıyor: poşete meyve/sebze doluyor
 *  - Hazır: poşet motorun kutusuna giriyor (Gel-Al'da poşet hazır, parlıyor)
 *  - Yolda: motor gidiyor, yol akıyor
 *  - Teslim Edildi / İptal: hareketsiz resim
 *
 * Kütüphane yok (Lottie vb.), sadece ikon + Animated; telefonda native
 * sürücüyle (transform/opacity) çalışır. Aynı anda ekranda tek çizim
 * hareket eder. Telefonda "Hareketi Azalt" açıksa ya da `animate={false}`
 * verilirse hepsi son kareyi gösteren sabit resim olur.
 */
const ND = Platform.OS !== 'web';
const BASE = 120;

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

export function OrderStatusArt({
  status,
  deliveryType,
  size = BASE,
  animate = true,
}: {
  status: OrderStatus;
  deliveryType: 'gel_al' | 'eve_servis';
  size?: number;
  animate?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const live = animate && !reduceMotion;
  const scale = size / BASE;

  let art: React.ReactNode;
  switch (status) {
    case 'talep_alindi':
    case 'hazirlik_bekliyor':
      art = <ReceiptArt live={live} />;
      break;
    case 'hazirlaniyor':
      art = <BagFillArt live={live} />;
      break;
    case 'hazir':
      art = deliveryType === 'eve_servis' ? <BoxArt live={live} /> : <ReadyBagArt live={live} />;
      break;
    case 'yolda':
      art = <RideArt live={live} />;
      break;
    case 'teslim_edildi':
      art = <StaticArt icon={deliveryType === 'eve_servis' ? 'home-heart' : 'hand-heart'} badge="check-decagram" />;
      break;
    default:
      art = <StaticArt icon="shopping-outline" badge="close-circle" danger />;
  }

  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.base, { transform: [{ scale }], left: (size - BASE) / 2, top: (size - BASE) / 2 }]}>{art}</View>
    </View>
  );
}

/** Takip çizgisindeki ve listedeki küçük, hareketsiz durum ikonu. */
export function orderStatusIcon(status: OrderStatus, deliveryType: 'gel_al' | 'eve_servis'): Mci {
  switch (status) {
    case 'talep_alindi':
    case 'hazirlik_bekliyor':
      return 'receipt-text-outline';
    case 'hazirlaniyor':
      return 'shopping-outline';
    case 'hazir':
      return deliveryType === 'eve_servis' ? 'package-variant-closed' : 'basket-check';
    case 'yolda':
      return 'moped';
    case 'teslim_edildi':
      return deliveryType === 'eve_servis' ? 'home-heart' : 'hand-heart';
    default:
      return 'cancel';
  }
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** 0 -> 1 sonsuz döngü; `live` kapalıyken `rest` değerinde durur. */
function useLoop(live: boolean, build: (v: Animated.Value) => Animated.CompositeAnimation, rest = 1) {
  const v = useRef(new Animated.Value(live ? 0 : rest)).current;
  useEffect(() => {
    if (!live) {
      v.setValue(rest);
      return;
    }
    v.setValue(0);
    const loop = Animated.loop(build(v));
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  return v;
}

/* ---------------- Sipariş Alındı: kağıda liste yazılıyor ---------------- */

const LINES = 4;
const LINE_W = 44;

function ReceiptArt({ live }: { live: boolean }) {
  const theme = useTheme();
  // p: 0..LINES — her satır sırayla yazılır, sonra kağıt kısa bir an durup başa döner.
  const p = useLoop(
    live,
    (v) =>
      Animated.sequence([
        Animated.timing(v, { toValue: LINES, duration: 2400, easing: Easing.linear, useNativeDriver: ND }),
        Animated.delay(900),
        Animated.timing(v, { toValue: LINES + 1, duration: 250, useNativeDriver: ND }),
      ]),
    LINES,
  );
  // Kalem her satırın başından sonuna gider, sonra alt satıra atlar.
  const penIn: number[] = [];
  const penX: number[] = [];
  const penY: number[] = [];
  for (let i = 0; i < LINES; i++) {
    penIn.push(i + (i ? 0.001 : 0), i + 1);
    penX.push(0, LINE_W);
    penY.push(i * 12, i * 12);
  }
  const fadeOut = p.interpolate({ inputRange: [LINES, LINES + 1], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.center}>
      <View style={[styles.paper, { backgroundColor: theme.background, borderColor: withAlpha(theme.tint, 0.6) }]}>
        <View style={[styles.paperHead, { backgroundColor: theme.tint }]} />
        <Animated.View style={{ opacity: fadeOut }}>
          {Array.from({ length: LINES }).map((_, i) => (
            <View key={i} style={styles.paperLineRow}>
              <View style={[styles.paperDot, { backgroundColor: withAlpha(theme.tint, 0.7) }]} />
              <Animated.View
                style={[
                  styles.paperLine,
                  {
                    width: i === LINES - 1 ? LINE_W * 0.6 : LINE_W,
                    backgroundColor: withAlpha(theme.text, 0.55),
                    transformOrigin: 'left',
                    transform: [{ scaleX: p.interpolate({ inputRange: [i, i + 1], outputRange: [0, 1], extrapolate: 'clamp' }) }],
                  },
                ]}
              />
            </View>
          ))}
        </Animated.View>
      </View>
      {live && (
        <Animated.View
          style={[
            styles.pen,
            {
              opacity: p.interpolate({ inputRange: [0, LINES - 0.05, LINES], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
              transform: [
                { translateX: p.interpolate({ inputRange: penIn, outputRange: penX, extrapolate: 'clamp' }) },
                { translateY: p.interpolate({ inputRange: penIn, outputRange: penY, extrapolate: 'clamp' }) },
              ],
            },
          ]}
        >
          <MaterialCommunityIcons name="pencil" size={20} color={theme.tint} />
        </Animated.View>
      )}
    </View>
  );
}

/* ---------------- Hazırlanıyor: poşete ürünler düşüyor ---------------- */

const PRODUCE: { icon: Mci; x: number; color?: string }[] = [
  { icon: 'food-apple', x: -14, color: '#e5484d' },
  { icon: 'carrot', x: 10, color: '#f97316' },
  { icon: 'leaf', x: -2, color: '#22a06b' },
];

function BagFillArt({ live }: { live: boolean }) {
  const theme = useTheme();
  const t = useLoop(live, (v) => Animated.timing(v, { toValue: 1, duration: 2100, easing: Easing.linear, useNativeDriver: ND }), 0);

  return (
    <View style={styles.center}>
      {PRODUCE.map((p, i) => {
        // Her ürün döngünün kendi üçte birinde düşer: yukarıdan poşetin ağzına.
        const start = i / PRODUCE.length;
        const end = start + 0.28;
        const k = t.interpolate({ inputRange: [0, start, end, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
        return (
          <Animated.View
            key={p.icon}
            style={[
              styles.produce,
              {
                opacity: live ? k.interpolate({ inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] }) : 0,
                transform: [
                  { translateX: p.x },
                  { translateY: k.interpolate({ inputRange: [0, 1], outputRange: [-14, 26], extrapolate: 'clamp' }) },
                  { rotate: k.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '15deg'] }) },
                ],
              },
            ]}
          >
            <MaterialCommunityIcons name={p.icon} size={27} color={p.color ?? theme.tint} />
          </Animated.View>
        );
      })}
      {/* Ürün girdikçe poşet hafifçe esner. */}
      <Animated.View
        style={{
          marginTop: 30,
          transformOrigin: 'bottom',
          transform: [
            {
              scaleY: t.interpolate({
                inputRange: [0, 0.26, 0.3, 0.34, 0.59, 0.63, 0.67, 0.92, 0.96, 1],
                outputRange: [1, 1, 0.94, 1, 1, 0.94, 1, 1, 0.94, 1],
              }),
            },
          ],
        }}
      >
        <MaterialCommunityIcons name="shopping" size={70} color={theme.tint} />
      </Animated.View>
    </View>
  );
}

/* ---------------- Hazır (Eve Servis): poşet motor kutusuna ---------------- */

function BoxArt({ live }: { live: boolean }) {
  const theme = useTheme();
  const t = useLoop(
    live,
    (v) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }),
        Animated.delay(700),
      ]),
    1,
  );
  const drop = t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 1, 1] });
  const pop = t.interpolate({ inputRange: [0, 0.72, 0.82, 0.92, 1], outputRange: [1, 1, 1.12, 1, 1] });

  return (
    <View style={styles.center}>
      <View style={styles.bikeWrap}>
        <MaterialCommunityIcons name="moped" size={78} color={withAlpha(theme.text, 0.75)} style={styles.bikeIcon} />
        {/* Motorun arkasındaki teslimat kutusu */}
        <Animated.View style={[styles.box, { transform: [{ scale: pop }] }]}>
          <MaterialCommunityIcons name="package-variant-closed" size={40} color={theme.tint} />
        </Animated.View>
        {live && (
          <Animated.View
            style={[
              styles.boxBag,
              {
                opacity: drop.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-40, 6] }) }],
              },
            ]}
          >
            <MaterialCommunityIcons name="shopping" size={24} color={theme.tint} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/* ---------------- Hazır (Gel-Al): poşet hazır, parlıyor ---------------- */

function ReadyBagArt({ live }: { live: boolean }) {
  const theme = useTheme();
  const t = useLoop(live, (v) => Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }), 0.5);
  return (
    <View style={styles.center}>
      <Animated.View
        style={[
          styles.glow,
          {
            backgroundColor: withAlpha(theme.tint, 0.22),
            opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 1, 0.35] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1.05, 0.85] }) }],
          },
        ]}
      />
      <MaterialCommunityIcons name="basket-check" size={72} color={theme.tint} />
    </View>
  );
}

/* ---------------- Yolda: motor gidiyor ---------------- */

function RideArt({ live }: { live: boolean }) {
  const theme = useTheme();
  const road = useLoop(live, (v) => Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.linear, useNativeDriver: ND }), 0);
  const bob = useLoop(live, (v) => Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }), 0);

  return (
    <View style={styles.center}>
      {/* Arkada hız çizgileri */}
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.speedLine,
            {
              top: 34 + i * 12,
              width: 18 - i * 3,
              backgroundColor: withAlpha(theme.tint, 0.55),
              opacity: live ? road.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 1, 0.2] }) : 0.5,
              transform: [{ translateX: road.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -3, 0] }) }] }}
      >
        <MaterialCommunityIcons name="moped" size={76} color={theme.tint} />
      </Animated.View>
      {/* Yol: kesikli çizgiler sağdan sola akar */}
      <View style={styles.road}>
        <Animated.View
          style={[
            styles.roadDashes,
            { transform: [{ translateX: road.interpolate({ inputRange: [0, 1], outputRange: [0, -28] }) }] },
          ]}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={[styles.dash, { backgroundColor: withAlpha(theme.text, 0.35) }]} />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

/* ---------------- Teslim / İptal: sabit resim ---------------- */

function StaticArt({ icon, badge, danger }: { icon: Mci; badge: Mci; danger?: boolean }) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.tint;
  return (
    <View style={styles.center}>
      <View style={[styles.staticCircle, { backgroundColor: withAlpha(color, 0.14) }]}>
        <MaterialCommunityIcons name={icon} size={60} color={color} />
      </View>
      <View style={[styles.staticBadge, { backgroundColor: theme.background }]}>
        <MaterialCommunityIcons name={badge} size={30} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { position: 'absolute', width: BASE, height: BASE },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Kağıt
  paper: { width: 70, height: 86, borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 8, paddingTop: 0, overflow: 'hidden' },
  paperHead: { height: 8, marginHorizontal: -8, marginBottom: 9 },
  paperLineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 12 },
  paperDot: { width: 4, height: 4, borderRadius: 2 },
  paperLine: { height: 3, borderRadius: 2 },
  pen: { position: 'absolute', left: 38, top: 36 },
  // Poşet
  produce: { position: 'absolute', top: 18 },
  // Motor + kutu
  bikeWrap: { width: 100, height: 90, alignItems: 'center', justifyContent: 'flex-end' },
  bikeIcon: { marginBottom: -4 },  box: { position: 'absolute', left: 4, top: 8 },
  boxBag: { position: 'absolute', left: 12, top: 4 },
  glow: { position: 'absolute', width: 100, height: 100, borderRadius: 50 },
  // Yol
  speedLine: { position: 'absolute', left: 6, height: 3, borderRadius: 2 },
  road: { width: 84, height: 4, overflow: 'hidden', marginTop: 2 },
  roadDashes: { flexDirection: 'row', gap: 10, width: 140 },
  dash: { width: 14, height: 3, borderRadius: 2 },
  // Sabit
  staticCircle: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  staticBadge: { position: 'absolute', right: 10, bottom: 10, borderRadius: 18, padding: 2 },
});
