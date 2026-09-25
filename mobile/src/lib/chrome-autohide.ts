import { Animated, Easing } from 'react-native';

/**
 * Aşağı kaydırınca alt menü (sekme çubuğu) gizlenmez: küçülüp ekranın en
 * altına iner; sepet çubuğu varsa o da küçülüp menünün arkasına geçer (üst
 * üste iki kart). Yukarı kaydırınca ikisi de eski yerine döner.
 * 0 = normal, 1 = küçülmüş. Menü ve sepet çubuğu bu değeri kendi
 * ölçek/konumlarına çevirir.
 */
export const chromeCollapsed = new Animated.Value(0);

/** Küçülmüş haldeki ölçekler. */
export const TAB_BAR_COLLAPSED_SCALE = 0.6;
export const CART_BAR_COLLAPSED_SCALE = 0.54;
/** Küçülünce menünün ekranın altına olan uzaklığı. */
export const TAB_BAR_COLLAPSED_BOTTOM = 4;

let collapsed = false;

/** Menüyü küçült/büyüt. Kaydırma kararı ekranın kendisinde verilir
 *  (bkz. pazar/[id]/index.tsx handleListScroll). */
export function setChromeCollapsed(next: boolean) {
  if (next === collapsed) return;
  collapsed = next;
  Animated.timing(chromeCollapsed, {
    toValue: next ? 1 : 0,
    duration: 380,
    easing: Easing.inOut(Easing.cubic),
    useNativeDriver: false,
  }).start();
}

/** Sekme değişince / ekran açılınca menüyü normal haline getir. */
export function showChrome() {
  setChromeCollapsed(false);
}
