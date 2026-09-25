import { Animated, Easing } from 'react-native';

/**
 * Aşağı kaydırınca alt menü (sekme çubuğu) ekrandan aşağı kayıp gizlenir,
 * yukarı kaydırınca geri gelir — mobil sitelerdeki "tam ekran" davranışı.
 * 0 = görünür, 1 = gizli. Sekme çubuğu bu değeri translateY'ye çevirir;
 * listeler kaydırma olayını `reportScroll`'a iletir.
 */
export const tabBarHidden = new Animated.Value(0);

let hidden = false;
let lastY = 0;

function setHidden(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  Animated.timing(tabBarHidden, {
    toValue: next ? 1 : 0,
    duration: 260,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: false,
  }).start();
}

/** Liste kaydırıldıkça çağrılır; yön değişimine göre menüyü gizler/gösterir. */
export function reportScroll(y: number) {
  const delta = y - lastY;
  if (y <= 10) setHidden(false);
  else if (delta > 6) setHidden(true);
  else if (delta < -6) setHidden(false);
  lastY = y;
}

/** Sekme değişince / ekran açılınca menüyü geri getir. */
export function showChrome() {
  lastY = 0;
  setHidden(false);
}
